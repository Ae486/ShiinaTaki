import { describe, expect, it } from "vitest";
import {
  MEMORY_METHODS,
  MemoryTidyDefectsSchema,
  MemoryTidyParamsSchema,
  MemoryTidyResultSchema,
} from "./memory-schema.ts";

const DEFECTS = { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 3 };
const USAGE = { calls: 1, inputTokens: 200, outputTokens: 40, usageUnknown: 0 };

describe("MEMORY_METHODS", () => {
  it("names the tidy method", () => {
    expect(MEMORY_METHODS).toEqual({ tidy: "memory.tidy" });
  });
});

describe("memory.tidy schemas (T5 batch 4b)", () => {
  it("round-trips params and both result statuses", () => {
    expect(MemoryTidyParamsSchema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
    const ran = { status: "ran" as const, defects: DEFECTS, edits: 2, steps: 4, usage: USAGE };
    expect(MemoryTidyResultSchema.parse(ran)).toEqual(ran);
    const clean = { ...ran, status: "clean" as const, edits: 0, steps: 0 };
    expect(MemoryTidyResultSchema.parse(clean)).toEqual(clean);
  });

  it("rejects an empty characterId and an unknown status", () => {
    expect(MemoryTidyParamsSchema.safeParse({ characterId: "" }).success).toBe(false);
    expect(
      MemoryTidyResultSchema.safeParse({ status: "failed", defects: DEFECTS, edits: 0, steps: 0, usage: USAGE }).success,
    ).toBe(false);
  });

  it("carries counts only — negative or fractional counts are structurally invalid", () => {
    expect(MemoryTidyDefectsSchema.safeParse({ ...DEFECTS, stale: -1 }).success).toBe(false);
    expect(MemoryTidyDefectsSchema.safeParse({ ...DEFECTS, misfiled: 1.5 }).success).toBe(false);
    expect(
      MemoryTidyResultSchema.safeParse({ status: "ran", defects: DEFECTS, edits: -1, steps: 0, usage: USAGE }).success,
    ).toBe(false);
  });
});
