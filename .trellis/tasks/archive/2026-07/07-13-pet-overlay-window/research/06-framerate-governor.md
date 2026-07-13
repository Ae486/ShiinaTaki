# Research: Frame-rate governor hooks (PixiJS 8 ticker + Tauri 2 window events)

- **Query**: how PixiJS 8's `Ticker`/`app.ticker` is controlled (stop/start, maxFPS/minFPS); how to hook window focus/blur/occlusion/visibility in a Tauri 2 webview to drive it (render loop must provably pause when idle — an AC); which Tauri 2 events fire on focus/blur/minimize
- **Scope**: mixed (PixiJS 8 official docs + installed Tauri event types)
- **Date**: 2026-07-13

## Findings

### PixiJS 8 ticker control (verified, official docs)

The `Application` uses `Ticker.shared` by default; `app.ticker` drives the render loop via `requestAnimationFrame`.

- **Pause / resume the render loop**:
  ```ts
  app.ticker.stop();   // pauses rendering; cancels the pending animation frame
  app.ticker.start();  // resumes
  ```
  (Verified: PixiJS 8 "Render Loop" guide — `app.ticker.stop()` / `app.ticker.start()`.) `app.stop()` / `app.start()` do the same at the Application level.
- **Cap frame rate** (throttle-when-idle):
  ```ts
  app.ticker.maxFPS = 30;   // ticker will not run faster than 30 fps
  app.ticker.maxFPS = 0;    // unlimited
  app.ticker.minFPS = 10;   // floor for the delta clamp
  ```
  (Verified: PixiJS 8 Ticker overview — `maxFPS`/`minFPS`; `maxFPS=0` = unlimited.)
- **Governor tiers** map cleanly to these two controls:
  - animating (motion/expression playing, drag, speaking) → `maxFPS = 60` (or 0), ticker running
  - idle (only breath drift / blink) → `maxFPS = 30` or lower — throttle
  - off-screen / minimized / asleep → `app.ticker.stop()` — full pause (this is the AC "provably pauses when idle")
- **Init note (repo-specific)**: `app.init({ autoStart, sharedTicker })` controls startup. With `autoStart:false` you drive frames manually; for a governor, keeping `autoStart:true` and toggling `stop()/start()` + `maxFPS` is simpler. The renderer spec (`.trellis/spec/frontend/live2d-renderer.md`) already flags the governor as a **#14 acceptance criterion, not an optimization** — two idle models pegged ~1 CPU core without it.

### Tauri 2 window events (verified against installed types)

Source: `@tauri-apps/api@2.11.1` `event.d.ts` (`TauriEvent` enum) and `window.d.ts` (typed `Window.on*` helpers).

Verified `TauriEvent` values (`event.d.ts` L48-63):
```
WINDOW_RESIZED   = "tauri://resize"
WINDOW_MOVED     = "tauri://move"
WINDOW_FOCUS     = "tauri://focus"
WINDOW_BLUR      = "tauri://blur"
WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change"
WINDOW_THEME_CHANGED = "tauri://theme-changed"
WINDOW_CREATED   = "tauri://window-created"
WINDOW_SUSPENDED = "tauri://suspended"
WINDOW_RESUMED   = "tauri://resumed"
WINDOW_CLOSE_REQUESTED / WINDOW_DESTROYED, DRAG_* also present
```

Typed convenience listeners on the `Window` class (verified `window.d.ts`):
- `onFocusChanged(handler: EventCallback<boolean>): Promise<UnlistenFn>` (L1299) — fires on focus AND blur, payload `true`/`false`. **This is the primary governor hook.**
- `onMoved(handler: EventCallback<PhysicalPosition>)` (L1232) — for position persistence (`04-...`).
- `onResized(handler: EventCallback<PhysicalSize>)` (L1214).

Usage:
```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
const w = getCurrentWindow();
const unlisten = await w.onFocusChanged(({ payload: focused }) => {
  if (focused) { app.ticker.maxFPS = 60; app.ticker.start(); }
  else         { app.ticker.maxFPS = 15; }           // throttle when unfocused
});
```
Listening requires the event permission — `core:event:default` (already granted in `default.json`; add to `pet.json`).

### Occlusion / minimize / visibility — the coverage gap

- **Minimize/restore**: there is no dedicated `onMinimized` typed helper. Options: (1) on blur, poll `w.isMinimized()` (verified present in `window.d.ts`) and `stop()` if minimized; (2) listen to `WINDOW_SUSPENDED`/`WINDOW_RESUMED` where the platform emits them. The robust, cross-check path is `onFocusChanged` → throttle, plus the **web** `document` `visibilitychange` event (fires `document.hidden` when the webview is not rendering) → `app.ticker.stop()`. WebView2 fires `visibilitychange`/Page Visibility reliably on minimize, so:
  ```ts
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  });
  ```
  Combine both: `visibilitychange` for hard pause (minimized/hidden), `onFocusChanged` for throttle (visible but background). This pair gives the "provably pauses" AC.
- **True per-pixel occlusion** (another opaque window covering the pet while the pet is still "visible" and focused-elsewhere) is NOT signaled by any Tauri or DOM event — neither the OS nor WebView2 reports "you are covered." So a fully-covered-but-not-minimized pet cannot be detected to pause; the best available proxy is blur→throttle. **Flag: the AC "pause when off-screen/occluded" is only partially achievable — minimize/hidden = provable pause; covered-by-another-window = not detectable, throttle-on-blur is the ceiling.**

### Recommended governor wiring (summary)

1. Default: `app.ticker.maxFPS = 60` while an animation/drag/speak is active; drop to idle cap (e.g. 30) when only idle drift runs (drive from the renderer state machine, `.trellis/spec/frontend/state-management.md`).
2. `onFocusChanged(false)` → throttle further (e.g. 15).
3. `document.visibilitychange` → `document.hidden ? ticker.stop() : ticker.start()` — the hard pause for minimize/hidden.
4. Optional: `w.isMinimized()` check on blur as a secondary guard.

## Caveats / Not Found

- No Tauri 2 typed `onMinimized`/occlusion event exists; minimize detection relies on DOM `visibilitychange` + `isMinimized()` polling. Verify WebView2 fires `visibilitychange` on minimize in the smoke (it does in practice, but confirm on this machine).
- "Pause when occluded by another window" (pet visible, not minimized, fully covered) is **not detectable** with any verified Tauri/DOM API — throttle-on-blur is the best proxy. If the AC demands provable pause on occlusion, it cannot be met with current verified APIs; recommend scoping the AC to minimize/hidden (provable) + blur-throttle (best-effort).
- `WINDOW_SUSPENDED`/`WINDOW_RESUMED` exist in the enum but their exact fire semantics on Windows desktop (vs mobile lifecycle) are not verified — don't rely on them as the primary pause signal; use `visibilitychange`.

## Sources

- PixiJS 8 Render Loop guide (stop/start, maxFPS) — https://pixijs.download/v8.18.0/docs/core-concepts-2.html
- PixiJS 8 Ticker overview (maxFPS/minFPS, `Ticker.shared`, autoStart) — https://pixijs.download/v8.17.1/docs/ticker.html ; https://pixijs.com/8.x/guides/components/ticker
- Installed types: `@tauri-apps/api@2.11.1` `event.d.ts` (TauriEvent L48-63), `window.d.ts` (`onFocusChanged` L1299, `onMoved` L1232, `onResized` L1214, `isMinimized`)
- Repo: `.trellis/spec/frontend/live2d-renderer.md` (governor is a #14 AC), `.trellis/spec/frontend/state-management.md` (animation state machine)
