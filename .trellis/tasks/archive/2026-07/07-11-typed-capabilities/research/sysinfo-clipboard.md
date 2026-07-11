# Research: process-list (sysinfo 0.39) + clipboard read/write (arboard 3.6)

- **Query**: sysinfo 0.39 read-only process snapshot API; arboard 3.6 clipboard get/set text on Windows; exact output shapes
- **Scope**: external (crate docs) + internal (seam fit)
- **Date**: 2026-07-11

## Verdicts (read first)

1. **process-list** — sysinfo 0.39: build ONE `System` with `System::new()`, call `refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_memory().with_cmd(UpdateKind::OnlyIfNotSet))`, then iterate `system.processes()`. Cheap fields (pid, name, parent, start_time) are ALWAYS present even with `nothing()`. Expensive/avoid: `cpu` (needs two samples + a sleep — skip for v1), `tasks` (Linux-only cost; call `.without_tasks()` if you ever use `everything()`), `environ`/`exe`/`root`/`user` (extra syscalls — leave off). **There is NO kill in our surface** — `Process::kill()` exists in the crate but we simply never call it and never expose it. The executor is read-only by construction.
2. **clipboard** — arboard 3.6: `Clipboard::new()?` then `get_text()` / `set_text(s)`. On Windows arboard opens the global clipboard only for the duration of each op, so the **create-use-drop** pattern is correct and expected (do NOT hold a long-lived `Clipboard`; that is the Linux pattern). Scope v1 to **text only** (image adds `ImageData`/RGBA handling and a `png` dep — defer). Known Windows flake (locale/encoding) was FIXED in 3.6.0 (PR #188) — our pin `3.6` is exactly the version that carries the fix.
3. **CapabilityOutput must generalize** — both capabilities return shapes unlike screenshot's `{mediaType,dataBase64,width,height}`. See `capability-tiers.md` and the leader-decision list below.

## Findings

### sysinfo 0.39 — read-only process snapshot

**Crate not yet in Cargo.toml** (`apps/desktop/src-tauri/Cargo.toml:16-26` has xcap/keyring/tauri but no sysinfo). `CLAUDE.md` pins `sysinfo 0.39`. Add `sysinfo = "0.39"`.

**API shape (0.39, post the big `refresh_processes` redesign):**
- Construct once: `let mut sys = System::new();` — the crate strongly recommends a single long-lived `System` instance; per-request construction works but re-allocates the process list each call. For a gated, on-demand capability that latency is acceptable; a long-lived instance behind a `Mutex` is an optimization, not required. (docs.rs/crate/sysinfo — "instantiate the System struct once… almost all the time better".)
- Refresh: `sys.refresh_processes_specifics(ProcessesToUpdate::All, remove_dead: true, ProcessRefreshKind)`.
  - `System::refresh_process` / `refresh_pids` were **removed** in the redesign; `refresh_processes*` now takes a `ProcessesToUpdate` arg (migration_guide.md, docs.rs/crate/sysinfo/latest/source/migration_guide.md).
  - `ProcessesToUpdate::All` = every process; `::Some(&[pid])` = a subset. We want `All`.
  - The `bool` second arg tells sysinfo whether to drop processes that died since the last refresh; `true` keeps the snapshot clean.
- `ProcessRefreshKind` selectors (docs.rs `ProcessRefreshKind`): `nothing()` (all false), `everything()` (all true). Builder `.with_cmd(UpdateKind)`, `.with_cpu()`, `.with_memory()`, `.with_exe(UpdateKind)`, `.with_environ`, `.with_user`, `.with_disk_usage`, plus `.without_cpu()` / `.without_tasks()`.
- `UpdateKind` enum: `Never | Always | OnlyIfNotSet` — use `OnlyIfNotSet` for `cmd` so a re-refresh doesn't re-fetch.

**What's cheap vs expensive** (docs.rs `ProcessRefreshKind`, x86_64-pc-windows-msvc page): even with all refreshes ruled out, a `Process` STILL carries: **Pid, parent Pid, name, start_time**. So a truly minimal snapshot (`ProcessRefreshKind::nothing()`) already gives pid/name/parent/start_time for free. `memory` and `cmd` are the two useful adds for a "what's running" list; `cpu` requires a prior sample + `MINIMUM_CPU_UPDATE_INTERVAL` sleep to be non-zero → **skip cpu in v1** (a single-shot snapshot reports 0.0 anyway).

**Recommended refresh for v1:**
```rust
sys.refresh_processes_specifics(
    ProcessesToUpdate::All,
    true,
    ProcessRefreshKind::nothing().with_memory().with_cmd(UpdateKind::OnlyIfNotSet),
);
```

**`Process` accessors** (docs.rs `Process`, windows-msvc page):
| Method | Type | Notes |
|---|---|---|
| `pid()` | `Pid` | `Pid` is a newtype; `pid.as_u32()` or `to_string()` for the wire |
| `name()` | `&OsStr` | 0.39 returns `OsStr` (was `&str` in old versions) → `.to_string_lossy()` |
| `cmd()` | `&[OsString]` | full argv; each element `OsString` → lossy-string; can be large/sensitive |
| `exe()` | `Option<&Path>` | only if `.with_exe` requested |
| `memory()` | `u64` | **bytes** in modern sysinfo (the old KiB confusion, issue #239/#428, was resolved; 0.39 doc says "in bytes") |
| `virtual_memory()` | `u64` | bytes |
| `parent()` | `Option<Pid>` | on Windows never changes after start |
| `status()` | `ProcessStatus` | enum; `Display`-able |
| `start_time()` | `u64` | seconds since epoch |
| `cpu_usage()` | `f32` | 0.0 without a second sample — omit for v1 |

**Read-only guarantee**: `Process::kill()` / `kill_with()` exist on the type but are never invoked and never surfaced. The capability constructs the snapshot and serializes selected fields — there is no mutation path. (ADR 0002 line 11: "kill-process… not [a] capabilit[y] in v1".)

**Cost caveat**: `cmd()` (full argv) and `exe()` can leak paths/args (a browser tab URL sometimes lands in argv). Sensitivity: this is why process-list is a **Medium tier / always-ask** capability (see `capability-tiers.md`). Consider returning name+pid+memory only, and gating cmd behind a future flag — flag for leader.

### arboard 3.6 — clipboard text read/write

**Crate not yet in Cargo.toml.** `CLAUDE.md` pins `arboard 3.6`. Add `arboard = "3.6"`.

**API (docs.rs `Clipboard`):**
```rust
let mut cb = arboard::Clipboard::new()?;      // Result<Clipboard, arboard::Error>
let text: String = cb.get_text()?;            // Err if empty or non-UTF8 text
cb.set_text("hello")?;                        // T: Into<Cow<'a,str>>
```
- `get_text(&mut self) -> Result<String, Error>` — "Returns error if clipboard is empty or contents are not UTF-8 text." So **empty clipboard is an Err, not an empty string** — the executor must map "empty" to either an empty-string success or a structured EXEC_FAILED. Recommend: treat the empty/no-text case as a successful read of `""` OR a distinct `code` the model understands; decide in leader list.
- `set_text` returns `Err` only if storing failed.

**Windows threading/lifetime (docs.rs lib.rs source, lines 61-68; issue #88):**
- "The clipboard on Windows is a global object, which may only be opened on one thread at once. arboard only truly opens the clipboard during each operation." → **create → op → drop**, all within the single blocking `run()` call. This fits our model perfectly: `CapabilityExec::run` is already blocking and run off-reactor via `spawn_blocking` (`ws_client.rs:160`). Construct the `Clipboard` locally in `run`, use it, let it drop — no shared state, no main-thread requirement.
- "attempting operations in parallel has a high likelihood to return an error or deadlock… avoid creating/operating clipboard objects on >1 thread." → Our gate serializes capability execution on a spawn_blocking worker; there is no parallel clipboard access. Safe.
- The Linux "keep Clipboard alive to serve paste requests" caveat does NOT apply to Windows (Windows copies eagerly to the OS). Since `packages/core`/`shared` must be OS-neutral but the **Shell is Windows-only** (`CLAUDE.md` invariant 8 — arboard lives in `apps/desktop`, fine), we only need the Windows behavior for v1. The Ubuntu-VPS topology has no desktop clipboard anyway.
- Version note: get_text Windows locale bug (#107) fixed in **3.6.0** (PR #188, Jun 2025) — the `3.6` pin includes it.

**Error surface**: `arboard::Error` variants include `ClipboardNotSupported`, `ClipboardOccupied`, `ContentNotAvailable` (empty/wrong type), `ConversionFailure`, `Unknown{...}`. Map all to `ExecError::failed(err.to_string())` → wire `EXEC_FAILED`, mirroring `screenshot.rs`'s `.map_err(|e| ExecError::failed(e.to_string()))`.

### Exact output shapes to return over the capability channel

The current `CapabilityOutput` (`protocol.rs:122-131`, `capability-schema.ts:25-31`) is **screenshot-specific** and cannot carry these. Proposed per-capability outputs (see `capability-tiers.md` for the union-vs-per-capability decision):

**process-list output:**
```jsonc
{
  "processes": [
    { "pid": 1234, "name": "chrome.exe", "parentPid": 88, "memoryBytes": 154820608,
      "startTime": 1720000000, "cmd": ["chrome.exe", "--type=renderer"] }
  ],
  "count": 312
}
```
Text-model-friendly: a JSON array the LLM reads directly. `cmd` optional/omittable for privacy. Numbers as JSON numbers (memory can exceed 2^32 → must be `u64`/`z.number()` not `u32`).

**clipboard-read output:**
```jsonc
{ "text": "the clipboard contents" }   // empty string when clipboard has no text (see empty-case decision)
```

**clipboard-write output (ack):**
```jsonc
{ "ok": true }   // or an empty object; write has no return payload
```
Note: clipboard-write's **input** carries `{ "text": "..." }` — that input is content and, like screenshot input, must never enter a core log (`capability-broker.ts:72` already treats `input` as content).

## Related Specs / code

- `apps/desktop/src-tauri/src/capabilities_impl.rs:28-31` — `CapabilityExec` trait each new exec implements.
- `apps/desktop/src-tauri/src/capabilities_impl/screenshot.rs` — the reference exec (blocking `run`, `.map_err(ExecError::failed)`).
- `apps/desktop/src-tauri/src/lib.rs:88-96` — register site (`handlers.register(Arc::new(...))`) + the `capabilities: vec!["screenshot"]` declared-capabilities list the node advertises; each new capability adds one string here + one register call.
- `packages/core/src/capabilities/screenshot-tool.ts` — the core-side tool pattern each capability mirrors (route→broker→shape result).

## Caveats / Not Found

- Did NOT run a cargo build to empirically confirm signatures (host recently OOM'd; guidance said avoid heavy builds). All signatures are from docs.rs for the pinned major/minor. `name()` returning `&OsStr` (vs old `&str`) and `cmd()` returning `&[OsString]` are the two signature changes most likely to bite — **confirm against `node_modules`-equivalent (`cargo doc` / rust-analyzer) once the dep is added.**
- `memory()` unit as **bytes** is asserted from the current docs.rs wording; the historical KiB/KB confusion (#239, #428) predates the redesign. Verify empirically when implementing (compare one process against Task Manager).
- arboard image support deliberately un-researched (out of v1 scope).

## Leader decisions needed

1. **process-list fields**: include `cmd` (full argv, can leak URLs/tokens) in v1, or name+pid+memory+parent only? Recommendation: exclude `cmd` by default; it pushes the tier from Medium to High.
2. **clipboard empty read**: map an empty/no-text clipboard to `{text:""}` success, or to a structured `EXEC_FAILED`/distinct code? Recommendation: `{text:""}` success (a model asking "what's on the clipboard" gets a clean "nothing").
3. **long-lived `System` vs per-request**: hold one `System` behind a `Mutex` in the exec (faster, but state), or `System::new()` per call (simpler, stateless, matches screenshot's stateless exec)? Recommendation: per-call for v1 (KISS; matches the stateless exec pattern), revisit if latency shows.
4. **Output shape** — depends on the `CapabilityOutput` generalization decided in `capability-tiers.md` / `workspace-files.md`.
