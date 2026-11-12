/**
 * INPUT:  temporary Inspector width and local pointer/keyboard resize actions
 * OUTPUT: directly tracked width clamped to the reference bounds, with lost-capture/blur cleanup
 * POS:    ui/monitor — DSH Table pane interaction adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

export const INSPECTOR_WIDTH_MIN = 320;
export const INSPECTOR_WIDTH_MAX = 720;
export const INSPECTOR_WIDTH_DEFAULT = 360;

interface ResizeActions {
  active?: boolean;
  width: number;
  change(width: number): void;
  resizing(active: boolean): void;
}
interface ResizeGesture { x: number; width: number; splitWidth: number; pointerId: number; target: HTMLDivElement }

export function useInspectorResize(actions: ResizeActions) {
  const gesture = useRef<ResizeGesture | null>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const end = (event?: { pointerId?: number }) => {
    if (event?.pointerId !== undefined && gesture.current?.pointerId !== event.pointerId) return;
    const current = gesture.current;
    gesture.current = null;
    if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    latest.current.resizing(false);
  };
  useEffect(() => {
    const cancel = () => end();
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel); end(); };
  }, []);
  useEffect(() => { if (actions.active === false) end(); }, [actions.active]);
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || actions.active === false || gesture.current) return;
      event.preventDefault();
      const pane = event.currentTarget.parentElement!;
      gesture.current = { x: event.clientX, width: pane.getBoundingClientRect().width,
        splitWidth: pane.parentElement!.parentElement!.getBoundingClientRect().width, pointerId: event.pointerId, target: event.currentTarget };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      actions.resizing(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const start = gesture.current;
      if (start?.pointerId !== event.pointerId) return;
      actions.change(clampInspectorWidth(start.width + start.x - event.clientX, start.splitWidth));
    },
    onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => resizeKey(event, actions),
  };
}

export function clampInspectorWidth(width: number, splitWidth: number): number {
  const maximum = Math.max(INSPECTOR_WIDTH_MIN, Math.min(INSPECTOR_WIDTH_MAX, splitWidth - 280));
  return Math.round(Math.min(Math.max(width, INSPECTOR_WIDTH_MIN), maximum));
}

function resizeKey(event: KeyboardEvent<HTMLDivElement>, actions: ResizeActions): void {
  if (actions.active === false) return;
  const step = event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
  if (!step) return;
  event.preventDefault();
  const splitWidth = event.currentTarget.parentElement!.parentElement!.parentElement!.getBoundingClientRect().width;
  actions.change(clampInspectorWidth(actions.width + step, splitWidth));
}
