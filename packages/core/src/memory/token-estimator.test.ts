import { describe, expect, it } from "vitest";
import { estimateTokens, fitToBudget } from "./token-estimator.ts";

describe("estimateTokens (research §2 regimes)", () => {
  it("counts CJK ~1 token/char", () => {
    expect(estimateTokens("一二三四五六七八九十一二三四五六七")).toBe(17); // 17 hanzi
  });

  it("counts non-CJK ~1 token / 4 chars (ceil)", () => {
    expect(estimateTokens("a".repeat(61))).toBe(16); // ceil(61/4)
  });

  it("adds the two regimes for mixed text", () => {
    // 2 CJK + 4 ASCII -> 2 + ceil(4/4) = 3
    expect(estimateTokens("拉面abcd")).toBe(3);
  });
});

describe("fitToBudget", () => {
  const items = ["aaaa", "bbbb", "cccc"]; // each ~1 token

  it("keeps items in order until the budget is reached", () => {
    expect(fitToBudget(items, 2, (s) => s)).toEqual(["aaaa", "bbbb"]);
  });

  it("always keeps the first item even if it alone exceeds the budget (soft)", () => {
    expect(fitToBudget(["一".repeat(50), "b"], 10, (s) => s)).toEqual(["一".repeat(50)]);
  });

  it("returns [] for no items", () => {
    expect(fitToBudget([], 100, (s) => s)).toEqual([]);
  });
});
