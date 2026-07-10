# Research: Permission Gate, JSONL audit, keyring 4, xcap screenshot, image-to-model

- **Query**: gate policy/decision persistence design inputs; JSONL audit append; keyring 4.1 on Windows; xcap 0.9 capture + PNG + returning an image over JSON-RPC; what AI SDK v7 tool results support for images; what the agent does with the image given a text-only model
- **Scope**: mixed (installed crate sources — probe compiled clean; installed ai@7.0.17 d.ts; ADRs/issue)
- **Date**: 2026-07-10

## Verdicts (first)

1. **keyring 4.x is a re-architecture**: the crate is now a thin façade over `keyring-core` + per-OS store crates. With the default `v1` feature, the classic API survives: `Entry::new(service, user) -> Result<Entry>`, `set_password`, `get_password`, `set_secret/get_secret`, `delete_credential`. On Windows it auto-installs `windows_native_keyring_store::Store` (Credential Manager) on first `Entry::new`. Probe compiled clean. Missing entry surfaces as `keyring::Error::NoEntry` — map to `Ok(None)` behind our trait.
2. **xcap 0.9**: `Monitor::all() -> XCapResult<Vec<Monitor>>`, `monitor.capture_image() -> XCapResult<RgbaImage>`, plus `is_primary()`, `width()/height()/scale_factor()`. xcap **re-exports the `image` crate (0.25.10 in the locked tree)** — PNG encode is `img.write_to(&mut Cursor::new(Vec::new()), ImageFormat::Png)`. Probe compiled clean.
3. **Image size is a non-issue on the wire**: 1080p PNG ≈ 1-3 MB → base64 ≈ 1.4-4 MB, far under tungstenite's 64 MiB inbound cap and `ws`'s 100 MiB server cap (see rust-ws-protocol.md). Base64-in-JSON on a text frame is the simplest correct transport for v1.
4. **AI SDK 7.0.17 CAN hand an image to a model**: a tool's `toModelOutput` maps the execute result to `ToolResultOutput`, whose `type:'content'` variant accepts `{type:'file', data: {type:'data', data: <base64|Uint8Array|...>}, mediaType:'image/png'}` (installed `@ai-sdk/provider-utils@5.0.5/dist/index.d.ts:294-380`, referenced by `Tool.toModelOutput` at `:1719`). Without `toModelOutput`, the execute return is serialized as JSON — a base64 blob would waste ~2M tokens. **BUT deepseek-v4-flash is text-only**, so v1 cannot feed the image to the model regardless → the agent-visible result must be text. **Neither issue #10 nor any ADR decides what that text is** — flagged as D8 (leader).
5. **JSONL audit: use std fs with `OpenOptions::append(true)`**, one `write_all` per line. On Windows append mode uses `FILE_APPEND_DATA`, and a single small `write_all` (<4 KiB line) is effectively atomic for a single-writer process; we HAVE a single writer (the gate). tokio::fs buys nothing here (each append is tiny/rare) and complicates ordering; do the append via `spawn_blocking` if called from async. Audit fields per issue AC: `ts` (ISO-8601), `requestId`, `capability`, `decision` (`allowed-once|allowed-session|allowed-always|denied|auto-allowed|auto-denied`), NO payload content — matches the #8 rule "core logs get names only" (`approval-broker.ts:66`).
6. **Decision persistence mirrors the TS decision-store** (`packages/core/src/approval/decision-store.ts`): once → not stored; session → in-memory map (dies with the process — for a node, "session" naturally means until disconnect/process end); always/deny-always → persisted JSON file written atomically (tmp + rename), malformed file = warn + empty (re-askable, NOT fatal — the codified corruption asymmetry: auth state fatal, approvals warn+degrade).

## Findings

### keyring 4.1.4 (installed source)

- `keyring-4.1.4/src/lib.rs:33`: `compile_error!` unless feature `v1` or `cli`; **default = `v1`** (Cargo.toml `[features] default = ["v1"]`).
- `v1` pulls per-OS stores: Windows → `windows-native-keyring-store` (Credential Manager), macOS → keychain, *nix → zbus secret-service (`v1.rs:96-108`) — the per-OS dispatch is inside the crate, which ALREADY satisfies "behind a per-OS backend" at the crate level; our own trait seam is still wanted for testing (mock store) and for the core-side Ubuntu story later.
- API (`keyring-4.1.4/src/v1.rs`): `Entry::new(service: &str, username: &str) -> Result<Entry>` (installs the platform store once via an AtomicBool guard), `set_password(&str)`, `get_password() -> Result<String>`, `set_secret(&[u8])`, `get_secret()`, `delete_credential()`. Errors re-exported from keyring-core.
- Error enum (`keyring-core-1.0.0/src/error.rs:26`): `PlatformFailure`, `NoStorageAccess`, **`NoEntry`** (never set / deleted), `BadEncoding(Vec<u8>)`, `TooLong(attr, limit)`, `Invalid`, `Ambiguous(Vec<Entry>)`, `NoDefaultStore`, `NotSupportedByStore`.
- Proposed trait seam (probe-compiled):
  ```rust
  trait SecretStore {
      fn set(&self, key: &str, secret: &str) -> Result<(), String>;
      fn get(&self, key: &str) -> Result<Option<String>, String>;  // NoEntry -> Ok(None)
      fn delete(&self, key: &str) -> Result<(), String>;           // NoEntry -> Ok(())
  }
  ```
  Service name suggestion: `"TakiAgent"`, keys like `"node-token"` (D6/D7 for leader).
