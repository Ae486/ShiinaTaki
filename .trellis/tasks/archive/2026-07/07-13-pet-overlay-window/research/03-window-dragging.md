# Research: Dragging a borderless window (Tauri 2)

- **Query**: `startDragging()` vs manual position-set on pointer move; which Tauri 2 recommends; click-vs-drag dead-zone pattern; required permission
- **Scope**: mixed (installed JS types + Tauri 2 docs + BANDORI reference pattern)
- **Date**: 2026-07-13

## Findings

### The two approaches

**(A) `getCurrentWindow().startDragging()` — recommended.**
Verified in installed types `@tauri-apps/api@2.11.1` `window.d.ts` L1085:
```ts
startDragging(): Promise<void>;
```
Usage:
```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
const appWindow = getCurrentWindow();
// on pointerdown over the draggable region:
await appWindow.startDragging();
```
This hands the drag to the OS window manager (WM_NCLBUTTONDOWN / native move loop). It is the Tauri-recommended path: smooth, no per-frame IPC, snapping/monitor-edge behavior handled by the OS. On the web side you can alternatively mark an element with the `data-tauri-drag-region` attribute and Tauri wires the drag automatically — but for a Live2D canvas you typically want programmatic control (drag only when the pointer is over an opaque model pixel, not the transparent margin), so call `startDragging()` from your own `pointerdown` handler.

**(B) Manual `setPosition` on pointermove — not recommended for normal drag.**
Verified `window.d.ts` L900:
```ts
setPosition(position: LogicalPosition | PhysicalPosition | Position): Promise<void>;
```
You'd track pointer deltas and call `setPosition` each move. This round-trips IPC every frame → jank, and you re-implement what the OS already does. Reserve `setPosition` for programmatic placement (restoring a saved position, snapping to a corner), NOT live drag. Tauri docs steer custom title bars to `startDragging`/`data-tauri-drag-region`.

**Recommendation**: use (A) `startDragging()` for live drag; use (B) `setPosition` only for restore/programmatic placement (see `04-position-persistence.md`).

### Required permission (verified)

`startDragging()` needs **`core:window:allow-start-dragging`** — confirmed present in `apps/desktop/src-tauri/gen/schemas/desktop-schema.json`. `setPosition()` needs **`core:window:allow-set-position`**. Both must be in the pet window's capability file (`capabilities/pet.json`, `"windows": ["pet"]`).

### Click-vs-drag dead-zone pattern (avoid drag stealing clicks)

Problem: a Live2D pet needs BOTH click reactions (tap → motion/expression, issue #16) AND drag-to-move on the same surface. If you call `startDragging()` on every `pointerdown`, taps get swallowed into micro-drags and click hit-testing (`model.hitTest`) never fires.

Pattern (BANDORI-PET reference used a ~4px threshold): on `pointerdown` record start coords and DON'T drag yet; on `pointermove`, once movement exceeds a dead-zone threshold, call `startDragging()` (once) and treat it as a drag; if `pointerup` fires before the threshold is crossed, it was a click → run the hit-test / click reaction. Sketch:

```ts
const DRAG_DEAD_ZONE_PX = 4;               // BANDORI used ~4px
let start: { x: number; y: number } | null = null;
let dragging = false;

canvas.addEventListener("pointerdown", (e) => { start = { x: e.screenX, y: e.screenY }; dragging = false; });
canvas.addEventListener("pointermove", async (e) => {
  if (!start || dragging) return;
  if (Math.hypot(e.screenX - start.x, e.screenY - start.y) > DRAG_DEAD_ZONE_PX) {
    dragging = true;
    await getCurrentWindow().startDragging();  // OS takes over the move loop
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (start && !dragging) { /* it was a click → model.hitTest(x,y) → reaction (#16) */ }
  start = null;
});
```

Note: once `startDragging()` runs, the OS captures the pointer, so the JS `pointerup` for that gesture may not fire in the webview — the `dragging` flag guards against a stray trailing click. This behavior is Windows-specific and should be verified in the smoke test.

### Interaction with click-through (#15 seam, not designed here)

When click-through (`setIgnoreCursorEvents(true)`) is later enabled for transparent margins (#15), drag and hit-test only receive events over opaque pixels anyway. The dead-zone drag logic and #15 are complementary; #14 only needs the opaque-region drag to work. Seam flagged, not designed.

## Caveats / Not Found

- Whether `pointerup` reliably fires in the webview after an OS-driven `startDragging` on Windows 11/WebView2 is not empirically verified — the `dragging`-flag guard is the defensive pattern; confirm in `pnpm tauri dev` smoke.
- BANDORI's exact 4px figure is a reference-project convention (`references/BANDORI-PET-REV`, GPLv3 — learn pattern, don't copy code); tune to feel.

## Sources

- Installed types: `@tauri-apps/api@2.11.1` `window.d.ts` (L1085 `startDragging`, L900 `setPosition`)
- Permission id: `apps/desktop/src-tauri/gen/schemas/desktop-schema.json`
- Tauri 2 window customization / drag region docs: https://v2.tauri.app/learn/window-customization/
