import { describe, expect, it } from "vitest";
import {
  AuxiliaryModelCallSchema,
  AuxiliaryUsageCountsSchema,
  AuxiliaryUsageQuerySchema,
  AuxiliaryUsageResultSchema,
} from "./auxiliary-usage-schema.ts";

const at = "2026-11-01T00:00:00.000Z";
const callId = "00000000-0000-4000-8000-000000000001";
const emptyUsage = {
  inputTokens: null, noCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  outputTokens: null, reasoningTokens: null, totalTokens: null,
};

describe("auxiliary usage schemas", () => {
  it("keeps explicit zero distinct from unknown and rejects unsafe counters", () => {
    expect(AuxiliaryUsageCountsSchema.parse({ ...emptyUsage, inputTokens: 0 }).inputTokens).toBe(0);
    expect(AuxiliaryUsageCountsSchema.parse(emptyUsage).inputTokens).toBeNull();
    expect(AuxiliaryUsageCountsSchema.safeParse({ ...emptyUsage, totalTokens: -1 }).success).toBe(false);
    expect(AuxiliaryUsageCountsSchema.safeParse({ ...emptyUsage, totalTokens: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });

  it("defaults bounded queries and rejects reversed ranges or unknown filters", () => {
    expect(AuxiliaryUsageQuerySchema.parse({ from: at, to: at }).limit).toBe(50);
    expect(AuxiliaryUsageQuerySchema.safeParse({ from: "2026-11-02T00:00:00.000Z", to: at }).success).toBe(false);
    expect(AuxiliaryUsageQuerySchema.safeParse({ from: at, to: at, limit: 101 }).success).toBe(false);
    expect(AuxiliaryUsageQuerySchema.safeParse({ from: at, to: at, runId: "not-owned" }).success).toBe(false);
  });

  it("admits metadata-only rows and refuses raw provider material", () => {
    const row = {
      callId, taskId: null, source: "utility", label: "memory extraction", provider: "deepseek", modelId: "chat",
      startedAt: at, finishedAt: null, updatedAt: at, status: "started", responseId: null, usage: emptyUsage,
    };
    expect(AuxiliaryModelCallSchema.parse(row)).toEqual(row);
    expect(AuxiliaryModelCallSchema.safeParse({ ...row, prompt: "secret" }).success).toBe(false);
  });

  it("requires nullable sums when no producer value is known and bounds cache fractions", () => {
    const counter = { sum: null, knownCount: 0 };
    const result = {
      scope: "observed-auxiliary", rows: [], nextCursor: null, totalCalls: 0,
      stateCounts: { started: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 },
      tokenCounts: {
        inputTokens: counter, noCacheTokens: counter, cacheReadTokens: counter, cacheWriteTokens: counter,
        outputTokens: counter, reasoningTokens: counter, totalTokens: counter,
      },
      cacheRead: { pairedCount: 0, inputTokens: null, cacheReadTokens: null, ratio: null },
    };
    expect(AuxiliaryUsageResultSchema.parse(result)).toEqual(result);
    expect(AuxiliaryUsageResultSchema.safeParse({ ...result, cacheRead: { ...result.cacheRead, ratio: 1.01 } }).success).toBe(false);
  });
});
