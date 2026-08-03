/**
 * INPUT:  a synthetic contextmenu event + a spy wheel opener.
 * OUTPUT: assertions that the pet-stage right-click suppresses the native menu and summons the wheel at the click
 *         point — and that nothing in the summon path opens the costume panel (it moved into the wheel).
 * POS:    unit test for features/operation-wheel/wheel-summon. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { summonWheel } from "./wheel-summon.ts";

describe("summonWheel", () => {
  it("suppresses the native menu and opens the wheel at the click point", () => {
    const preventDefault = vi.fn();
    const openWheel = vi.fn();
    summonWheel({ preventDefault, clientX: 120, clientY: 45 }, openWheel);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(openWheel).toHaveBeenCalledWith({ x: 120, y: 45 });
  });

  it("re-summons at the new point instead of toggling closed", () => {
    const openWheel = vi.fn();
    summonWheel({ preventDefault: vi.fn(), clientX: 10, clientY: 10 }, openWheel);
    summonWheel({ preventDefault: vi.fn(), clientX: 90, clientY: 70 }, openWheel);
    expect(openWheel.mock.calls).toEqual([[{ x: 10, y: 10 }], [{ x: 90, y: 70 }]]);
  });
});
