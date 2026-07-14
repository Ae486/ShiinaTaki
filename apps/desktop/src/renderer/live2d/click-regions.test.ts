/**
 * INPUT:  normalized (nx, ny) points across the 7-region grid + its boundaries.
 * OUTPUT: assertions that each point buckets into the expected click region.
 * POS:    unit test for the pure region bucketing (F4). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { regionForPoint } from "./click-regions.ts";

describe("regionForPoint", () => {
  it("buckets the head above y=0.38 regardless of x", () => {
    expect(regionForPoint(0.1, 0.2)).toBe("head");
    expect(regionForPoint(0.9, 0.37)).toBe("head");
  });

  it("buckets the upper body columns between y 0.38 and 0.64", () => {
    expect(regionForPoint(0.2, 0.5)).toBe("upper_body_left");
    expect(regionForPoint(0.5, 0.5)).toBe("upper_body_center");
    expect(regionForPoint(0.8, 0.5)).toBe("upper_body_right");
  });

  it("buckets the lower body columns at or below y=0.64", () => {
    expect(regionForPoint(0.1, 0.9)).toBe("lower_body_left");
    expect(regionForPoint(0.5, 0.8)).toBe("lower_body_center");
    expect(regionForPoint(0.9, 0.7)).toBe("lower_body_right");
  });

  it("treats the 0.38 y-line as body (not head)", () => {
    expect(regionForPoint(0.5, 0.38)).toBe("upper_body_center");
  });
});
