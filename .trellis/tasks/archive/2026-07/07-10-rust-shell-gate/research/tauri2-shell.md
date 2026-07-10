# Research: Tauri 2.11 Shell app structure (against installed scaffold)

- **Query**: Tauri 2.11 app structure for the Rust Shell tracer bullet — lib/main split, long-lived WS background task, state, native approval dialog, capabilities json, pnpm-workspace dev/build, cargo test story
- **Scope**: mixed (installed scaffold + installed crate sources + official docs)
- **Date**: 2026-07-10

## Verdicts (first)

1. **lib.rs / main.rs split is already correct** — keep `main.rs` a 6-line shim calling `taki_desktop_lib::run()`; all app logic goes in `lib.rs` + modules. The mobile-entry macro `#[cfg_attr(mobile, tauri::mobile_entry_point)]` is already on `run()`. Do NOT touch `main.rs` (`apps/desktop/src-tauri/src/main.rs:1-7`, `lib.rs:18-24`). ✔ matches CLAUDE.md invariant 6.
2. **The long-lived WS client task lives in a `.setup()` hook via `tauri::async_runtime::spawn`**, moving a cloned `AppHandle` into the future. This is the confirmed idiomatic Tauri 2 pattern (docs.rs `tauri::async_runtime`, official + community examples 2024-05). `setup` itself is sync (`Builder::setup<F>` — `tauri-2.11.5/src/app.rs:1773`); it spawns the async task. Tauri's async runtime IS tokio, so `tokio-tungstenite` runs on it with no separate runtime.
3. **Native approval dialog = `tauri-plugin-dialog` v2**, NOT cached — must be added to `Cargo.toml` + `pnpm add` the JS companion + a `dialog:` permission in the capability JSON. Use `blocking_show()` on a NON-main thread (inside the spawned WS task it is already off-main). Verdict: use the async `.show(cb)` OR `blocking_show()` from within the spawned task — both fine there; never call blocking on the main/UI thread (freezes the app).
4. **State**: hold the WS client's send-half + gate/audit/keyring handles in a struct registered via `app.manage(state)`; retrieve with `State<'_, T>` in commands or `app_handle.state()` in the task (`tauri-2.11.5/src/lib.rs:688 manage`, `:729 state`, `:744 try_state`). `manage` returns false if the type is already managed.
5. **Tray/window**: not needed for THIS issue (#10 is a headless-ish tracer bullet: connect + screenshot round-trip + dialog). The existing single "main" window (`tauri.conf.json:12-20`) is enough. Tray/click-through/positioner are later (M4 Pet UI).
6. **cargo test WITHOUT launching the app is fully viable** and is the plan: the gate/audit/keyring/serde logic must be plain Rust modules with NO `tauri::` types in their signatures, unit-tested with `#[cfg(test)]` + `tempfile`. Only the thin wiring (setup hook, command handlers, dialog call) touches `tauri::` and is not unit-tested (covered by the live smoke). This mirrors the TS side's "thin handler delegates to service" rule.

## Findings

### Installed scaffold (issue #2 output)

| File | State | Note |
|---|---|---|
| `apps/desktop/src-tauri/src/main.rs` | thin shim ✔ | `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` + `taki_desktop_lib::run()` |
| `apps/desktop/src-tauri/src/lib.rs` | `run()` + demo `ping` command | `ping` is the reference command; replace/augment with real capability commands. `ping` is NOT `pub` (correct — lib.rs commands must not be `pub`, submodule commands must be) |
| `apps/desktop/src-tauri/Cargo.toml` | tauri 2.11, serde, serde_json | `[lib] name = "taki_desktop_lib"`, `crate-type = ["staticlib","cdylib","rlib"]`, `edition = "2021"`, `rust-version = "1.88"`. `[lints.clippy] too_many_lines = "warn"` |
| `apps/desktop/src-tauri/tauri.conf.json` | one "main" window 480×640 | `beforeDevCommand: "pnpm dev"`, `devUrl: http://localhost:1420`, `frontendDist: "../dist"`, `identifier: cc.shiinataki.app` |
| `apps/desktop/src-tauri/capabilities/default.json` | `windows:["main"]`, `permissions:["core:default"]` | schema `../gen/schemas/desktop-schema.json` (generated) |
| `apps/desktop/package.json` | `"tauri": "tauri"` script; `@tauri-apps/cli ^2.11`, `@tauri-apps/api ^2.11` | build = `vite build`, dev = `vite` |

### Long-lived WS task pattern (verified)

```rust
// lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())        // NEW: dialog plugin
        .setup(|app| {
            let handle = app.handle().clone();       // AppHandle is Send+Clone
            tauri::async_runtime::spawn(async move { // runs on Tauri's tokio runtime
                shell::run_ws_client(handle).await;  // reconnect loop lives here
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- `Builder::setup<F>` is sync; `F: FnOnce(&mut App) -> Result<_>` (`tauri-2.11.5/src/app.rs:1773`). Spawn the async task inside it.
- `tauri::async_runtime` re-exports tokio primitives (`spawn`, `block_on`, `Mutex`, `channel`, `Sender`/`Receiver`, `RuntimeHandle`) — docs.rs confirms it IS the tokio runtime Tauri uses for plugin init + setup. Use `tauri::async_runtime::spawn`, not a hand-rolled `tokio::main`.
- Common footgun (GitHub disc #10784): a `std::sync::MutexGuard` held across `.await` is `!Send` and breaks `spawn`. Use `tokio::sync::Mutex` (re-exported as `tauri::async_runtime::Mutex`) for anything shared across await points.

### State management

- `app.manage(state)` stores a `T: Send + Sync + 'static` in Tauri's type-map; `manage` returns `false` if that type is already managed (`tauri-2.11.5/src/lib.rs:688`).
- Access: `State<'_, T>` param in a `#[tauri::command]`, or `app_handle.state::<T>()` / `try_state::<T>()` inside the spawned task (`:729`, `:744`).
- Plan: a `ShellState { tx: mpsc::Sender<OutboundFrame>, gate: Arc<Gate>, ... }` managed once in setup; the WS task owns the socket, commands (if any) enqueue via `tx`.

