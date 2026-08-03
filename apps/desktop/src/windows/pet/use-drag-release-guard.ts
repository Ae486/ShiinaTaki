/**
 * INPUT:  the drag terminator from use-pet-drag plus global pointer/blur events on the pet window.
 * OUTPUT: ends the drag whenever the window sees a release, a cancel, a buttonless move, or loses focus.
 * POS:    ui/windows/pet — split out of use-pet-drag: startDragging() hands the pointer to the OS, so the trailing
 *         pointerup may never reach the webview and click-through would stay suspended forever after a drag.
 */

import { useEffect } from "react";

export function useDragReleaseGuard(endDrag: () => void): void {
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
}
