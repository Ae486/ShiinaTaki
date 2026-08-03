/**
 * INPUT:  the right-click summon point (window-local px) and the pet window's inner size.
 * OUTPUT: the wheel box's top-left position — centred on the summon point, clamped so the whole box stays on-window.
 * POS:    ui/features/operation-wheel — pure geometry, framework-free and node-testable; the component only renders
 *         what this returns.
 */

export interface WheelPoint {
  x: number;
  y: number;
}

export interface WheelWindowSize {
  width: number;
  height: number;
}

/** Box edge of the whole wheel (the radial ring plus its chips) — the component's layout box is exactly this square. */
export const WHEEL_SIZE_PX = 176;

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

export function placeWheel(summon: WheelPoint, windowSize: WheelWindowSize): WheelPoint {
  const half = WHEEL_SIZE_PX / 2;
  return {
    x: clamp(summon.x - half, windowSize.width - WHEEL_SIZE_PX),
    y: clamp(summon.y - half, windowSize.height - WHEEL_SIZE_PX),
  };
}