### Native approval dialog — `tauri-plugin-dialog` v2

- Cargo: add `tauri-plugin-dialog = "2"` to `[dependencies]`; JS side `pnpm --filter @taki/desktop add @tauri-apps/plugin-dialog` (only if the frontend also calls it — the Rust-side gate does not need the JS binding).
- Init: `.plugin(tauri_plugin_dialog::init())` in the Builder.
- Rust API (docs.rs `tauri_plugin_dialog`, source-verified):
  ```rust
  use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
  let approved: bool = app_handle.dialog()
      .message("Agent requests: screenshot of the primary monitor")
      .title("TakiAgent — Permission")
      .kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancelCustom("Allow", "Deny"))
      .blocking_show();          // bool: true = first (Allow) button
  ```
- `blocking_show() -> bool` (true = OK/Yes/first custom). For the 4-way once/session/always/deny UX, `bool` is insufficient — see **Leader decision D1**. `blocking_show_with_result() -> MessageDialogResult` returns the `Custom(String)` label, but the enum only supports up to 3 buttons (`Yes/No/Cancel` + `*Custom`), so 4 distinct outcomes need either two dialogs or a custom Tauri window.
- **CRITICAL threading rule**: `blocking_show` must NOT run on the main thread (freezes UI). Inside the spawned WS task it is off-main, but the task is async — calling a blocking dialog there stalls the WS reactor. Prefer `dialog().message(...).show(move |ok| { ... })` (async callback) OR run `blocking_show` via `tauri::async_runtime::spawn_blocking` and await the JoinHandle. See **Leader decision D1**.
- **Capability permission**: the dialog plugin ships permission tokens; add to a capability JSON (see below). Tokens: `dialog:allow-message`, `dialog:allow-ask`, plus `dialog:default`. Exact set must be verified against `gen/schemas/desktop-schema.json` after `pnpm tauri dev` regenerates it (permission names live in the plugin's `permissions/` and are surfaced in the generated schema).

### Per-window capabilities JSON gotchas

- Every command/plugin needs a matching permission in a `capabilities/*.json` or it compiles fine and fails at runtime (CLAUDE.md gotcha, confirmed).
- Current `default.json` grants only `core:default` to `["main"]`. Adding the dialog plugin requires appending its permission tokens to a capability that targets the window that shows the dialog.
- Pet window vs settings window get SEPARATE capability files (CLAUDE.md). For #10 there is only `main`, so one file suffices; when M4 splits windows, split the capability files then.
- The `$schema` points at `../gen/schemas/desktop-schema.json`, regenerated by the build — after adding a plugin, run a dev/build once so the schema knows the new tokens (otherwise editor validation flags them).

### pnpm workspace ↔ `tauri dev`/`build`

- `apps/desktop/package.json` has `"tauri": "tauri"`; run via `pnpm --filter @taki/desktop tauri dev`.
- `tauri.conf.json` `beforeDevCommand: "pnpm dev"` / `beforeBuildCommand: "pnpm build"` run the frontend (Vite) first; `frontendDist: "../dist"` is what `generate_context!` embeds.
- **CI already encodes the ordering** (`.github/workflows/ci.yml` rust-checks): `pnpm --filter @taki/desktop build` MUST run before `cargo clippy`, because `generate_context!` embeds `../dist` — a missing dist bundle fails the Rust compile. Any local `cargo` invocation on src-tauri needs `dist/` to exist first.
- Node 24 + pnpm 10 in CI; `frozen-lockfile`. `swatinem/rust-cache` scoped to `apps/desktop/src-tauri`.

### cargo test inside src-tauri (no app launch)

- **Viable and required by the AC** ("Tests: gate policy decisions table-driven, audit line per decision").
- Strategy: gate/audit/keyring-backend/serde-protocol are plain modules with no `tauri::` in their public signatures → ordinary `#[cfg(test)] mod tests` unit tests, runnable with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- `generate_context!` embeds `../dist`, so even `cargo test` needs `dist/` present (same constraint as clippy). Build the frontend once before `cargo test` locally, or the crate won't compile. (This is a real friction point — see `rust-testing.md`.)
- Do NOT try to unit-test the dialog call or the setup hook; those are the thin wiring covered by the live smoke (AC 1-3).

## Leader decisions needed

- **D1 (dialog vs 4-way approval)**: `MessageDialogButtons` maxes at 3 buttons; once/session/always/deny is 4 outcomes. Options: (a) two-step dialog (Allow?/Deny → then scope once/session/always), (b) a custom small Tauri WebView window rendering 4 buttons (reuses Pet UI React), (c) map to 3 (Allow-once / Allow-always / Deny) and drop "session" from the native dialog. The TS/#8 precedent has 5 (y/s/a/d/n) via CLI. **Leader must choose the Rust dialog UX before implement.**
- **D2 (blocking vs async dialog on the WS task)**: `blocking_show` off-main is safe but stalls the async reactor; `.show(cb)` needs correlating the callback back to the pending request. Recommend `spawn_blocking` + oneshot channel — flag for leader to confirm the concurrency model (matches the #8 broker's pending-map + correlation-id shape).
- **D3 (dialog plugin JS binding)**: is the approval dialog driven purely Rust-side (`app.dialog()`), or does the Pet UI render it? Rust-only needs only the crate + capability token, no `@tauri-apps/plugin-dialog` npm dep. Confirm.
