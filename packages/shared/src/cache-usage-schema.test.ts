import { describe, expect, it } from "vitest";
import { CacheUsageUpdateSchema, CacheUsageWindowSnapshotSchema } from "./cache-usage-schema.ts";

const snapshot = {
  scope: "all-observed-model-requests", characterId: "taki", summaryRevision: 2,
  summaryCommittedAt: "2026-11-01T13:00:00.000Z", boundary: "captured", status: "ready",
  computedAt: "2026-11-01T13:01:00.000Z", observedRequests: 3, pairedRequests: 2,
  inputTokens: 1000, cacheReadTokens: 900, ratio: 0.9, reason: null,
};

describe("cache usage subscription contract", () => {
  it("accepts partial coverage and an explicitly reported zero cache result", () => {
    expect(CacheUsageWindowSnapshotSchema.parse(snapshot).ratio).toBe(0.9);
    expect(CacheUsageWindowSnapshotSchema.parse({ ...snapshot, cacheReadTokens: 0, ratio: 0 }).ratio).toBe(0);
  });
  it("keeps an empty or unknown-input window distinct from a zero hit rate", () => {
    const empty = { ...snapshot, status: "empty", pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0, ratio: null };
    expect(CacheUsageWindowSnapshotSchema.parse(empty).observedRequests).toBe(3);
    expect(CacheUsageWindowSnapshotSchema.safeParse({ ...empty, ratio: 0 }).success).toBe(false);
  });
  it("does not accept a mean of request rates in place of the weighted ratio", () => {
    expect(CacheUsageWindowSnapshotSchema.safeParse({ ...snapshot, ratio: 0.5 }).success).toBe(false);
  });
  it.each([
    { pairedRequests: 4 }, { cacheReadTokens: 1001 }, { inputTokens: null },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1 }, { summaryCommittedAt: null },
    { summaryRevision: 0 }, { reason: "read-failed" }, { prompt: "must not be representable" },
  ])("rejects inconsistent or unrepresentable values: %o", (patch) => {
    expect(CacheUsageWindowSnapshotSchema.safeParse({ ...snapshot, ...patch }).success).toBe(false);
  });
  it("permits unavailable statistics without inventing counts", () => {
    const unavailable = { ...snapshot, status: "unavailable", observedRequests: null, pairedRequests: null,
      inputTokens: null, cacheReadTokens: null, ratio: null, reason: "boundary-unknown" };
    expect(CacheUsageWindowSnapshotSchema.parse(unavailable).ratio).toBeNull();
    expect(CacheUsageWindowSnapshotSchema.safeParse({ ...unavailable, inputTokens: 0 }).success).toBe(false);
  });
  it("supports an initial pre-summary window and rejects malformed update envelopes", () => {
    const initial = { ...snapshot, summaryRevision: 0, summaryCommittedAt: null, boundary: "before-first-summary" };
    expect(CacheUsageUpdateSchema.parse({ revision: 1, snapshot: initial }).snapshot.summaryRevision).toBe(0);
    expect(CacheUsageUpdateSchema.safeParse({ revision: -1, snapshot }).success).toBe(false);
  });
});
