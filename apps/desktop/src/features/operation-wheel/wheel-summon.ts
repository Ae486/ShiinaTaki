/**
 * INPUT:  the pet stage's contextmenu event and the store's wheel opener.
 * OUTPUT: suppresses the native context menu and summons the wheel at the click point (a second right-click
 *         re-summons at the new point rather than toggling closed).
 * POS:    ui/features/operation-wheel — the pet-stage summon rule, kept out of JSX so it is node-testable.
 */

import type { WheelPoint } from "./wheel-placement.ts";

export interface WheelSummonEvent {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
}

export function summonWheel(event: WheelSummonEvent, openWheel: (point: WheelPoint) => void): void {
  event.preventDefault();
  openWheel({ x: event.clientX, y: event.clientY });
}
