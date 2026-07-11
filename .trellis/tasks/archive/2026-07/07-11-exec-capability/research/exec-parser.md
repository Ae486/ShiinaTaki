# Research: exec command parser (the security-critical core)

- **Query**: How to classify an exec request as SIMPLE (auto-run) vs ESCALATE (dialog) vs BLOCK (reject); crate-vs-handroll for the parser
- **Scope**: mixed (ADR 0002 + installed capability seam + docs.rs crates + Claude Code prior art)
- **Date**: 2026-07-11

## Verdict (read first)

1. **Hand-roll a small purpose-built parser. Do NOT lean on `shell-words`/`shlex` for classification.** Both crates tokenize (quote removal) but, by explicit design, do **not** recognize operators — `shell-words` docs: *"without special token recognition rules for operators"*. They cannot tell you whether `;`/`&&`/`|`/`>` are present as operators, which is the ONE thing the security gate must know. `shlex::split` returns `None` on unbalanced quotes, which is a useful "unparseable → escalate" signal, but it is not sufficient on its own. Verdict: hand-roll an operator/metachar scanner FIRST (produces the SIMPLE/ESCALATE/BLOCK class), and only if the class is SIMPLE hand it to a tokenizer to split argv for allowlist matching. A tokenizer crate is optional there; `shell-words` 1.1.1 (max stable, 2025-12-10) is a candidate but see the Windows caveat below.
2. **Classification is a three-way sieve applied to the raw command STRING before any spawn:** BLOCK (catastrophic pattern hit → reject, no dialog) → ESCALATE (any operator/metachar/quote-imbalance → approval dialog) → SIMPLE (clean single command, every argv[0] allowlisted → may auto-run). Order matters: BLOCK wins over everything (a catastrophic pattern inside a chained command is still a BLOCK).
3. **"Auto-runs only if EVERY pipeline segment is allowlisted" is moot in our default model — because ANY pipeline (`|`) already forces ESCALATE.** In `allowlist` mode a piped/chained command never auto-runs regardless of its segments; it goes to the dialog. So we do NOT need per-segment allowlist matching for the auto-run path in v1. Per-segment matching only becomes necessary if a future mode wants to auto-run allowlisted chains (a leader decision — flag). See exec-policy-gate.md.
4. **Windows is the v1 shell host, and `std::process::Command` takes an explicit argv with NO shell** (see exec-sandbox.md). That means the parser's job is: (a) reject/escalate anything that would only be meaningful to a shell (operators, redirection, `%VAR%`, `$()`, backticks, globs), and (b) for the SIMPLE case, split into `[program, arg, arg…]` that we hand to `Command::new(program).args(rest)`. We are NOT emulating cmd.exe semantics — we are refusing them.

## Findings

### The existing seam the parser plugs into

| File Path | Description |
|---|---|
| `apps/desktop/src-tauri/src/capabilities_impl.rs:32-40` | `CapabilityExec` trait — `run(&Value)->Result<Value,ExecError>` + `detail(&Value)->Option<String>`. exec is a new impl of this. |
| `apps/desktop/src-tauri/src/capabilities_impl/shell_open.rs` | The closest prior art: a `plan_open()` **pure** validation fn (unit-testable, no side effect) + an allowlist (`ALLOWED_SCHEMES`) + a `detail()` that surfaces the target to the dialog. exec should mirror this shape: a pure `classify(command)->ExecPlan` fn separate from the spawn. |
| `apps/desktop/src-tauri/src/gate.rs:65` | `Gate::evaluate(request_id, capability, detail)` — decides per **capability name**. exec's parser output must be fed to a richer decision than this exposes (see exec-policy-gate.md). |

The pattern to copy verbatim: shell_open's `plan_open` is pure and table-tested (`allows_http_https_mailto_urls`, `rejects_dangerous_and_unknown_schemes`). exec's classifier is the same idea at higher stakes — a pure `fn classify(raw: &str) -> ExecClass` with an exhaustive table-driven test suite (ADR 0002 calls this out as the highest-stakes boundary in v1).

