import { describe, expect, it } from "vitest";
import { DEFAULT_PINNED_BUDGET, loadMemoryConfig } from "./memory-config.ts";

describe("memory config (T5-R13: every number is configured, with a fail-closed default)", () => {
  it("falls back to the default pinned budget when unset", () => {
    expect(loadMemoryConfig({})).toEqual({ pinnedBudget: DEFAULT_PINNED_BUDGET });
    expect(DEFAULT_PINNED_BUDGET).toBe(800);
  });

  it("takes the operator's override", () => {
    expect(loadMemoryConfig({ TAKI_MEMORY_PINNED_BUDGET: "1200" })).toEqual({ pinnedBudget: 1200 });
  });

  it("fails the boot on a garbage budget rather than guessing one", () => {
    for (const value of ["abc", "0", "-1", "3.5", ""]) {
      expect(() => loadMemoryConfig({ TAKI_MEMORY_PINNED_BUDGET: value })).toThrow();
    }
  });
});
