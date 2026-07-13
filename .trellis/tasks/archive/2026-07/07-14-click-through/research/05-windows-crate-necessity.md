# Research: Is the `windows` crate needed? (topic 6)

- **Query**: does Tauri 2's `setIgnoreCursorEvents` suffice on Windows, or is a `windows`-crate `SetWindowLong(WS_EX_TRANSPARENT)` path required (esp. for cross-process pass-through)?
- **Scope**: internal (tao/tauri crate source), cross-checked vs BANDORI §11 comment
- **Date**: 2026-07-14

## Answer: NOT needed for the core loop — Tauri already does exactly what BANDORI's comment demands.

BANDORI §11 comment says `WS_EX_TRANSPARENT` polling is required specifically to pass clicks to windows *owned by other processes* (`WM_NCHITTEST` alone only handles the same window). The question was whether Tauri's abstraction actually sets `WS_EX_TRANSPARENT`, or something weaker.

**Verified — it sets exactly that.** `tao-0.35.3/src/platform_impl/windows/window_state.rs:285-286`:
```rust
if self.contains(WindowFlags::IGNORE_CURSOR_EVENT) {
    style_ex |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
}
```
applied via `SetWindowLong`/`SetWindowPos` in `apply_diff`. `setIgnoreCursorEvents(true)` → `IGNORE_CURSOR_EVENT` flag → `WS_EX_TRANSPARENT | WS_EX_LAYERED`. That is precisely the extended-style toggle BANDORI's `_set_mouse_passthrough` does natively, so cross-process pass-through works through Tauri's API alone. No `windows`-crate `SetWindowLong` call is required.

## The global cursor read is also covered without the crate

`cursorPosition()` (JS) → `tauri .../window/mod.rs:1748` → `tao .../windows/window.rs:503 util::cursor_position()` → Win32 `GetCursorPos`. So both halves of the loop — the toggle and the global cursor read — are reachable from Tauri's shipped API without touching `windows`/`windows-sys` directly.

## When the crate WOULD appear (optional, not correctness)

Only if the leader picks **event-flow approach A** (a native Rust `GetCursorPos` poll thread pushing `device-mouse-move`, for lower latency than the JS `cursorPosition()` poll). That thread would call `windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos` (+ optionally `GetAsyncKeyState` for the button guard). This is a **performance/latency** choice, never required for the feature to be correct. The `windows` crate (0.61.3 / 0.62.2) is already present transitively in the Cargo lock, so pulling it in would not add a new top-level dependency surface of concern beyond the small module itself.

## TECH-STACK note to revise

`docs/TECH-STACK.md:43` currently reads:
```
| Click-through | `windows` crate, cursor hit-test vs canvas alpha mask | Hardest module; budget spike time |
```
This overstates the crate's role. Verified position: **Tauri's `setIgnoreCursorEvents` provides the `WS_EX_TRANSPARENT` toggle and `cursorPosition()` provides the global cursor — the `windows` crate is at most an optional latency optimization for a native poll thread, not a requirement.** (Flagging for the leader; per Research Agent scope this doc is not edited here — use `update-spec`/`update-doc` to amend TECH-STACK.)

## Residual Windows/WebView2 gotchas (verified from sources)

- WebView2 registers its OLE drop target only when first shown/composited by DWM; a window first `show()`n mid-interaction can miss it (DEV.to shelf article). Not directly click-through, but relevant since the pet window starts `visible:false` and is shown after first paint (`pet-stage.tsx`) — unrelated to click-through toggling, but worth knowing if drag-drop is added later.
- `WS_EX_LAYERED` is applied together with `WS_EX_TRANSPARENT` by tao; do not separately manage layered-window attributes.
- No DWM/`DwmSetWindowAttribute` call is needed for click-through (that was only for the Win11 rounded-corner/border cosmetics in reference §10, a separate concern).
