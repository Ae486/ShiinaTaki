/**
 * INPUT:  pointer events on the pet canvas host (bridged from React) + the shared interaction store + an onClick sink.
 * OUTPUT: pointer handlers implementing a 4px click-vs-drag dead-zone; past the threshold it hands the move to the
 *         OS via getCurrentWindow().startDragging() and raises the shared `dragging` flag. Under the threshold it is a
 *         click: onClick(x, y) fires with canvas-local px (the F2/F4 seam — open the bubble / react to a hit region).
 * POS:    ui/windows/pet — hook owns the Tauri window access (components never call it directly). The `dragging`
 *         flag is lifted to the store so the click-through poll (#15) can gate on it — no drop-through mid-drag.
 */

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useInteractionStore } from "@/stores/interaction-store.js";

const DRAG_DEAD_ZONE_PX = 4; // BANDORI reference convention; tune to feel.

type DragHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function usePetDrag(onClick?: (x: number, y: number) => void): DragHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const setDragging = useInteractionStore((s) => s.setDragging);

  const endDrag = useCallback(() => {
    start.current = null;
    dragging.current = false;
    setDragging(false);
  }, [setDragging]);

  // startDragging() lets the OS capture the pointer, so the trailing pointerup / a released button may never reach
  // the webview — clear the shared flag defensively when the window sees a release or a buttonless move, otherwise
  // click-through would stay suspended forever after a drag.
  useEffect(() => {
    const onMove = (event: PointerEvent) => { if (event.buttons === 0) endDrag(); };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
      window.removeEventListener("pointermove", onMove);
    };
  }, [endDrag]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: event.screenX, y: event.screenY };
    dragging.current = false;
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = start.current;
      if (!origin || dragging.current) return;
      if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) <= DRAG_DEAD_ZONE_PX) return;
      dragging.current = true;
      setDragging(true); // suspend click-through for the whole OS drag before the pointer capture begins.
      // Failure to start a drag must not crash the overlay.
      void getCurrentWindow().startDragging().catch(() => undefined);
    },
    [setDragging],
  );

  // start.current && !dragging.current ⇒ it was a click: fire onClick with canvas-local px (the div fills the window,
  // so client-minus-rect is logical canvas px — what isOpaqueAt / handleClick / focusAt expect).
  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const wasClick = start.current !== null && !dragging.current;
      if (wasClick && onClick) {
        const rect = event.currentTarget.getBoundingClientRect();
        onClick(event.clientX - rect.left, event.clientY - rect.top);
      }
      endDrag();
    },
    [endDrag, onClick],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