- Windows Credential Manager limits: generic credential blob max 512 * 5 bytes historically (2560 bytes) — a device token fits trivially; the `TooLong` variant surfaces the platform limit if hit.

### xcap 0.9.6 (installed source)

- `xcap-0.9.6/src/monitor.rs`: `Monitor::all()` `:21`, `from_point(x,y)` `:30`, `id()/name()/friendly_name()` `:39-47`, `x()/y()/width()/height()` `:51-63`, `scale_factor()` `:71`, `is_primary()` `:79`, `capture_image() -> XCapResult<RgbaImage>` `:91`, `capture_region(x,y,w,h)` `:95`.
- `xcap-0.9.6/src/lib.rs:26` `pub use image;` — encode without adding a separate `image` dep:
  ```rust
  let img = primary.capture_image()?;               // RgbaImage (image 0.25.10)
  let mut buf = std::io::Cursor::new(Vec::new());
  img.write_to(&mut buf, xcap::image::ImageFormat::Png)?;  // -> PNG bytes
  ```
- Errors: `XCapError::NotSupported | Error(String) | InvalidCaptureRegion | ...` (`error.rs`); `XCapError::new(msg)` exists for wrapping. All fallible per-field accessors return `XCapResult` (a 0.9 change — older versions had infallible accessors).
- Capture is blocking (GDI/DXGI under the hood) — call via `spawn_blocking` from the async WS task.
- Multi-monitor: v1 scope per issue = ONE capability round-trip; suggest primary-monitor-only input `{}` or `{monitorId?}` — input schema is part of D4's frame sign-off.

### Gate policy design inputs

**Sources**: ADR 0002 (exec policy modes `deny|allowlist|full` are for the exec capability — typed capabilities like screenshot "carry their own per-capability switches and Sensitivity Tiers"); issue #10 AC (once/session/always/deny; session = remembered until disconnect; always = durable + revocable); #8 decision-store precedent.

**Policy evaluation table shape** (design input, not decided):

| Input | Values |
|---|---|
| capability | `screenshot` (v1); later `process-list`, `clipboard`, `exec`, ... |
| per-capability switch | `enabled | disabled` (operator config) |
| remembered decision | none / `always` / `never` (persisted) / session-`always`/`never` (memory) |
| → outcome | `deny` (switch off or remembered never) / `allow` (remembered always) / `ask` (else) |

Evaluation order (mirrors `approval-gate.ts:38-52`): capability disabled → auto-deny (audit `auto-denied`); remembered always → auto-allow (audit `auto-allowed`); remembered never → auto-deny; else → dialog ask → allow/deny per answer, remember per scope, audit. **Fail-closed everywhere**: dialog unavailable/timeout/cancel = deny (the codified convention: every non-affirmative path denies, with a flip-it-and-a-test-fails default).

