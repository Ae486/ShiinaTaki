# Research: Suspend-during-drag + animation tracking + governor budget (topics 4 & 5)

- **Query**: guarantee click-through is OFF during a drag; confirm the alpha approach tracks the animating model; confirm the poll doesn't fight the idle-CPU governor.
- **Scope**: internal (drag hook, render governor, scene)
- **Date**: 2026-07-14

## Topic 4 — suspend click-through during drag

Where drag state lives: `apps/desktop/src/windows/pet/use-pet-drag.ts`. It holds two refs — `start` (pointer origin) and `dragging` (crossed the 4px dead-zone). On threshold it calls `getCurrentWindow().startDragging()` (line 37). Note its own comment: once `startDragging()` runs, "the OS captures the pointer … the trailing pointerup may not reach the webview" — so during an OS drag the webview may not see events at all, exactly when we must NOT flip to click-through.

The click-through controller and the drag hook are separate. To let the controller read drag state, **lift the drag flag to a shared source of truth** (the existing `zustand` store `apps/desktop/src/stores/avatar-store.ts`, or a new small interaction store) so both `usePetDrag` and the click-through poll read it. The toggle rule (topic 3) then becomes:
```
ignore = !dragging && !leftButtonDown && !opaqueUnderCursor
```
This is precisely the community guard from Tauri #6164 (`shouldIgnore = !isDragging && !inHitbox`) and BANDORI §11 ("disable passthrough while dragging / any mouse button down").

Extra safety (matches the DEV.to shelf article): also gate on left-button-down. In approach A this is `GetAsyncKeyState(0x01)`; in approach B, track the webview's own `pointerdown`/`pointerup` while interactive, or read button state. While any button is down, force `ignore=false` so a press that begins on the character cannot drop through mid-gesture even if the cursor slides over a transparent pixel during the drag.

Ordering guarantee: set `ignore=false` **before** `startDragging()` (the pet is opaque at the press point anyway, so it is already false), and do not allow the poll to set `ignore=true` until `dragging` clears in `onPointerUp`. Because `startDragging` may swallow `pointerup`, clear the drag flag defensively on window blur / drag-end too.

## Topic 5 — tracking the animating model + governor budget

**Does the alpha approach track animation?** Yes, inherently. The cached mask (topic 2) is re-read from the live RenderTexture each painted frame, so breath/blink/motion/position shifts are reflected the next frame with no extra work. A bounds/hit-area approach would lag or miss (and `hitTest`=`[]` for taki anyway). This directly satisfies the "tracks as it animates/moves" AC.

**Does the poll fight the governor?** No, if split correctly:
- **Mask refresh** happens inside the render loop, so it is naturally governed by `RenderGovernor` (`apps/desktop/src/renderer/render-governor.ts`): full fps when active, `idle`/`blur` tiers when unfocused/idle, and `stop()` when hidden or `asleep`. Fewer painted frames ⇒ fewer readbacks. When the ticker is stopped the silhouette is static, so the last mask stays correct — a stale mask is the *right* answer while paused. The readback rides the governor; it does not add frames.
- **Cursor poll** (topic 3) is independent of fps and stays cheap: `GetCursorPos`/`cursorPosition()` + `containsPoint` + one array index. It must keep running even when the render is paused, so the user can still click to wake the pet (the paused mask is the current silhouette, so the opaque test is still correct).

So the two clocks are decoupled: the *expensive* part (readback) throttles with the governor; the *always-on* part (cursor poll) is negligible. This respects the always-on idle-CPU concern — the poll is the "asleep 99% of the time" thread the DEV.to article describes, and the mask work only happens on frames the governor already decided to paint.

**One caveat to flag:** `stage.ts` uses `autoStart:false` and the governor owns the ticker. The per-frame mask refresh must be hooked to *actual paints* (e.g. a ticker callback / after-render hook), not a naive `requestAnimationFrame`, so it stops when the governor stops and never forces a paint the governor suppressed. Wiring it as an independent rAF would defeat the pause and fight the governor — do not do that.

## Files referenced

| File | Role in this feature |
|---|---|
| `apps/desktop/src/windows/pet/use-pet-drag.ts` | owns drag/`dragging` ref + `startDragging()`; drag flag must be lifted to a shared store |
| `apps/desktop/src/stores/avatar-store.ts` | existing zustand store — candidate home for the shared drag/interaction flag |
| `apps/desktop/src/renderer/render-governor.ts` | governs the ticker; mask refresh must ride it (active/idle/blur/pause tiers) |
| `apps/desktop/src/renderer/pet-scene.ts` | assembly point (governor + model + stage); where a mask/click-through controller would be wired |
| `apps/desktop/src/renderer/stage.ts` | `autoStart:false`, transparent Pixi app; the canvas whose alpha is the mask source |
| `apps/desktop/src/windows/pet/pet-stage.tsx` | the only React↔renderer bridge; where a click-through hook would mount |
