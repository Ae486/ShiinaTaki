/**
 * INPUT:  a contextmenu event — from the pet stage (summon) or from the open wheel itself (suppress).
 * OUTPUT: summonWheel suppresses the native menu and opens the wheel at the click point (a second right-click
 *         re-summons at the new point rather than toggling closed); suppressWheelSummon kills a right-click that
 *         landed on the wheel so it neither opens the native menu nor re-summons.
 * POS:    ui/features/operation-wheel — the right-click rules, kept out of JSX so they are node-testable.
 */

import type { WheelPoint } from "./wheel-placement.ts";

export interface WheelSummonEvent {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
}

export interface WheelSuppressEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function summonWheel(event: WheelSummonEvent, openWheel: (point: WheelPoint) => void): void {
  event.preventDefault();
  openWheel({ x: event.clientX, y: event.clientY });
}

// The wheel renders inside the stage, so without stopping propagation a right-click ON it bubbles to the stage rule
// and re-places the wheel under the cursor mid-use (check-b3 concern 1).
export function suppressWheelSummon(event: WheelSuppressEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
