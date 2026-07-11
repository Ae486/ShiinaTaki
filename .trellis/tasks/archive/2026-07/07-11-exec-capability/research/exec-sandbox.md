# Research: exec child-process sandbox (spawn, cwd, env, timeout, output caps)

- **Query**: How exec spawns the child — argv-no-shell model, cwd on a Shell≠Core machine, env scrubbing, timeout that kills the tree, output caps
- **Scope**: mixed (ADR 0002 + std/tokio/wait-timeout docs + CVE advisories + #10 precedents)
- **Date**: 2026-07-11

## Verdict (read first)

1. **Spawn model: `std::process::Command` with an explicit argv, NO shell.** The parser (exec-parser.md) has already split the command into `[program, args…]` and refused anything shell-meaningful. Spawning through `cmd /c` or `powershell -c` would re-introduce the entire injection surface we just parsed away — do NOT do it. This is the same reasoning shell_open uses (`open_url`/`open_path` "never go through a shell, so there is no argument-injection surface"). Confirmed correct; a shell is NOT unavoidable for our use case because we deliberately refuse shell-only constructs rather than support them.
2. **cwd is a genuine architecture problem, not a config value.** ADR 0002 says "cwd defaulting to the Workspace", but the Workspace is **Core-side** (`%USERPROFILE%\.takiagent\workspace`, invariant 2 — Core is its only writer) and exec runs **Shell-side**. On the v1 single-machine desktop they coincide; on the v1.5 VPS topology (invariant 8: Core on Ubuntu VPS, Shell on the user's Windows box) **the Shell's machine has no Core Workspace at all.** exec's cwd must therefore be a **Shell-owned directory**, not the Core Workspace. Recommend a Shell-side exec working dir under `app_data_dir()` (the same Shell-owned root gate-decisions.json and audit.jsonl already use). **Flag prominently — this contradicts a literal reading of the ADR and needs a leader/user ruling.**
3. **Env scrubbing: allowlist, not blocklist.** Start from an EMPTY environment and copy in only a curated safe set, exactly as `@ai-sdk/mcp` does for its stdio transport (installed precedent, below). A blocklist of "secret-looking" vars is unwinnable. The minimal Windows-safe set is small and known.
4. **Timeout that KILLS: use `wait-timeout` 0.2.1 (`Child::wait_timeout` → `kill()` on `None`) for the std-blocking model, OR tokio `Command` + `tokio::time::timeout` + `child.kill()`.** Given exec runs off the async reactor via `spawn_blocking` (the established capability pattern), the **synchronous `wait-timeout` path is the simpler fit** — no new async machinery in a blocking `run()`. BUT plain `kill()` only kills the direct child, not its descendants. For true tree-kill on Windows you need a **Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** (the mechanism cargo itself uses). Flag the tree-kill gap as a scope decision.
5. **Output caps: read stdout/stderr with a hard byte ceiling, mark truncated, and kill on overflow.** Output shape `{ exitCode, stdout, stderr, truncated, timedOut, durationMs }` per the task.

## Findings

### The spawn model (confirmed: argv, no shell)

- Prior art `apps/desktop/src-tauri/src/capabilities_impl/shell_open.rs:14-16` — its whole safety argument is "no shell → no injection." exec inherits this: the classifier produces argv, `Command::new(argv[0]).args(&argv[1..])` passes them as-is (documented: args are passed to the spawned process without shell evaluation).
- The ONE residual injection risk on Windows even with clean argv is **batch files** (`.bat`/`.cmd`): invoking one makes the std library hand your args to cmd.exe's own splitter, which was exploitable (CVE-2024-24576, incompletely fixed then re-fixed in CVE-2024-43402 / Rust 1.81; host is 1.97 so the mitigation is present, but the mitigation is `Command` returning `InvalidInput` on un-escapable args, i.e. a spawn *failure*, not safe execution). **Conclusion: exec must refuse batch-file targets at the parser (exec-parser.md decision 3), so this surface never reaches the spawn.**
- `.run()` is blocking (screen capture / launch precedent). exec's `run()` stays blocking and is invoked via `tauri::async_runtime::spawn_blocking` in `ws_client.rs:160` — no change to the dispatch path needed.

### cwd — the load-bearing open question

| Fact | Source |
|---|---|
| Workspace = `%USERPROFILE%\.takiagent\workspace`, Core-side, Core is the ONLY writer | CONTEXT.md (Workspace glossary); CLAUDE.md invariant 2 |
| workspace-files capability runs **Core-side TS**, explicitly NOT a Shell capability, precisely because "VPS 拓扑下 Shell 异机——文件能力若在 Shell 侧会读错文件系统" | `docs/devlog/m3.md` Issue #11 ruling (1) |
| exec runs **Shell-side** (it spawns processes; invariant 1: Core never spawns) | ADR 0002; CLAUDE.md invariant 1 |
| Shell already owns a data dir outside the Workspace: `handle.path().app_data_dir()` | `apps/desktop/src-tauri/src/lib.rs:81` (comment: "Shell-owned, outside the Workspace by construction") |

The tension: #11 deliberately kept file activity Core-side so it hits the right filesystem on a split-machine deployment. exec is the mirror case — it MUST be Shell-side (only the Shell spawns), so its cwd cannot be the Core Workspace on a VPS split. **Recommendation:** exec's cwd is a Shell-owned directory (e.g. `app_data_dir()/exec-cwd` or the Shell user's home), configurable later via #23 operator config. On the single-machine desktop this can be made to coincide with the Workspace if the user wants, but the DEFAULT and the invariant-safe choice is Shell-local. This is a real semantic divergence from the ADR's wording and needs a ruling.

### Env scrubbing — allowlist (installed precedent)

The AI SDK's MCP stdio transport already solves exactly this problem for child processes and is the precedent #11's task pointer references. Installed at `node_modules/.pnpm/@ai-sdk+mcp@2.0.10/…/mcp-stdio/get-environment.ts:10-25`:

```
DEFAULT_INHERITED_ENV_VARS (win32) = [
  APPDATA, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH,
  PROCESSOR_ARCHITECTURE, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE ]
```
It starts from `customEnv ?? {}` and copies ONLY those keys from `process.env`, skipping any value starting with `()` (a bash-function-export smuggling guard). This is the exact allowlist model to mirror in Rust for exec.

**Proposed exec Windows-minimal safe env set** (start from empty, copy from the Shell's env):
`PATH`, `SystemRoot`, `SystemDrive`, `windir`, `PROCESSOR_ARCHITECTURE`, `PROCESSOR_IDENTIFIER`, `NUMBER_OF_PROCESSORS`, `COMSPEC`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `USERNAME`, `COMPUTERNAME`, `PATHEXT`, `OS`.
Deliberately EXCLUDED: everything else — API-key-shaped vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_*`, `GH_TOKEN`, …), `USERDOMAIN` (optional), and anything the operator's shell injected. ADR 0002: "scrubbed env (no API keys)."

**PATH interaction with resolution (from exec-parser.md):** on Windows, `std::process::Command` searches the child's PATH first ONLY if PATH was set via `.env()`. Since we build the env explicitly (allowlist), we WILL be setting PATH via `.env()`, so program resolution uses our curated PATH first — which is what we want (deterministic, Shell-controlled). Note the historic quirk (rust-lang/rust #122660): the system dir can still shadow PATH for some names; not security-critical here because argv[0] is allowlisted, but worth a test.

**Flag:** the exact safe-env set is a leader decision. The allowlist *approach* is not in question (it mirrors the SDK); the *contents* (e.g. do we pass `USERPROFILE`? it reveals the username) are.

### Timeout — mechanism comparison

| Mechanism | Kills child? | Kills tree? | Fit |
|---|---|---|---|
| `wait-timeout` 0.2.1 `Child::wait_timeout(dur)` → on `Ok(None)` call `child.kill(); child.wait()` | Yes (direct child) | No | **Best fit for our blocking `run()`.** Windows impl is a trivial `WaitForSingleObject` with timeout (per crate docs). Synchronous, no reactor. Alex Crichton's crate, stable 0.2.1 (2025-02-03). |
| tokio `Command` + `tokio::time::timeout(dur, child.wait())` + `child.kill().await` | Yes | No | Requires making `run()` async or driving a runtime inside spawn_blocking — friction against the established blocking-capability pattern. Also `kill_on_drop` only covers the direct child. |
| manual thread + `child.kill()` | Yes | No | Reinvents wait-timeout; no reason. |
| **Job Object + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** | Yes | **Yes (whole tree)** | The only tree-killing option on Windows (used by cargo's `util/job.rs` for exactly this). Requires `windows-sys` (a NEW crate outside the pinned set) OR raw FFI. Heavier. |

**Recommendation:** v1 = `wait-timeout` for the timeout + kill of the direct child, shape `timedOut: true` when the deadline fires. Treat **grandchild/tree-kill as a known limitation** (consistent with ADR 0002's already-accepted "no sandbox on Windows in v1" stance — blast-radius control is the rules + audit, not containment). If the leader wants tree-kill in v1, it means adding `windows-sys` + a Job Object (a real scope bump — flag). The `processkit` crate exists and gives kernel-backed no-orphan tree-kill via Job Objects, but it is async-first and a new dep; note it as the M4 hardening option, not v1.

### Output caps

- Pipe stdout+stderr (`Stdio::piped()`), read on separate threads (a single-thread read of both can deadlock if one buffer fills), each with a hard byte ceiling (propose 1 MiB each, tunable). On exceeding the cap: stop reading, set `truncated: true`, and kill the child (an over-producing command is itself a signal).
- A child that produces output forever but slowly is caught by the timeout; a child that floods is caught by the cap. Both must be present.
- Decode bytes to UTF-8 lossily for the model (`String::from_utf8_lossy`) — the model gets text, and Windows console output may be non-UTF-8 (codepage). Record that lossiness is acceptable (the model reads it, we don't round-trip it).

### Output shape (matches the task)

```
{ exitCode: i32|null,   // null if killed before exit (timedOut / cap-kill)
  stdout: string,       // UTF-8 lossy, truncated to cap
  stderr: string,
  truncated: bool,
  timedOut: bool,
  durationMs: number }
```
Mirror as a Rust serde struct + a zod schema in `@taki/shared/capability-outputs.ts` (Option A opaque payload — same as ScreenshotOutput etc.). See exec-core-tool.md for the error-code question (does a nonzero exit surface as an error or as this struct with `ok:true`).

### External References

- `std::process::Command` — https://doc.rust-lang.org/std/process/struct.Command.html — argv passed without shell; Windows resolution order; `.env()`/PATH coupling.
- `wait-timeout` 0.2.1 — https://docs.rs/wait-timeout — `ChildExt::wait_timeout`; Windows = `WaitForSingleObject`; canonical kill-on-timeout example.
- tokio `process::Child` — https://docs.rs/tokio/latest/tokio/process/struct.Child.html — `kill_on_drop`, `start_kill`, best-effort reaping (direct child only).
- Job Objects for tree-kill — cargo `util/job.rs` (https://doc.rust-lang.org/stable/nightly-rustc/src/cargo/util/job.rs.html) + "Old New Thing" (https://devblogs.microsoft.com/oldnewthing/20131209-00/) — `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; `processkit` crate (https://github.com/ZelAnton/ProcessKit-rs) as the ready-made async option.
- CVE-2024-24576 / CVE-2024-43402 — https://blog.rust-lang.org/2024/04/09/cve-2024-24576/ — batch-file arg injection; mitigation is a spawn *error*, reinforcing the parser-level BLOCK.
- `@ai-sdk/mcp` env allowlist — installed `node_modules/.pnpm/@ai-sdk+mcp@2.0.10/…/mcp-stdio/get-environment.ts:10-39` — the Windows safe-env allowlist precedent.
- Shell-owned data dir — `apps/desktop/src-tauri/src/lib.rs:81` — `app_data_dir()`, "outside the Workspace by construction."

## Caveats / Not Found

- I did not compile/run a spawn probe (host build constraints). All spawn/timeout/env behavior is from official std/tokio/crate docs, which are explicit for the paths above. Implement-time should pin: (a) that `.env()`-set PATH drives resolution, (b) that `wait_timeout` + `kill` actually reaps on Windows, with a real integration test (`ping -n`/`timeout` as a sleep proxy) — an appropriate manual-check line since it needs a real Windows spawn.
- Tree-kill on Windows without `windows-sys` is not achievable via std alone; the accurate statement is "v1 kills the direct child, grandchildren may survive." Whether that is acceptable is a leader call tied to the ADR's already-accepted no-sandbox limitation.

## Leader decisions needed

1. **exec cwd on a Shell≠Core machine** — recommend a Shell-owned dir (under `app_data_dir()`), NOT the Core Workspace, to stay invariant-8-safe. Contradicts the ADR's literal "Workspace cwd." **(One of the three the task flags as most likely to need the user.)**
2. **Env safe-set exact contents** — allowlist approach settled (mirrors `@ai-sdk/mcp`); confirm the specific Windows keys (esp. whether `USERPROFILE`/`USERNAME`/`COMPUTERNAME` are in, given they leak identity).
3. **Timeout mechanism** — recommend `wait-timeout` 0.2.1 (new dev-light dep) for direct-child kill; confirm accepting it vs hand-rolling thread+kill to keep zero new deps.
4. **Tree-kill scope** — v1 kills direct child only (consistent with the ADR's accepted no-sandbox limitation) vs add `windows-sys` + Job Object now. Recommend defer to M4.
5. **Cap + timeout default values** — propose 1 MiB/stream and (e.g.) 30 s; user-tunable later. Confirm defaults.
