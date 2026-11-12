import { describe, expect, it } from "vitest";

import { computeNativeLipsync } from "./native-lipsync.ts";

describe("native lipsync transform", () => {
  it("mirrors the engine's gain, power, positive floor, clamp and weighted additive contribution", () => {
    expect(computeNativeLipsync(0, { gain: 1.5, weight: 0.4 })).toEqual({ clamped: 0, contribution: 0 });
    const quiet = computeNativeLipsync(0.01, { gain: 1.5, weight: 0.4 });
    expect(quiet?.clamped).toBe(0.1);
    expect(quiet?.contribution).toBeCloseTo(0.04);
    expect(computeNativeLipsync(1, { gain: 1.5, weight: 0.4 })).toEqual({ clamped: 1, contribution: 0.4 });
    expect(computeNativeLipsync(0.4, { gain: 1, weight: 0.5 })?.clamped).toBeCloseTo(0.4 ** 1.15);
    expect(computeNativeLipsync(0.4, { gain: 1, weight: 0 })?.contribution).toBe(0);
  });

  it("keeps unavailable and invalid input unknown instead of reporting a zero", () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(computeNativeLipsync(value, { gain: 1.5, weight: 0.4 })).toBeNull();
    }
    expect(computeNativeLipsync(0.4, { gain: Number.NaN, weight: 0.4 })).toBeNull();
  });
});
