# Research: shell-open capability (launch URL / file / app on Windows)

- **Query**: how to launch a URL/file/app on Windows safely; tauri-plugin-opener vs `open` crate vs std; argument-injection defense; input schema; gate tier
- **Scope**: external (crate docs + tauri source) + internal (invariant fit)
- **Date**: 2026-07-11

## Verdicts (read first)

1. **Use `tauri-plugin-opener` 2.x**, and specifically its **free functions** `tauri_plugin_opener::open_url(url, with)` and `open_path(path, with)` — they do NOT require an `AppHandle` (`pub use open::{open_path, open_url}`, docs.rs source). This keeps the shell-open exec matching the `CapabilityExec::run(&self, input) -> ...` signature with no Tauri handle threaded in, exactly like `ScreenshotExec`. Pass `with: None::<&str>` to use the system default app.
2. **This is legitimate under invariant 1**: the Shell (Rust) is *allowed* to touch the OS; only the Core is forbidden. shell-open living in `apps/desktop/src-tauri` is correct. It is NOT the general `exec` capability (ADR 0002) — it is a typed, structured launch.
3. **Argument-injection is avoided because opener does NOT go through a shell.** On Windows it uses `ShellExecuteW` (the OS "open verb"), not `cmd.exe /c` — so there is no shell metacharacter interpolation. The target string is passed as a single opaque argument to the Win32 API, not parsed by a command interpreter. (See evidence below.) The residual risk is *semantic* (what gets launched), not *injection* (extra commands) — mitigated by the gate + input validation, not by quoting.
4. **shell-open is HIGH tier / always-ask** (arbitrary launch = arbitrary code execution surface). See `capability-tiers.md`.
5. **Input schema**: prefer an explicit discriminated `{ kind: "url" | "path", target: string }` over a bare string, so the exec routes to `open_url` vs `open_path` deliberately (and can validate each differently) rather than guessing. Flag for leader.

## Findings

### Option comparison

