# PRD — exec Capability with full governance pipeline (issue #12, M3 final slice)

The general-purpose `exec` shell Capability on the proven #10/#11 gate path. The TS Core never spawns; exec requests cross the WS boundary to the Rust Shell, which parses, evaluates policy, spawns, and audits. This is the highest-stakes security boundary in v1 — the parser and policy engine get exhaustive table-driven tests (ADR 0002). Governing docs: ADR 0002 (exec rules), ADR 0007 (locality — exec runs Node-side, cwd Shell-resolved), invariants 1/2/7/8.

## Leader rulings (decided — do not re-litigate)

Architecture (ADR 0007):
- R0. **Stance A**: exec executes Node-side (host). cwd is **Shell-resolved**, defaulting to the Workspace dir when it exists on the Shell host (single-machine v1), else a Shell-owned dir under `app_data_dir()`. exec never assumes Core's filesystem. Configurable via `exec-policy.json` `cwd`.

Parser (exec-parser.md):
- R1. **Hand-roll the classifier + tokenizer. Zero new dep.** Consistent with #10 (base64/uuid hand-rolled to hold the zero-dep-outside-pinned-stack line). Crates (shell-words/shlex) by design do NOT detect operators — a crate-only approach silently passes `a>b` as one token. A pure `fn classify(raw:&str)->ExecClass` mirrors shell_open's pure `plan_open`, table-tested.
- R2. Classification is a three-way sieve on the raw string, order BLOCK → ESCALATE → SIMPLE (BLOCK wins over everything, even inside a chained command).
- R3. **allowlist matches normalized basename, case-insensitive, `.exe` only.** `.bat`/`.cmd` targets → BLOCK/ESCALATE (BatBadBut CVE-2024-24576/43402: a batch target re-enters cmd.exe's arg splitter).
- R4. **Shells are never auto-run even if allowlisted**: argv[0] ∈ {cmd, powershell, pwsh, bash, sh, wsl} → always ESCALATE (they re-introduce a shell the parser just refused).
- R5. **Glob `*`/`?` → ESCALATE** (fail-closed; the user can approve in the dialog).

Policy + gate (exec-policy-gate.md):
- R6. **Gate integration = Shape B**: add `Gate::evaluate_exec(request_id, command, class)` alongside `evaluate`. exec computes the class (parser + mode + allow/blocklist); the gate stays the sole approve+audit authority. exec never reaches around audit/approve; the existing name-keyed `evaluate` path is untouched (#10/#11 behavior unchanged).
- R7. Modes `deny | allowlist | full`, default `allowlist`. `deny` → always reject, no dialog. `allowlist` → SIMPLE + argv[0] allowlisted → auto-run; else ESCALATE. `full` → **always escalate to dialog** (never auto-run-all, never allowlist-blocked). BLOCK (catastrophic) fires in every mode, before mode logic.
- R8. **exec ESCALATE is always-ask; NO once/session/always persistence for exec.** A remembered "always allow exec" would auto-approve every future command — forbidden. The approver's remember-step is not offered for exec (or its answer ignored). exec must NOT use the name-keyed `decisions.get("exec")` path.
- R9. **Audit includes the command (2A).** The exec audit line adds the normalized command string — a documented exec-specific exception to the names-only invariant (#10/#11): the command IS the blast-radius record ADR 0002 relies on in lieu of a Windows sandbox. Distinct from shell-open's target (dialog-only) because a command is an action record, not passive content. Audit line for exec: `{ts, requestId, capability:"exec", decision, command}`. All other capabilities stay names-only.
- R10. **Config = Shell-side `exec-policy.json` under `app_data_dir()`**, `{ mode, allowlist, blocklist, cwd? }`, load-or-degrade-safe (mirror `mcp-servers.json` / `DecisionStore`: missing → safe default, malformed → WARN + safe default). Default: `mode="allowlist"`, `allowlist=[]` (empty → nothing auto-runs, everything escalates — fail-closed), `blocklist=<built-in seed>`.
- R11. **Blocklist is operator-editable** (the seed is the built-in default; `exec-policy.json` `blocklist` adds/replaces). Seed set (case-insensitive, cmd + PowerShell dual-syntax), approved: recursive/forced delete (`rm -rf`, `del /s`, `rmdir /s`, `Remove-Item -Recurse -Force`), disk/format (`format`, `diskpart`, `mkfs`, `cipher /w`), registry wipe (`reg delete`, HKLM force-write), fork bombs (`:(){ :|:& };:`, `%0|%0`), pipe-to-shell/RCE (`curl|sh`, `iwr|iex`, `Invoke-Expression`, `powershell -enc`/`-EncodedCommand`, `certutil -urlcache`, `bitsadmin /transfer`), privilege tampering (`net user /add`, `net localgroup administrators /add`, `takeown /f C:\ /r`, `icacls C:\ /grant`), boot/log tampering (`shutdown`, `bcdedit`, `vssadmin delete shadows`, `wevtutil cl`). Tripwire, not the boundary — the boundary is allowlist + always-ask ESCALATE.

Sandbox (exec-sandbox.md):
- R12. **Spawn `std::process::Command` with explicit argv, NO shell.** Never `cmd /c` / `powershell -c` (re-introduces the injection surface the parser removed). Same reasoning as shell_open.
- R13. **Env = allowlist from empty**, mirroring `@ai-sdk/mcp` get-environment.ts. Windows safe set: `PATH, SystemRoot, SystemDrive, windir, PROCESSOR_ARCHITECTURE, PROCESSOR_IDENTIFIER, NUMBER_OF_PROCESSORS, COMSPEC, TEMP, TMP, USERPROFILE, HOMEDRIVE, HOMEPATH, APPDATA, LOCALAPPDATA, USERNAME, COMPUTERNAME, PATHEXT, OS`. Everything else dropped (all API-key-shaped vars). PATH is set via `.env()` so program resolution uses our curated PATH first.
- R14. **Timeout: hand-roll `try_wait` + deadline polling (zero dep)** — NOT the wait-timeout crate (zero-dep consistency with #10; a 50ms poll against a 30s deadline is ample). On deadline: `kill()` the child, set `timedOut:true`, `exitCode:null`. **Direct-child kill only**; grandchild/tree-kill (Job Object + windows-sys) deferred to M4 — consistent with ADR 0002's accepted "no sandbox on Windows in v1".
- R15. **Output caps**: pipe stdout+stderr, read on separate threads (single-thread dual-read deadlocks), each capped at 1 MiB. Over cap → stop, `truncated:true`, kill child. Decode `String::from_utf8_lossy` (Windows console may be non-UTF-8). Defaults: 1 MiB/stream, 30 s timeout (later tunable via config).

Core tool (exec-core-tool.md):
- R16. **Input `{ command: z.string().min(1) }`** — bare string, single parse at the Shell boundary (argv would move security-relevant tokenization to the Core, wrong layer). Core tool is an opaque pass-through; all parsing is Shell-side.
- R17. **Wire `CapabilityErrorCode` union unchanged** (`DENIED|EXEC_FAILED|UNSUPPORTED_CAPABILITY`). Nonzero-exit + timeout + truncation ride in the Ok output struct (the model must read stderr/exitCode to reason). BLOCK / mode-deny / dialog-deny → `DENIED`. Spawn failure → `EXEC_FAILED`. No `BLOCKED`/`TIMED_OUT` code (message text differentiates).

## Capability inventory

Output schema (`ExecOutputSchema`, Option A opaque payload, mirrored Rust serde + golden fixture):
```
{ exitCode: int|null, stdout: string, stderr: string,
  truncated: bool, timedOut: bool, durationMs: int>=0 }
```
`stdout`/`stderr` are content — never logged (same treatment as clipboard text / screenshot data).

## Surface

- **shared**: `capability-outputs.ts` + Rust serde `ExecOutput` in `protocol.rs`; golden fixtures `exec-output.*.json` in BOTH sweeps (protocol-fixtures.test.ts + protocol.rs `reparse()`). Wire error union untouched.
- **core**: `capabilities/exec-tool.ts` (`createExecTool`, mirrors shell-open-tool: execute-never-throws, routes via `routeCapability(deps,"exec",input)`, parses `ExecOutputSchema`, command never logged). Wire at the same site as `createShellOpenTool` (grep it). Update `capabilities/index.md`.
- **shell**: `capabilities_impl/exec.rs` OR split `exec/parser.rs` + `exec/sandbox.rs` + `exec/policy.rs` (the parser test tables alone approach the size caps — split by the no-mod.rs / ≤100-line-fn / ≤500-line-file rules). New `gate.rs` `evaluate_exec` (Shape B) threading the command to the approver dialog AND the audit line (R9). New `exec-policy.rs` config loader (load-or-degrade-safe). Register: one `handlers.register(Arc::new(ExecExec))` + one `"exec"` vec entry in `lib.rs` (invariant 7). `//!` headers + index.md in every touched dir.

## AC mapping (issue #12)

- AC1 (exec only via Shell; no child_process in core) → R12/R16; core tool is pass-through, grep-assert no `child_process` in packages/core.
- AC2 (allowlist: simple auto-runs; chained/redirected/unparseable escalates) → R2/R7 + parser table.
- AC3 (blocklist rejected without prompt) → R2/R11.
- AC4 (env scrubbed; cwd=Workspace; timeout+caps) → R0/R13/R14/R15.
- AC5 (deny + full modes correct) → R7.
- AC6 (table-driven tests: every parser branch + every policy-mode decision) → the classifier + policy tables are the AC; each branch a distinct assertion that fails if the sieve flips.

## TDD focus (the AC is the tests)

- `classify()` table: SIMPLE (allowlisted `.exe`) / ESCALATE (each operator `;`&&`||`|`>`<`, backtick, `$()`, `%VAR%`, glob, quote-imbalance, shell-in-argv[0], `.bat`/`.cmd`, non-allowlisted) / BLOCK (each seed pattern, incl. one inside a chain to prove BLOCK-wins-order). Every branch fails-closed.
- policy table: each mode × {simple-allowlisted, simple-nonallowlisted, chained, blocked} → correct {auto, escalate, deny}.
- sandbox integration (real spawn, a manual-check line since it needs a real Windows process): a fast allowlisted exe runs + returns exit 0; a sleeper (`ping -n`/`timeout`) hits the timeout → `timedOut:true`, child killed; an over-producing command → `truncated:true`.
- gate: `evaluate_exec` ESCALATE→approver gets the command as detail; audit line for exec carries `command`, all others do not (extend the existing no-payload audit test).
- shared: `ExecOutputSchema` round-trip green in both vitest + cargo sweeps.

## Out of scope (deferred, not reserved)

Tree-kill / Job Object (M4); per-command approval memory (#23-era); keyboard/mouse sim + kill-process (ADR 0002); the exec-policy config UI (#23). Split-machine file-capability migration (ADR 0007 v1.5).
