# Research: `setIgnoreCursorEvents` in Tauri 2 (topic 1)

- **Query**: exact JS + Rust API, capability permission id, and what it does on Windows.
- **Scope**: internal (installed crate/type source)
- **Date**: 2026-07-14

## JS API — verified

`node_modules/.pnpm/@tauri-apps+api@2.11.1/.../window.d.ts:1062-1074`:

```ts
// on the Window instance (getCurrentWindow())
setIgnoreCursorEvents(ignore: boolean): Promise<void>;
// @param ignore `true` to ignore the cursor events; `false` to process them as usual.
```

Usage (from the JSDoc example, verbatim):
```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
await getCurrentWindow().setIgnoreCursorEvents(true);
```

## Rust API — verified

`tauri-2.11.5/src/window/mod.rs:2225`:
```rust
pub fn set_ignore_cursor_events(&self, ignore: bool) -> crate::Result<()>
```
delegates to `tao-0.35.3/src/platform_impl/windows/window.rs:566`:
```rust
pub fn set_ignore_cursor_events(&self, ignore: bool) -> Result<(), ExternalError> {
    // ...
    WindowState::set_window_flags(.., HWND(..), |f| {
        f.set(WindowFlags::IGNORE_CURSOR_EVENT, ignore)
    });
    Ok(())
}
```

## What it actually does on Windows — verified (the load-bearing fact)

`tao-0.35.3/src/platform_impl/windows/window_state.rs`:
- `IGNORE_CURSOR_EVENT = 1 << 14` (line 95)
- lines 285-286:
```rust
if self.contains(WindowFlags::IGNORE_CURSOR_EVENT) {
    style_ex |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
}
```
The flag change is applied through `SetWindowLong`/`SetWindowPos` (`apply_diff`). So Tauri's `setIgnoreCursorEvents(true)` **is** the Win32 `WS_EX_TRANSPARENT | WS_EX_LAYERED` toggle — identical to BANDORI §11's `_set_mouse_passthrough`. This is exactly why the `windows` crate is not needed (see `05`).

`WS_EX_TRANSPARENT` removes the window from OS hit-testing, so mouse messages fall through to the window/desktop beneath it — including windows owned by other processes (BANDORI's stated reason for needing `WS_EX_TRANSPARENT` rather than only `WM_NCHITTEST`).

## The paradox — verified behavior

When `ignore=true`, the window (and its WebView2 child) receives **no** pointer events at all — DOM `pointermove`/`mouseenter` stop firing in the webview. Confirmed by Tauri issue #6164 ("WebviewWindow does not listen events") and #2090 ("`set_ignore_cursor_events` can be used but it cannot be disabled, because all mouse events are ignored and you can not detect if user hovers over transparent area"). Tauri has **no** `forward` option (Electron's `setIgnoreMouseEvents(true,{forward:true})` equivalent is an open feature request, #6164). Resolution → see `03`.

## Capability permission — verified

Permission id (present in `gen/schemas/desktop-schema.json:1742`):
```
core:window:allow-set-ignore-cursor-events
```
The current `apps/desktop/src-tauri/capabilities/pet.json` does **not** grant it (it lists only start-dragging, set-position, outer-position, show, window-state:default). It must be **added** to `pet.json`'s `permissions` array.

If approach B (JS `cursorPosition()` poll) is chosen, also add `core:window:allow-cursor-position` — verified it is part of `core:window:default` but pet.json does not include the default set, so it must be listed explicitly (schema line 1466: `core:window:allow-cursor-position`).

## Windows/WebView2 gotcha

The window is already configured `transparent:true, decorations:false, alwaysOnTop:true, skipTaskbar:true, focus:false, visible:false` (`tauri.conf.json` pet window). Visual transparency does **not** make the window click-through — the WebView2 HWND covers the whole client rect and hit-tests as opaque until `WS_EX_TRANSPARENT` is set. So without this feature the transparent overlay currently eats every click inside its 480×640 rectangle. That is the problem #15 solves.
