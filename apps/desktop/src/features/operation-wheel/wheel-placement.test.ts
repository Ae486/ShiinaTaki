/**
 * INPUT:  summon points across the window (centre + all four corners) with a fixed wheel size.
 * OUTPUT: assertions that the wheel box is centred on the summon point when it fits and is clamped fully on-window
 *         at every edge, so no item ever renders off-screen.
 * POS:    unit test for features/operation-wheel/wheel-placement. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { placeWheel, WHEEL_SIZE_PX } from "./wheel-placement.ts";

const WINDOW = { width: 400, height: 600 };

function fitsInWindow(position: { x: number; y: number }): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.x + WHEEL_SIZE_PX <= WINDOW.width &&
    position.y + WHEEL_SIZE_PX <= WINDOW.height
  );
}

describe("placeWheel", () => {
  it("centres the wheel on the summon point when it fits", () => {
    const position = placeWheel({ x: 200, y: 300 }, WINDOW);
    expect(position).toEqual({ x: 200 - WHEEL_SIZE_PX / 2, y: 300 - WHEEL_SIZE_PX / 2 });
    expect(fitsInWindow(position)).toBe(true);
  });

  it("clamps the wheel fully on-window at every corner", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: WINDOW.width, y: 0 },
      { x: 0, y: WINDOW.height },
      { x: WINDOW.width, y: WINDOW.height },
    ];
    for (const corner of corners) expect(fitsInWindow(placeWheel(corner, WINDOW))).toBe(true);
  });

  it("pins to the origin when the window is smaller than the wheel (no negative offset)", () => {
    expect(placeWheel({ x: 10, y: 10 }, { width: 40, height: 40 })).toEqual({ x: 0, y: 0 });
  });
});
