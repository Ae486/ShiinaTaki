import { describe, expect, it } from "vitest";

import { createMouthArmRanges, MOUTH_ARMS } from "./mouth-arm-ranges.ts";

describe("mouth arm ranges", () => {
  it("starts with no data for every arm and keeps arms independent", () => {
    const ranges = createMouthArmRanges();
    expect(ranges.snapshot()).toEqual({ native: null, "native-tuned": null, envelope: null });
    ranges.begin("native");
    ranges.observe("native", { PARAM_MOUTH_OPEN_Y: 0.1 });
    ranges.observe("native", { PARAM_MOUTH_OPEN_Y: 0.4 });
    ranges.observe("native", { PARAM_MOUTH_OPEN_Y: 0 });
    expect(ranges.snapshot().native).toEqual({ PARAM_MOUTH_OPEN_Y: { min: 0, max: 0.4, frames: 3 } });
    expect(ranges.snapshot()["native-tuned"]).toBeNull();
    expect(ranges.snapshot().envelope).toBeNull();
    expect(MOUTH_ARMS).toEqual(["native", "native-tuned", "envelope"]);
  });

  it("skips null and non-finite values instead of coercing them to zero", () => {
    const ranges = createMouthArmRanges();
    ranges.begin("envelope");
    ranges.observe("envelope", { open: null, form: Number.NaN, width: Number.POSITIVE_INFINITY });
    expect(ranges.snapshot().envelope).toEqual({});
    ranges.observe("envelope", { open: 0.5, form: null });
    expect(ranges.snapshot().envelope).toEqual({ open: { min: 0.5, max: 0.5, frames: 1 } });
  });

  it("clears only the restarted arm on begin and everything on reset", () => {
    const ranges = createMouthArmRanges();
    ranges.begin("native");
    ranges.observe("native", { open: 0.3 });
    ranges.begin("native-tuned");
    ranges.observe("native-tuned", { open: 0.9 });
    ranges.begin("native");
    expect(ranges.snapshot().native).toEqual({});
    expect(ranges.snapshot()["native-tuned"]).toEqual({ open: { min: 0.9, max: 0.9, frames: 1 } });
    const before = ranges.snapshot();
    ranges.reset();
    expect(before["native-tuned"]).not.toBeNull();
    expect(ranges.snapshot()).toEqual({ native: null, "native-tuned": null, envelope: null });
  });
});
