# Research: Event-flow architecture — resolving the paradox (topic 3)

- **Query**: how does the click-through toggle actually get driven on Tauri 2 + WebView2, given that `ignore=true` kills the window's pointer events?
- **Scope**: mixed (Tauri crate/type source + Tauri GitHub issues #2090/#6164/#13070 + community repos)
- **Date**: 2026-07-14

## The paradox, stated precisely (verified)

1. Transparent + `ignore=false`: the WebView2 HWND hit-tests as opaque across the whole window rect, so it blocks all clicks in its 480×640 area (visual transparency ≠ click-through).
2. `ignore=true` (WS_EX_TRANSPARENT): clicks fall through, but the webview receives **zero** pointer events (Tauri #2090/#6164 — no `forward` option). So the webview cannot detect the cursor returning to an opaque pixel and can never flip back.

⇒ A toggle driven by the webview's own `pointermove` is a dead end. The driver must read the cursor from a source that works while `ignore=true`: the **global cursor position**.

## The working loop (proven; two implementations)

Toggle rule (each tick):
```
opaque   = containsPoint(cursor) && alphaMask[cursorCell] >= ALPHA_THRESHOLD   // topic 2
ignore   = !dragging && !leftButtonDown && !opaque                              // topic 4
if (ignore !== lastIgnore) { setIgnoreCursorEvents(ignore); lastIgnore = ignore }
```
Only call `setIgnoreCursorEvents` on a state change (the community repos all debounce this way; it is a `SetWindowLong`+`SetWindowPos`, cheap but not free).

### Implementation A — Rust global poll + push (BANDORI-style, lowest latency)

A Rust thread polls `GetCursorPos` every ~16 ms and emits the position to the pet webview via a Tauri event; the webview runs the toggle rule against its cached mask. Verified live examples: `Xinyu-Li-123/tauri-clickthrough-demo` and `codecnmc/tauri2-transparent-through` (both from Tauri #6164) emit a `device-mouse-move` event from a Rust cursor thread and toggle in the frontend. The DEV.to "transparent shelf" article uses the same 50 ms `GetCursorPos` poll thread and notes it is "imperceptible to the user but trivial for the CPU (the thread is asleep 99% of the time)". BANDORI §11 is the same pattern natively.

Pros: push (no per-tick IPC round-trip), lowest latency, can also read `GetAsyncKeyState(0x01)` for the button-down guard. Cons: a new Rust module (a `windows`/`windows-sys` `GetCursorPos` thread) — a native surface to own.

### Implementation B — Webview polls built-in `cursorPosition()` (zero Rust) — RECOMMENDED start

Tauri 2 already exposes the global cursor to JS. Verified `window.d.ts:1850`:
```ts
declare function cursorPosition(): Promise<PhysicalPosition>;
// "Get the cursor position relative to the top-left hand corner of the desktop." (global, multi-monitor aware)
```
Rust chain: `tauri .../window/mod.rs:1748 cursor_position()` → `tao .../windows/window.rs:503` → `util::cursor_position()` → Win32 `GetCursorPos`. So this is a global query that works regardless of the window's ignore state. Permission: `core:window:allow-cursor-position` (add to pet.json).

Loop: `setInterval`/`requestAnimationFrame` → `const p = await cursorPosition()` → convert to window-local using the pet window `outerPosition()` + `scaleFactor` (PhysicalPosition is device px) → map to mask cell → toggle. Cost: one IPC round-trip per tick (Promise over the Tauri IPC bridge). At ~30–60 Hz this is modest; if it lags, switch to A.

Pros: no new Rust, uses an already-shipped API, honours invariant #1 (no new native seam). Cons: IPC round-trip per poll; latency bounded by IPC turnaround.

## Recommendation

Start with **B** (JS `cursorPosition()` poll) — it needs zero Rust, only two capability lines, and is entirely inside the existing Pet UI client. Keep **A** (Rust `GetCursorPos` push) as the drop-in fallback if the IPC poll is visibly laggy at the target rate. Both are correct because both read the *global* cursor; the choice is latency vs a small native module. Leader decides.

## Coordinate-conversion gotchas (Windows/WebView2)

- `cursorPosition()` / `GetCursorPos` return **physical (device) pixels**, desktop-origin; the pet window is `autoDensity:true, resolution:devicePixelRatio` (`stage.ts`). Convert cursor→window-local→CSS px→mask cell consistently or the hit test drifts on HiDPI. `window.innerPosition()`/`outerPosition()` return PhysicalPosition too — keep everything in physical px until the final mask-cell map.
- Multi-monitor: desktop origin is the primary monitor's top-left; coordinates can be negative. Use window position deltas, not absolute assumptions.
- `WS_EX_LAYERED` (set alongside `WS_EX_TRANSPARENT`) is already handled by Tauri; no manual layered-window redraw needed.
