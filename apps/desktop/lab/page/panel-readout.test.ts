import { describe, expect, it } from "vitest";

import { renderSamples } from "./panel-readout.ts";

describe("lab sample readout", () => {
  it("renders unknown slots as n/a without zero substitution or toFixed crashes", () => {
    const result = renderSamples({ samples: { missing: { before: Number.NaN, after: Number.POSITIVE_INFINITY, final: Number.NaN } }, drift: {} });
    expect(result.match(/n\/a/gu)).toHaveLength(3);
    expect(result).not.toContain("0.000");
  });
});
