/**
 * INPUT:  synthetic contextmenu events + a spy wheel opener.
 * OUTPUT: assertions that the pet-stage right-click suppresses the native menu and summons the wheel at the click
 *         point — that nothing in the summon path opens the costume panel (it moved into the wheel) — and that a
 *         right-click landing on the open wheel is swallowed instead of re-summoning it.
 * POS:    unit test for features/operation-wheel/wheel-summon. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { summonWheel, suppressWheelSummon } from "./wheel-summon.ts";

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

describe("suppressWheelSummon", () => {
  it("stops a right-click on the open wheel from reaching the stage rule", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    suppressWheelSummon(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("leaves the wheel where it is — the stage rule never runs on a suppressed event", () => {
    const openWheel = vi.fn();
    let bubbles = true;
    const event = { preventDefault: vi.fn(), stopPropagation: () => (bubbles = false), clientX: 40, clientY: 40 };

    suppressWheelSummon(event); // the wheel's own handler runs first
    if (bubbles) summonWheel(event, openWheel); // the stage rule only sees events that still bubble

    expect(openWheel).not.toHaveBeenCalled();
  });
});
