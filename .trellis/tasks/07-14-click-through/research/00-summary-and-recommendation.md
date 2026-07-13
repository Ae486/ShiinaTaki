# Research: Per-pixel click-through for the pet overlay (issue #15) — SUMMARY + RECOMMENDATION

- **Query**: How to make the transparent Tauri 2 pet window interactive on the character's opaque pixels and pass clicks through on transparent pixels, on Windows/WebView2.
- **Scope**: mixed (internal source verification + external Tauri/PixiJS docs & community patterns)
- **Date**: 2026-07-14
- **Verification basis**: `@tauri-apps/api@2.11.1` `window.d.ts`, `tauri` 2.11.5 + `tao` 0.35.3 + `wry` 0.55.1 crate source in the local cargo registry, `pixi.js@8.19.0` types+dist, `untitled-pixi-live2d-engine` types, and Tauri GitHub issues #2090 / #6164 / #13070. Each claim below is cited to its file in the sibling topic docs.

---

## The two decisions the leader must rule on

### (2) Alpha-test approach — RECOMMEND: web-side cached alpha mask (option a), refined

Maintain a **CPU-side alpha mask** of the model, refreshed once per rendered frame inside the render loop, and have the cursor poll read a single cell from it (≈ free array index). Do **not** call `renderer.extract.pixels` per cursor poll — verified in the installed dist, each call renders the target into a *new* RenderTexture then does a synchronous `gl.readPixels` (a GPU pipeline stall) and destroys the texture; that is a per-call cost you can afford ~once per frame, never at poll rate. Refinement: render the model into a persistent low-res RenderTexture (e.g. ¼ scale) each frame and `getPixels` that once; index it in the poll.

Coarse first pass: `model.containsPoint(point)` (a bounding-box test on the Pixi Container) cheaply rejects the whole area outside the model rectangle → `ignore=true` with no alpha read; only inside the bbox do you consult the mask.

Why not the alternatives: Live2D `model.hitTest` returns `[]` for taki (no SDK hit areas), so option (b) cannot meet the per-pixel AC — it is only usable as the coarse bbox gate, which `containsPoint` already gives. The DOM/`elementFromPoint` approach (c) cannot work: the whole model is one `<canvas>` element, so it is opaque-to-DOM everywhere. Rust-side capture (d) works but is heavier (WebView2 `CapturePreview` → PNG encode → decode per frame) and moves alpha ownership out of the renderer that already holds it.

### (3) Event-flow architecture — RECOMMEND: global cursor poll drives the toggle (NOT webview `pointermove`)

**The paradox is real and confirmed in Tauri's own issue tracker (#2090, #6164):** `setIgnoreCursorEvents(true)` ignores *all* pointer events with no "forward"/transparent-detection option (unlike Electron). So a webview that flips `ignore=true` on a transparent pixel then stops receiving `pointermove` and can never detect the cursor returning to an opaque pixel. A pure webview-`pointermove` design physically cannot flip back.

Resolution (matches BANDORI §11 and multiple community Tauri-2 repos): drive the toggle from the **global cursor position**, which is readable regardless of the window's ignore state. Two concrete implementations, both proven — leader picks:

- **A. Rust poll + push (lower latency, small Rust module):** a Rust thread reads `GetCursorPos` every ~16 ms and emits the position to the pet webview via a Tauri event; the webview tests the cached alpha mask and calls `setIgnoreCursorEvents`. Mirrors BANDORI and `Xinyu-Li-123/tauri-clickthrough-demo`.
- **B. Webview polls the built-in `cursorPosition()` (zero Rust):** Tauri 2 already exposes a top-level `cursorPosition(): Promise<PhysicalPosition>` (desktop-global, wraps `GetCursorPos`). The webview polls it on an interval, tests the mask, toggles. No new Rust code; cost is one IPC round-trip per poll.

Both break the paradox because both read the **global** cursor, not window-delivered events. Recommendation: start with **B** (no Rust, uses an already-shipped API, honours invariant #1 — no new native surface) and only fall back to **A** if the IPC poll latency at the needed rate is visibly laggy.

### (6) `windows` crate — NOT needed for the core loop (Tauri already does it)

Verified in `tao` source: `set_ignore_cursor_events(true)` sets `WS_EX_TRANSPARENT | WS_EX_LAYERED` on the window (`window_state.rs:285-286`) via `SetWindowLong`/`SetWindowPos` under the hood — this *is* the exact cross-process pass-through mechanism BANDORI's comment says `WS_EX_TRANSPARENT` is required for. And `cursorPosition()` already wraps `GetCursorPos`. So neither the toggle nor the cursor read needs the `windows` crate. The TECH-STACK line ("Click-through | `windows` crate …") can be **downgraded**: the crate is at most an optional perf fallback (a native `GetCursorPos` poll thread for approach A), never a correctness requirement.

---

## Headline answer per topic

| Topic | Headline |
|---|---|
| 1. `setIgnoreCursorEvents` in Tauri 2 | JS `getCurrentWindow().setIgnoreCursorEvents(bool)`; permission `core:window:allow-set-ignore-cursor-events`; on Windows toggles `WS_EX_TRANSPARENT｜WS_EX_LAYERED`. When `true` the window gets **zero** pointer events — hence the paradox. |
| 2. Alpha-under-cursor test | Cached per-frame CPU alpha mask via a persistent low-res RenderTexture + `getPixels` (one readback/frame). `extract.pixels` per-poll = GPU stall, too costly. `containsPoint` bbox = cheap coarse gate. `hitTest`=`[]` for taki. |
| 3. Event-flow | Paradox confirmed by Tauri #2090/#6164. Drive toggle from **global** cursor (Rust `GetCursorPos` push, or built-in JS `cursorPosition()` poll), not webview `pointermove`. |
| 4. Suspend-during-drag | Lift drag state to a shared store; toggle formula `ignore = !dragging && !opaqueUnderCursor`. Also guard on left-button-down. |
| 5. Animation tracking | Cached mask samples live rendered pixels → tracks breath/blink/motion for free; mask refresh rides the render governor (throttles with fps, static when paused = correct). Cursor poll stays constant & cheap. |
| 6. `windows` crate | Not needed — Tauri's API already sets `WS_EX_TRANSPARENT｜WS_EX_LAYERED`; `cursorPosition()` already wraps `GetCursorPos`. |

## ACs — feasibility with verified APIs

- **Interactive on opaque / through on transparent**: achievable. ✅ (cached mask + global-cursor-driven toggle)
- **No drop-through mid-drag**: achievable. ✅ (shared drag flag gates the toggle)
- **Tracks the model as it animates/moves**: achievable. ✅ (per-frame live-pixel mask)
- **Doesn't fight the idle-CPU governor**: achievable. ✅ (mask refresh is governor-gated; poll is a cheap `GetCursorPos` + array index)
- No AC appears un-meetable with verified APIs. The only real risk is the **per-frame readback stall**; the cached low-res RenderTexture design keeps it to one small readback per painted frame (PixiJS's own "once per frame, not more" budget).

See sibling files `01`–`05` for the verified signatures, snippets, and citations.
