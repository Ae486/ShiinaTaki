/**
 * INPUT:  a fake FrameHooks (captures overlays per position, fires frames) and a mutable fake ParamAccess.
 * OUTPUT: assertions that tracked ids are sampled at all three positions, drift latches only when the base value
 *         changes across two motion-idle frames, and track()/dispose() reset state.
 * POS:    unit test for the lab's parameter sampler. No engine import. Exempt from caps.
 */

import { describe, expect, it } from "vitest";

import type { FrameContext, FrameHooks, HookPosition, Overlay } from "./frame-hooks.ts";
import type { ParamAccess } from "./param-access.ts";
import { createParamSampler } from "./param-sampler.ts";

function fakeParams(values: Record<string, number>): ParamAccess {
  return {
    generation: "cubism2",
    has: (id) => id in values,
    get: (id) => values[id] ?? 0,
    set: (id, v) => void (values[id] = v),
    add: (id, v) => void (values[id] = (values[id] ?? 0) + v),
    mult: (id, v) => void (values[id] = (values[id] ?? 0) * v),
    listIds: () => null,
  };
}

function fakeHooks(params: ParamAccess) {
  const overlays: Record<HookPosition, Set<Overlay>> = {
    beforeMotionUpdate: new Set(),
    afterMotionUpdate: new Set(),
    beforeModelUpdate: new Set(),
  };
  const hooks: FrameHooks = {
    add: (pos, fn) => {
      overlays[pos].add(fn);
      return () => void overlays[pos].delete(fn);
    },
    clear: () => undefined,
    dispose: () => undefined,
  };
  const ctx: FrameContext = { nowMs: 0, dtMs: 16, params };
  // `between` mimics engine work between positions (a motion write, then an overlay write).
  const frame = (between: Partial<Record<HookPosition, () => void>> = {}) => {
    for (const pos of ["beforeMotionUpdate", "afterMotionUpdate", "beforeModelUpdate"] as const) {
      for (const fn of overlays[pos]) fn(ctx);
      between[pos]?.();
    }
  };
  return { hooks, overlays, frame };
}

describe("createParamSampler", () => {
  it("records the tracked id at the three positions of one frame", () => {
    const values = { PARAM_ANGLE_X: 0 };
    const params = fakeParams(values);
    const { hooks, overlays, frame } = fakeHooks(params);
    const sampler = createParamSampler(hooks, () => true);
    sampler.track(["PARAM_ANGLE_X"]);
    expect(overlays.beforeMotionUpdate.size + overlays.afterMotionUpdate.size + overlays.beforeModelUpdate.size).toBe(3);
    frame({ beforeMotionUpdate: () => (values.PARAM_ANGLE_X = 5), afterMotionUpdate: () => (values.PARAM_ANGLE_X = 20) });
    expect(sampler.snapshot()).toEqual({ samples: { PARAM_ANGLE_X: { before: 0, after: 5, final: 20 } }, drift: {} });
  });

  it("flags drift only when the base value moves between two consecutive motion-idle frames", () => {
    const values = { PARAM_BROW_L_Y: 0 };
    const params = fakeParams(values);
    let playing = true;
    const { hooks, frame } = fakeHooks(params);
    const sampler = createParamSampler(hooks, () => playing);
    sampler.track(["PARAM_BROW_L_Y"]);
    // While a motion plays the base legitimately moves every frame: never drift.
    frame({ beforeModelUpdate: () => (values.PARAM_BROW_L_Y += 1) });
    frame({ beforeModelUpdate: () => (values.PARAM_BROW_L_Y += 1) });
    expect(sampler.snapshot().drift).toEqual({});
    // First idle frame after the motion still carries its last write — no baseline yet, no drift.
    playing = false;
    frame();
    expect(sampler.snapshot().drift).toEqual({});
    // Stable base across idle frames: no drift.
    frame();
    expect(sampler.snapshot().drift).toEqual({});
    // An `add` at afterMotionUpdate accumulating into the base: drift latches.
    frame({ afterMotionUpdate: () => (values.PARAM_BROW_L_Y += 0.5) });
    frame();
    expect(sampler.snapshot().drift).toEqual({ PARAM_BROW_L_Y: true });
  });

  it("ignores float noise below the epsilon", () => {
    const values = { P: 0 };
    const { hooks, frame } = fakeHooks(fakeParams(values));
    const sampler = createParamSampler(hooks, () => false);
    sampler.track(["P"]);
    frame();
    values.P = 1e-7;
    frame();
    expect(sampler.snapshot().drift).toEqual({});
  });

  it("track() replaces the id set and drops stale samples and latches; dispose() unhooks", () => {
    const values = { A: 1, B: 2 };
    const { hooks, overlays, frame } = fakeHooks(fakeParams(values));
    const sampler = createParamSampler(hooks, () => false);
    sampler.track(["A", "A"]);
    frame();
    values.A = 3;
    frame();
    expect(sampler.ids()).toEqual(["A"]);
    expect(sampler.snapshot().drift).toEqual({ A: true });
    sampler.track(["B"]);
    frame();
    expect(Object.keys(sampler.snapshot().samples)).toEqual(["B"]);
    expect(sampler.snapshot().drift).toEqual({});
    sampler.dispose();
    expect(overlays.beforeMotionUpdate.size + overlays.afterMotionUpdate.size + overlays.beforeModelUpdate.size).toBe(0);
    expect(sampler.ids()).toEqual([]);
  });
});
