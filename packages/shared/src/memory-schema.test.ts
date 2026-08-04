import { describe, expect, it } from "vitest";
import {
  MEMORY_METHODS,
  MemoryStatusParamsSchema,
  MemoryStatusResultSchema,
  MemorySummaryStatusSchema,
  MemoryTidyDefectsSchema,
  MemoryTidyParamsSchema,
  MemoryTidyResultSchema,
} from "./memory-schema.ts";

const DEFECTS = { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 3 };
const USAGE = { calls: 1, inputTokens: 200, outputTokens: 40, usageUnknown: 0 };

describe("MEMORY_METHODS", () => {
  it("names the tidy and status methods", () => {
    expect(MEMORY_METHODS).toEqual({ tidy: "memory.tidy", status: "memory.status" });
  });
});

const STATUS = {
  windowSlots: [{ slot: "main", effectiveWindow: 120_000, factor: 1.08, updatedAt: "2026-08-03T10:00:00.000Z" }],
  summary: { throughSeq: 42, textChars: 900, updatedAt: "2026-08-03T10:01:00.000Z" },
  auto: { lastEpisodicSeq: 40, lastFlushSeq: 38, lastTidyAt: null },
};

describe("memory.status schemas (#26 batch 4)", () => {
  it("round-trips params and a repo-shaped status", () => {
    expect(MemoryStatusParamsSchema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
    expect(MemoryStatusResultSchema.parse(STATUS)).toEqual(STATUS);
    expect(MemoryStatusResultSchema.parse({ ...STATUS, summary: null }).summary).toBeNull();
  });

  it("carries COUNTS ONLY — a summary payload with the actual text is rejected, not silently stripped", () => {
    expect(MemorySummaryStatusSchema.safeParse({ ...STATUS.summary, text: "secret" }).success).toBe(false);
    const leaking = { ...STATUS, summary: { ...STATUS.summary, text: "secret" } };
    expect(MemoryStatusResultSchema.safeParse(leaking).success).toBe(false);
    for (const key of Object.keys(MemorySummaryStatusSchema.shape)) expect(key).not.toMatch(/^(text|content)$/);
  });

  it("rejects an empty characterId and impossible counters", () => {
    expect(MemoryStatusParamsSchema.safeParse({ characterId: "" }).success).toBe(false);
    expect(MemoryStatusResultSchema.safeParse({ ...STATUS, auto: { ...STATUS.auto, lastFlushSeq: -1 } }).success).toBe(false);
    const badSlot = [{ ...STATUS.windowSlots[0], factor: 0 }];
    expect(MemoryStatusResultSchema.safeParse({ ...STATUS, windowSlots: badSlot }).success).toBe(false);
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