| Option | Pinned? | AppHandle needed? | Windows launcher | Verdict |
|---|---|---|---|---|
| `tauri-plugin-opener` free fns (`open_url`/`open_path`) | NOT pinned in CLAUDE.md, but Tauri-official and we already depend on `tauri-plugin-dialog` | **No** (free fns) | `ShellExecuteW` (via the vendored `open`-style windows module) | **Chosen** |
| `tauri-plugin-opener` `Opener` via `OpenerExt` (`app.opener().open_url`) | same | Yes (needs `AppHandle`) | same | Rejected — needs a handle the exec doesn't hold; also subject to the JS-side scope config we don't want to fight |
| `open` crate (Byron/open-rs) | no | no | historically `cmd /c start`, migrated to `ShellExecuteW` for detached (PR #91, Feb 2024) | Viable fallback, but a separate dep; opener wraps it and is the Tauri-blessed path |
| `std::process::Command` + `cmd /c start` | n/a | no | **cmd.exe — SHELL INTERPOLATION RISK** | **Rejected** — `start` parses metacharacters; injection-prone; also `start` treats the first quoted arg as a window title (classic footgun) |

### Why opener is injection-safe on Windows

The tauri opener plugin's Windows path invokes **`ShellExecuteW`** (the Win32 "open this thing with its default handler" call), not a command shell. Evidence chain:
- tauri-plugin-opener wraps the `open` crate for the default-program path; the plugin's `open::open(target, with)` is the free-fn entry (`docs.rs/tauri-plugin-opener` source: `pub use open::{open_path, open_url}` and `crate::open::open(url.into(), ...)`).
- The tauri team explicitly switched the Windows implementation to `ShellExecuteW` (GitHub tauri-apps/plugins-workspace #1003 discussion + Byron/open-rs PR #91 "feat: use ShellExecuteW for detached spawning on Windows", Feb 2024). Quote from the thread: *"I will switch our windows implementation to use ShellExecuteW and keep using open-rs on other platforms."*
- `ShellExecuteW(NULL, "open", target, NULL, NULL, SW_SHOWNORMAL)` passes `target` as a single wide-string operand to the shell namespace resolver. There is no argv tokenization, no `cmd.exe`, no `&`/`|`/`;`/`%VAR%` expansion. A target like `http://x & calc` is treated as one (invalid) URL, not "open x, then run calc".

**Contrast with the thing to avoid**: `Command::new("cmd").args(["/c","start",target])` runs the *command interpreter*, which DOES expand `&`, `|`, `^`, `%…%`, and mis-handles quoting/window-title — a real injection vector. Do not build shell-open on `cmd /c start`.

### Residual risk & required validation (this is what the gate + exec must handle)

`ShellExecuteW` removes *injection*, but shell-open is still **launch-arbitrary-thing**, which is inherently high-power:
- A `path` target could be `C:\Windows\System32\cmd.exe` or a `.bat`/`.ps1`/`.exe` — opening it *runs* it. shell-open is therefore functionally an exec surface for anything with a default "open→run" handler.
- A `url` target could be a custom protocol handler (`ms-…:`, `file://`, a registered app scheme) that triggers an installed app with attacker-influenced parameters.
- Recommended exec-side validation (defense in depth, not a substitute for the gate):
  - For `kind:"url"`: parse and require an allowed scheme set (`http`, `https`, `mailto` at minimum; reject `file`, `javascript`, and by default unknown custom schemes) — flag the scheme allowlist for leader.
  - For `kind:"path"`: this overlaps Workspace-files' concern. Decide whether shell-open-path is confined to the Workspace (safer) or may open anywhere (more useful, higher risk). Given it can launch executables, recommend **gate always-ask with the resolved target shown in the dialog** rather than a path allowlist. Flag for leader.
- The approval dialog currently shows only the capability name (`approver.rs:78` — "The agent wants to use: {capability}"). For shell-open the user really needs to see *what* is being opened. The dialog does not currently receive the input/target. **This is a real gap** — flag for leader (either enrich the dialog with the target, or accept name-only approval for v1).

### Input schema options

- **A (recommended)**: `z.object({ kind: z.enum(["url","path"]), target: z.string().min(1) })`. Exec matches on `kind` → `open_url` vs `open_path`. Enables per-kind validation (scheme allowlist vs path confinement). Rust mirror: `#[serde(tag="kind", rename_all="lowercase")] enum ShellOpenInput { Url{target}, Path{target} }` or a struct with a `kind` enum field.
- **B**: bare `z.object({ target: z.string() })` and heuristically detect URL vs path. Rejected — heuristic misclassification is a security smell; be explicit.
- No `with`/app-override field in v1 (do not let the agent choose the launching program — always system default). `open_url(target, None::<&str>)`.

### Output shape

shell-open has no meaningful return payload — it's an **ack**:
```jsonc
{ "ok": true, "opened": "https://example.com" }   // echo the target for the model/audit; or just {}
```
Text-model-friendly: a one-line confirmation. On failure → `EXEC_FAILED` via the normal `ExecError` path. Note `ShellExecuteW` success only means "the handler was invoked", not "the app did something useful" — the ack cannot promise more.

### Dependency to add

`apps/desktop/src-tauri/Cargo.toml`: add `tauri-plugin-opener = "2"` (README: MSRV 1.71.x, fine vs our 1.88). NOTE: the **free functions** `open_url`/`open_path` work without registering the plugin in the builder (they don't need the managed `Opener` state). Registering `.plugin(tauri_plugin_opener::init())` is only needed for the JS bindings / `app.opener()` extension — the Pet UI does not need it for this capability, so the Rust exec can call the free fns directly. Confirm empirically that the free fns are exported and callable without `init()` (they are `pub use`d at crate root per the source).

## Related code

- `apps/desktop/src-tauri/src/capabilities_impl/screenshot.rs` — the stateless exec pattern shell-open mirrors (no AppHandle, blocking `run`).
- `apps/desktop/src-tauri/src/gate/approver.rs:78` — the dialog that currently shows only the capability name (the shell-open target-visibility gap).
- `docs/adr/0002-exec-in-v1-behind-permission-gate.md:10` — typed actions (screenshot, process list, clipboard) do NOT go through exec; shell-open is the same class of typed capability.
- `CONTEXT.md:43-44` — Capability glossary lists shell-open explicitly.

## Caveats / Not Found

- Did NOT compile a probe against `tauri-plugin-opener` (avoid heavy build per guidance). The free-fn export (`pub use open::{open_path, open_url}`) and `ShellExecuteW` backing are from docs.rs source + the tauri-apps/open-rs issue threads — **confirm the exact free-fn path and that it needs no `init()`** when implementing.
- Exact `tauri-plugin-opener` version compatible with our `tauri = 2.11` not pinned down to a patch; use `"2"` and let cargo resolve, then record the resolved version.
- Custom-scheme threat surface (registered protocol handlers) is noted but not exhaustively enumerated.

## Leader decisions needed

1. **Input schema**: explicit `{kind,target}` (recommended) vs bare `{target}` with heuristic detection?
2. **URL scheme allowlist**: which schemes are auto-permitted at the exec layer (recommend http/https/mailto), and are others hard-rejected or just gated?
3. **path confinement**: may shell-open-path open ANY path (high power — can launch executables) or only Workspace-confined paths? Interacts with `workspace-files.md`.
4. **Dialog target visibility**: enrich the approval dialog to show the actual target for shell-open (needs the input plumbed into the approver — a change to `approver.rs`/`Gate::evaluate` signature), or accept name-only approval for v1? This is the biggest security-UX gap.
5. **Plugin registration**: rely on the free fns without `.plugin(tauri_plugin_opener::init())` (recommended, less surface), confirmed at implement time.
