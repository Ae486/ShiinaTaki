import { describe, expect, it } from "vitest";
import { MemoryAuthorityStatusSchema } from "./memory-authority-status-schema.ts";

const at = "2026-09-19T00:00:00.000Z";
const setup = {
  revision: 0, phase: "unconfigured", lastSuccessfulPhase: null, configFingerprint: null, attemptId: null, compatibility: null,
  banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: null, updatedAt: at,
} as const;
const local = {
  authority: { mode: "canonical-local", epochId: "epoch", providerLineageId: null },
  runtime: { providerId: "local", available: true, unavailableReason: null },
  setup, replica: null, pending: null, operations: { active: [], recent: [] }, derivedFreshness: "unknown", observedAt: at,
} as const;
const summary = { pendingCount: 0, nativeConfirmedCount: 0, completedCount: 2, supersededCount: 0, failedCount: 1, unknownCount: 1, cancelledCount: 0 };

describe("memory authority status contract", () => {
  it("accepts Local mode with null replica/pending evidence", () => {
    expect(MemoryAuthorityStatusSchema.parse(local)).toEqual(local);
  });

  it("requires replica and pending evidence exactly when the Hindsight runtime is available", () => {
    const hindsight = { ...local, authority: { mode: "hindsight", epochId: "epoch", providerLineageId: "11111111-1111-4111-8111-111111111111" },
      runtime: { providerId: "hindsight", available: true, unavailableReason: null } } as const;
    expect(MemoryAuthorityStatusSchema.safeParse(hindsight).success).toBe(false);
    expect(MemoryAuthorityStatusSchema.safeParse({ ...hindsight, replica: [], pending: [{ bankId: "global", summary, parentWritesPending: 0 }] }).success).toBe(true);
    const unavailable = { ...hindsight, runtime: { providerId: "hindsight", available: false, unavailableReason: "authority_mismatch" } } as const;
    expect(MemoryAuthorityStatusSchema.safeParse(unavailable).success).toBe(true);
    expect(MemoryAuthorityStatusSchema.safeParse({ ...unavailable, replica: [] }).success).toBe(false);
  });

  it("refuses fabricated freshness and mismatched availability reasons", () => {
    expect(MemoryAuthorityStatusSchema.safeParse({ ...local, derivedFreshness: "fresh" }).success).toBe(false);
    expect(MemoryAuthorityStatusSchema.safeParse({ ...local, runtime: { providerId: "local", available: true, unavailableReason: "stopped" } }).success).toBe(false);
  });
});
