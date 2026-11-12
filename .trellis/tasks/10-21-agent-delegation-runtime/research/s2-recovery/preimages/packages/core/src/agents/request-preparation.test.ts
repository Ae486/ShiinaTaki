import { describe, expect, it } from "vitest";
import { reductionTargetTokens } from "./request-preparation.ts";

describe("request reduction target", () => {
  it("budgets only the message portion and stays below the inclusive pressure threshold", () => {
    expect(reductionTargetTokens({ thresholdTokens: 80, projectedInputTokens: 90, requestMessageTokens: 20 })).toBe(9);
    expect(reductionTargetTokens({ thresholdTokens: 80, projectedInputTokens: 90, requestMessageTokens: 90 })).toBe(79);
    expect(reductionTargetTokens({ thresholdTokens: 80.5, projectedInputTokens: 90, requestMessageTokens: 20 })).toBe(10);
  });
});
