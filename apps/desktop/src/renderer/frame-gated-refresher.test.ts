/**
 * INPUT:  createFrameGatedRefresher with a spy refresh callback, driven by synthetic tick()/force() calls.
 * OUTPUT: assertions that tick() refreshes only on every Nth call, force() refreshes immediately and restarts the
 *         cadence from zero, an interval below 1 clamps to every-tick, and the helper never refreshes on its own
 *         (no timer — it only runs when driven, i.e. it rides whatever loop calls tick).
 * POS:    unit test for the renderer's frame-gated refresh cadence (P1c). Node-safe — no Pixi.
 */

import { describe, expect, it, vi } from "vitest";
import { createFrameGatedRefresher } from "./frame-gated-refresher.ts";

describe("createFrameGatedRefresher", () => {
  it("refreshes only on every Nth tick", () => {
    const refresh = vi.fn();
    const refresher = createFrameGatedRefresher(refresh, 4);
    for (let i = 0; i < 3; i += 1) refresher.tick();
    expect(refresh).not.toHaveBeenCalled();
    refresher.tick(); // 4th tick
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i += 1) refresher.tick(); // ticks 5-8 → one more refresh at tick 8
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("force() refreshes immediately and restarts the cadence from zero", () => {
    const refresh = vi.fn();
    const refresher = createFrameGatedRefresher(refresh, 4);
    refresher.tick();
    refresher.tick();
    refresher.force();
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i += 1) refresher.tick();
    expect(refresh).toHaveBeenCalledTimes(1); // phase restarted — no gated refresh within the next 3 ticks
    refresher.tick();
    expect(refresh).toHaveBeenCalledTimes(2); // ...only on the 4th tick after the force
  });

  it("an interval below 1 clamps to every-tick instead of never refreshing", () => {
    const refresh = vi.fn();
    const refresher = createFrameGatedRefresher(refresh, 0);
    refresher.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never refreshes on its own (no timer — driven only by tick/force)", () => {
    const refresh = vi.fn();
    createFrameGatedRefresher(refresh, 4);
    expect(refresh).not.toHaveBeenCalled();
  });
});
