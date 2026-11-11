import { describe, expect, it } from "vitest";
import {
  MemoryReplicaBankSchema, MemoryReplicaErrorCodeSchema, MemoryReplicaRunResultSchema,
  MemoryReplicaScheduleConfigSchema, MemoryReplicaSyncStateSchema, MemoryReplicaSyncStatusSchema,
  type MemoryReplicaSyncState,
} from "./memory-replica-schedule-schema.ts";

const at = "2026-09-06T00:00:00.000Z";
function runningRetry(): MemoryReplicaSyncState {
  return { ...MemoryReplicaScheduleConfigSchema.parse({}), bankId: "global", scope: "global", characterId: null,
    mode: "running", run: { kind: "incremental", trigger: "retry", predecessor: null, lease: {
      bankId: "global", ownerId: "process", runId: "11111111-1111-4111-8111-111111111111", fence: 1,
      expiresAt: "2026-09-06T00:01:00.000Z" } }, fullReconciliationState: "idle",
    nextDueAt: at, nextFullDueAt: at, retryAttempt: 2, retryKind: "incremental", retryDueAt: null,
    pendingManualKind: null, catchUpRequested: false, lastAttemptAt: at, lastSuccessAt: null,
    lastFullReconciliationAt: null, lastObservedCursor: null, lastObservedLineageId: null,
    lastObservedBankGeneration: null, consecutiveFailures: 2, errorCode: "HINDSIGHT_UNREACHABLE",
    nextAction: "automatic_retry_scheduled", createdAt: at, updatedAt: at };
}

describe("Memory Replica scheduling contracts", () => {
  it("permits accepted waiting with zero failure backoff and preserves it during the next claim", () => {
    const state = { ...runningRetry(), mode: "waiting", run: null, fullReconciliationState: "waiting",
      retryAttempt: 0, retryDueAt: at, errorCode: null, consecutiveFailures: 0 };
    expect(MemoryReplicaSyncStateSchema.safeParse(state).success).toBe(true);
    expect(MemoryReplicaSyncStateSchema.safeParse({ ...state, mode: "running", run: runningRetry().run,
      fullReconciliationState: "waiting", retryDueAt: null }).success).toBe(true);
    for (const patch of [{ errorCode: "HINDSIGHT_UNREACHABLE" }, { nextAction: null }, { retryDueAt: null }]) {
      expect(MemoryReplicaSyncStateSchema.safeParse({ ...state, ...patch }).success).toBe(false);
    }
    expect(MemoryReplicaSyncStateSchema.safeParse({ ...state, automatic: false, nextDueAt: null, nextFullDueAt: null,
      retryDueAt: null, retryKind: null, nextAction: "explicit_retry_required" }).success).toBe(true);
  });

  it.each([null, at])("accepts active retry backoff with due time %s in durable state and status", (retryDueAt) => {
    const state = { ...runningRetry(), retryDueAt };
    expect(MemoryReplicaSyncStateSchema.parse(state)).toEqual(state);
    expect(MemoryReplicaSyncStatusSchema.parse({ ...state, checkpoint: null, lag: null })).toMatchObject(state);
  });

  it.each(["idle", "failed"] as const)("rejects consumed retry metadata without a run in %s mode", (mode) => {
    const state = { ...runningRetry(), run: null, mode };
    expect(MemoryReplicaSyncStateSchema.safeParse(state).success).toBe(false);
    expect(MemoryReplicaSyncStateSchema.safeParse({ ...state, retryDueAt: at }).success).toBe(true);
    expect(MemoryReplicaSyncStateSchema.safeParse({ ...state, retryAttempt: 0, retryKind: null }).success).toBe(true);
  });

  it.each([
    { retryDueAt: null, retryAttempt: 0, retryKind: "incremental" },
    { retryDueAt: null, retryAttempt: 2, retryKind: null },
    { retryDueAt: at, retryAttempt: 0, retryKind: "incremental" },
    { retryDueAt: at, retryAttempt: 2, retryKind: null },
  ])("rejects incomplete retry metadata even during a run: %j", (retry) => {
    expect(MemoryReplicaSyncStateSchema.safeParse({ ...runningRetry(), ...retry }).success).toBe(false);
  });

  it("defaults to independent six-hour polling and seven-day reconciliation", () => {
    expect(MemoryReplicaScheduleConfigSchema.parse({})).toEqual({ automatic: true,
      autoIntervalMs: 6 * 60 * 60_000, fullReconciliationIntervalMs: 7 * 24 * 60 * 60_000 });
  });

  it("accepts explicit manual mode and bounded independent intervals", () => {
    expect(MemoryReplicaScheduleConfigSchema.parse({ automatic: false, autoIntervalMs: 120_000,
      fullReconciliationIntervalMs: 180_000 }).automatic).toBe(false);
    expect(MemoryReplicaScheduleConfigSchema.safeParse({ autoIntervalMs: 0 }).success).toBe(false);
    expect(MemoryReplicaScheduleConfigSchema.safeParse({ fullReconciliationIntervalMs: Number.MAX_SAFE_INTEGER }).success).toBe(false);
  });

  it("requires Character ownership only for Character Banks", () => {
    expect(MemoryReplicaBankSchema.safeParse({ bankId: "global", scope: "global", characterId: "taki" }).success).toBe(false);
    expect(MemoryReplicaBankSchema.safeParse({ bankId: "character", scope: "character", characterId: null }).success).toBe(false);
  });

  it("uses a closed diagnostic vocabulary rather than arbitrary uppercase text", () => {
    expect(MemoryReplicaErrorCodeSchema.safeParse("PRIVATE_PROVIDER_TOKEN_123").success).toBe(false);
    expect(MemoryReplicaErrorCodeSchema.safeParse("HINDSIGHT_REPLICA_LEASE_LOST").success).toBe(true);
  });

  it("rejects a cursor observation older than its reported checkpoint", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(MemoryReplicaRunResultSchema.safeParse({ observedCursor: 4, checkpoint: {
      providerLineageId: uuid, bankId: "global", bankGeneration: uuid, authorityEpochId: "authority", replicaEpochId: uuid,
      endCursor: 5, snapshotId: uuid, snapshotCursor: 0, snapshotManifestDigest: "a".repeat(64),
      manifestDigest: "b".repeat(64), verifiedAt: "2026-09-06T00:00:00.000Z",
    } }).success).toBe(false);
  });

  it("requires complete state rather than inventing unknown telemetry defaults", () => {
    expect(MemoryReplicaSyncStateSchema.safeParse({ bankId: "global", lag: 0, consecutiveFailures: 0 }).success).toBe(false);
  });
});