**Scope semantics mapping** (from #8, `decision-store.ts:41-52`):
- `once` → execute, remember NOTHING.
- `session` → in-memory map; for the Shell, natural lifetime = the Shell process (≈ "until disconnect" in the AC — but see D9: process-lifetime vs per-WS-connection).
- `always` (approve) → persist `"always"`; `deny` + persist → `"never"` (deny+always == never, ruling 4).
- Key by `capability` alone in v1 (single node, no server/tool tuple needed); JSON-tuple-encode if a second dimension appears (the NUL-byte lesson from #8).

**Persistence location (must be OUTSIDE the agent Workspace)**:
- Core precedent: dataDir = `~/.takiagent` (`server-config.ts:24`), Workspace = `~/.takiagent/workspace/` (`main.ts:77`), decisions at `~/.takiagent/mcp-approvals.json` (`main.ts:124`) — i.e. inside dataDir but OUTSIDE workspace/.
- Rust options: (a) `~/.takiagent/shell/` (colocated with core data — simple, but on the v1.5 VPS topology core and shell are different machines, so colocation is illusory), (b) Tauri `app.path().app_data_dir()` → `%APPDATA%/cc.shiinataki.app/` (Tauri-idiomatic, clearly Shell-owned, never reachable by the workspace-scoped file capability). **D7: leader picks.** Both satisfy "outside Workspace"; (b) is cleaner ownership.
- Atomic write: tmp + rename, same as `decision-store.ts:86-92`.

### JSONL audit append

- `std::fs::OpenOptions::new().create(true).append(true).open(path)` + one `write_all(line.as_bytes())` per decision, line ends `\n`. Keep the file handle open in the gate (single writer) or reopen per append (rarer, simpler crash semantics) — either is defensible; reopen-per-append is simplest and the write rate is human-scale.
- Windows append atomicity: append mode maps to `FILE_APPEND_DATA`; with a SINGLE writer process there is no interleaving risk at all. Do not add locking.
- Line shape proposal: `{"ts":"2026-07-10T12:00:00.000Z","requestId":"<uuid>","capability":"screenshot","decision":"allowed-once"}` — decision vocabulary needs to distinguish auto vs asked (audit is the blast-radius record per ADR 0002). NO input/output payload, NO image bytes, NO paths beyond the capability name (mirrors "core logs get names only").
- `tracing` + a JSON file appender was the TECH-STACK note ("Audit log JSONL via tracing"); verdict: for the gate's audit, a direct fs append in an `audit.rs` module is simpler and testable (assert file contents in tempdir); `tracing` remains for diagnostic logs. Deviation from TECH-STACK wording — flag as D10 (minor).

### Returning the image + what the agent does with it (D8 — LEADER DECISION)

Facts established:
- Wire: `capability.respond` carries `{mediaType:"image/png", dataBase64:"..."}` (proposal, rust-ws-protocol.md D4); sizes fine.
- ai@7.0.17: tool `execute` may return ANY value; the model sees `ToolResultOutput` = JSON by default, or whatever `toModelOutput` returns — including `type:'content'` with an image file part (`provider-utils@5.0.5 d.ts:294-380`, `Tool.toModelOutput :1719`). So the SDK is NOT the constraint.
- The constraint is the model: deepseek-v4-flash is text-only. Feeding an `image/png` content part to a text-only OpenAI-compatible endpoint will error or be dropped provider-side.
- Issue #10 AC says only "returns the image to the agent" — it does not say the model ingests pixels. ADR 0002/0004 are silent. The single-DB-writer rule (invariant 2) means the Shell must NOT write the image into the Workspace itself; the CORE receives base64 and (if persisting) writes it.

Options for the leader (do not decide in research):
- (a) Core persists PNG under `~/.takiagent/workspace/screenshots/<ts>.png` and the tool returns `{ok:true, path, width, height, bytes}` text/JSON to the model — path is agent-usable later (file capability reads it back when a vision model arrives).
- (b) Tool returns only an ack `{ok:true, width, height}` and the image goes to the timeline/UI only.
- (c) Wire `toModelOutput` now behind a "model supports images" config flag, defaulting to path/ack for text-only models — future-proof but more code.

## Caveats / Not found

- keyring 4's own docs recommend apps needing store control link `keyring-core` + a specific store crate directly instead of the façade (`keyring-4.1.4/src/lib.rs` module docs). The pinned stack says `keyring` 4.1; the `v1` feature is adequate for v1 — noted, not a recommendation to deviate.
- xcap capture failure modes on secure desktops (UAC prompts, DRM windows) not empirically probed — capture returns `XCapError`, which must degrade into the `ok:false` respond frame (error-handling rule).
- No live keyring/xcap RUN was performed (probe is compile-verified only; a live screenshot capture + Credential Manager round-trip belongs in the implement smoke, cheap and observable there).

## Leader decisions needed

- **D7 (Shell data root)**: `%APPDATA%/cc.shiinataki.app/` (Tauri app_data_dir) vs `~/.takiagent/shell/` for gate decisions + audit JSONL. Recommend app_data_dir (Shell-owned, workspace-unreachable, VPS-topology-correct).
- **D8 (image handling v1)**: option (a) core-persists-to-Workspace + path/ack to the model / (b) ack-only / (c) config-gated toModelOutput. The issue text does not decide this.
- **D9 ("session" lifetime on the node)**: Shell-process lifetime vs per-WS-connection (AC wording says "until disconnect" — reconnect loops make these different; a dropped+auto-reconnected socket arguably should NOT wipe session grants).
- **D10 (audit mechanism)**: direct fs append in `audit.rs` (recommended, testable) vs `tracing` JSONL appender (TECH-STACK wording).
