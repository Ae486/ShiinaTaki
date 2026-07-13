/**
 * INPUT:  pointer events on the pet canvas host (bridged from React).
 * OUTPUT: pointer handlers implementing a 4px click-vs-drag dead-zone; past the threshold it hands the move to the
 *         OS via getCurrentWindow().startDragging(). Under the threshold it is a click (hit-test reaction is #16).
 * POS:    ui/windows/pet — hook owns the Tauri window access (components never call it directly). Whole-window
 *         drag for #14; opaque-pixel alpha gating + click-through are #15's job (seam noted, not designed here).
 */

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const DRAG_DEAD_ZONE_PX = 4; // BANDORI reference convention; tune to feel.

type DragHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function usePetDrag(): DragHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: event.screenX, y: event.screenY };
    dragging.current = false;
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (!origin || dragging.current) return;
    if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) <= DRAG_DEAD_ZONE_PX) return;
    dragging.current = true;
    // The OS captures the pointer here, so the trailing pointerup may not reach the webview — the dragging
    // flag guards against a stray click. Failure to start a drag must not crash the overlay.
    void getCurrentWindow().startDragging().catch(() => undefined);
  }, []);

  const onPointerUp = useCallback(() => {
    // start.current && !dragging.current ⇒ it was a click: model.hitTest reaction lands in #16 (seam).
    start.current = null;
    dragging.current = false;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}