### ADR 0002 exact requirements (quoted — this is the governing spec)

> Policy modes `deny | allowlist | full`, default `allowlist`. A command auto-runs only if every pipeline segment matches the allowlist; chaining (`;`, `&&`, `||`) or redirection escalates to a user approval dialog. Unparseable commands escalate — never guess (fail-closed).

> A blocklist of catastrophic patterns (`rm -rf`, `format`, `reg delete`, ...) is rejected outright without approval — a tripwire, not the primary defense.

Note the ADR uses the Unix-shell mental model (`;`, `&&`, `||`, "pipeline segment"). Because our Shell host is Windows and we spawn with no shell, the parser must ALSO catch the cmd.exe metacharacter set (`&`, `|`, `<`, `>`, `^`, `%VAR%`, `()`), not just the POSIX ones the ADR lists. The ADR's list is illustrative, not exhaustive — flag that we are broadening it to cover the actual host shell.

### Crate evaluation (installed / docs.rs, versions verified 2026-07-11 via crates.io API)

| Crate | Max stable | What it does | Verdict for exec |
|---|---|---|---|
| `shell-words` | 1.1.1 (2025-12-10) | POSIX `split`/`quote`/`join`. `split` does quote removal only, **no operator recognition, no expansion**. Errors on unbalanced quotes (`ParseError`). | Usable ONLY as the argv tokenizer for the already-classified-SIMPLE case. Its POSIX quoting rules differ from Windows quoting — a mild mismatch since we forbid the ambiguous cases anyway. Its `ParseError` on bad quotes = an "unparseable → escalate" signal. |
| `shlex` | 2.0.1 (2026-05-17) | Python-shlex-like split/quote; `split` returns `None` on erroneous input. Byte-string capable. | Equivalent to shell-words for our purposes; `None`-on-error is slightly ergonomic. Same no-operator-detection limitation. |
| (hand-roll) | — | Scan raw string for the operator/metachar set + quote balance, classify, then tokenize. | **Recommended.** Zero new dep (consistent with #10's "no deps outside the pinned set" stance — base64 and UUID were hand-rolled for exactly this reason). ADR 0002 wants exhaustive table-driven tests; a small owned parser is far easier to test to that bar than to reason about a crate's POSIX-vs-Windows edge behavior. |

**Critical crate limitation to record:** neither crate detects operators. `shell_words::split("a && b")` yields `["a", "&&", "b"]` — `&&` becomes a plain token, not a recognized operator; and `shell_words::split("a>b")` (no spaces) yields `["a>b"]` — the redirection vanishes into a token entirely. So a crate-only approach would silently pass `a>b` as a "single command named `a>b`". This is why classification must be a raw-string metachar scan, NOT a post-tokenization inspection. (Prior art: Claude Code itself parses shell operators explicitly and matches each subcommand independently — GitHub issue #36637 documents the real bypass that happens when you match only the first token of a compound string. That bug is our anti-pattern.)

### The tokenization → allowlist-match algorithm (for the SIMPLE path)

Proposed, for leader confirmation:

1. **Reject before tokenizing** (BLOCK/ESCALATE scan on the raw string) — see the sieve below. If ESCALATE/BLOCK, we never tokenize for auto-run.
2. **Tokenize** the SIMPLE string into `[program, args…]` (hand-rolled splitter or `shell-words::split`; a tokenize error → ESCALATE, never guess).
3. **Match `program` (argv[0]) against the allowlist**, case-insensitively (Windows is case-insensitive). Open questions the leader/user must settle:
   - **Match on the bare name (`git`) or a resolved absolute path?** Bare-name matching is what the agent naturally emits and what Claude Code does, but it is spoofable if the child's PATH is attacker-influenced (it is not, in our model — env is scrubbed and PATH is Shell-controlled, see exec-sandbox.md). Recommendation: match the **normalized basename without extension** (`git`, `node`) case-insensitively, and rely on the scrubbed, Shell-controlled PATH + `std::process::Command`'s documented Windows resolution order (below) to bind it to a real exe. Full-path resolution (via the `which` crate's PATHEXT logic) is a hardening option for later, flag as M4.
   - **`.bat`/`.cmd` handling.** This is a genuine landmine: `std::process::Command` invoking a `.bat`/`.cmd` re-enters cmd.exe's argument splitter and was the subject of CVE-2024-24576 / CVE-2024-43402 (BatBadBut). Even with clean argv, spawning a batch file means cmd.exe re-parses our args. **Recommendation: the allowlist should permit only real executables (`.exe`), and the classifier should BLOCK or ESCALATE any argv[0] resolving to `.bat`/`.cmd`.** Flag as a firm leader decision — see exec-sandbox.md for the CVE detail.

### Windows executable resolution (documented std behavior — do NOT code from memory)

`std::process::Command` on Windows resolves the program itself (it does not defer to `CreateProcessW`). Documented search order when the program is a bare name:
1. the child's `PATH` **only if explicitly set via `.env()`** (a quirk — see exec-sandbox.md env-scrub interaction),
2. the directory of the current executable,
3. the system directory (`GetSystemDirectoryW`),
4. the Windows directory,
5. the parent process's `PATH`.
`.exe` is appended if the name has no extension. Consequences for exec:
- If we scrub env and set a curated `PATH` via `.env("PATH", …)`, resolution uses OUR PATH first (step 1). If we do NOT set PATH, step 1 is skipped and it falls to the parent's PATH at step 5 — meaning the child inherits the Shell process's PATH. **This env/PATH coupling is load-bearing and belongs in exec-sandbox.md.**
- The `.exe`-only append means `Command::new("code")` will NOT find `code.cmd` (documented, rust-lang/rust #104358). Combined with the `.bat`/`.cmd` BLOCK recommendation, this actually helps us: bare-name resolution naturally binds to `.exe`, and we refuse the batch cases explicitly.

### The classification sieve (proposed concrete algorithm)

Applied to the raw request string, in order:

```
1. BLOCK  — if any catastrophic pattern matches (case-insensitive, whitespace-normalized) → reject, no dialog.
2. ESCALATE — if the string contains, OUTSIDE quotes, any of:
     chaining/background : ; & && ||    (note bare & = cmd background/separator)
     pipe                : |  |&
     redirection         : > >> < <<  (and 2> etc.)
     subshell/substitution: ` (backtick)  $(  )  (  )
     env expansion       : %...%   ${...}  $NAME
     glob                : * ? [ ]   (in a path/arg position)
     newline             : \n \r
   OR the string fails quote-balance / tokenization → ESCALATE (fail-closed, "never guess").
3. SIMPLE — else tokenize; if argv[0] (normalized basename) is on the allowlist → may auto-run
            (subject to policy mode, exec-policy-gate.md); else ESCALATE.
```

`^` (cmd.exe escape) and `!` (delayed expansion) are additional cmd metachars worth including in the ESCALATE set. Because we spawn with no shell, these are inert as arguments — but their PRESENCE signals an agent trying to write shell syntax, which is exactly the "escalate, let a human look" case.

### Catastrophic blocklist — proposed STARTING set (exact contents = leader/user decision)

A tripwire, not the defense (ADR 0002). Match case-insensitively on the normalized raw string. Proposed seed, grouped:

- **Recursive/forced delete**: `rm -rf`, `rm -r -f`, `del /s`, `del /q`, `rmdir /s`, `rd /s`, `Remove-Item -Recurse -Force`.
- **Disk/format/partition**: `format `, `diskpart`, `mkfs`, `label `, `chkdsk /f`, `cipher /w`.
- **Registry wipe**: `reg delete`, `reg add … /f` on HKLM roots, `Remove-ItemProperty HKLM:`.
- **Fork bombs / self-replication**: `:(){ :|:& };:`, `%0|%0`, `for /l %` loops spawning, `start /b` loops.
- **Pipe-to-shell / remote code**: `curl … | sh`, `curl … | bash`, `iwr … | iex`, `Invoke-Expression`, `powershell -enc`/`-EncodedCommand`, `certutil -urlcache`, `bitsadmin /transfer`.
- **Privilege/account tampering**: `net user … /add`, `net localgroup administrators … /add`, `takeown /f C:\ /r`, `icacls C:\ /grant`.
- **Shutdown/boot tampering**: `shutdown`, `bcdedit`, `vssadmin delete shadows`, `wevtutil cl` (log clearing).

**Flag for the user:** the exact blocklist is a policy/product call — it is a denylist (inherently incomplete) whose only job is to stop the obvious catastrophes without a dialog. It must NOT be relied on as the security boundary (the allowlist + always-ask ESCALATE path is the boundary). The list also needs cmd.exe/PowerShell dual-syntax coverage since both are reachable if an operator ever allowlists `cmd`/`powershell` (which they should probably be discouraged from doing — flag).

### External References

- ADR 0002 `docs/adr/0002-exec-in-v1-behind-permission-gate.md` — the governing spec (quoted above).
- `shell-words` 1.1.1 — https://docs.rs/shell-words — `split` does quote removal only, no operator recognition, `ParseError` on bad quotes.
- `shlex` 2.0.1 — https://docs.rs/shlex — POSIX split, `None` on error.
- `std::process::Command` Windows path resolution — https://doc.rust-lang.org/std/process/struct.Command.html (search order enumerated above); rust-lang/rust #104358 (`.cmd` not found), #122660 (system dir vs PATH precedence).
- CVE-2024-24576 / CVE-2024-43402 (BatBadBut) — https://blog.rust-lang.org/2024/04/09/cve-2024-24576/ — batch-file argument injection; motivates BLOCKing `.bat`/`.cmd` (detail in exec-sandbox.md).
- Claude Code compound-command permission model — https://code.claude.com/docs/en/permissions ("A rule must match each subcommand independently"; recognized separators `&&`, `||`, `;`, `|`, `|&`, `&`, newlines) and issue #36637 (the first-token-only bypass we must avoid). This is directly analogous prior art for our per-segment reasoning.

## Caveats / Not Found

- I did not run a live cargo probe of `shell-words::split` output (host build constraints + no-heavy-parallel-build rule); the operator/quote behavior is taken from the crate's own docs.rs documentation, which is explicit about it. A cheap unit test at implement time should pin the exact `split("a && b")` / `split("a>b")` outputs before relying on them.
- Whether globbing (`*`/`?`) should ESCALATE or be allowed-as-literal is genuinely ambiguous: with no shell, `*` is a literal argument (e.g. `git add *` passes `*` literally, which git itself expands). Treating `*` as ESCALATE is the conservative default but will make common `git add .`-style flows prompt. Flag as a UX-vs-safety tradeoff for the leader.

## Leader decisions needed

1. **Parser: hand-roll vs crate** — recommend hand-roll classifier + optional `shell-words` tokenizer for the SIMPLE argv split. Confirm the no-new-dep preference (consistent with #10) or accept `shell-words`.
2. **Allowlist match granularity** — normalized basename (recommend) vs full resolved path (`which`-style). And case-insensitive (yes, Windows).
3. **`.bat`/`.cmd` policy** — recommend BLOCK/ESCALATE any argv[0] resolving to a batch file (BatBadBut). Confirm the allowlist is `.exe`-only.
4. **Catastrophic blocklist starting contents** — the seed set above needs user sign-off; it is a product/policy call, dual-syntax (cmd + PowerShell). **(One of the three the task flags as most likely to need the user.)**
5. **Glob `*`/`?` — ESCALATE or literal-arg?** UX-vs-safety tradeoff.
6. **cmd/powershell as allowlistable programs** — recommend discouraging/forbidding them on the allowlist (they re-introduce a shell). Confirm.
