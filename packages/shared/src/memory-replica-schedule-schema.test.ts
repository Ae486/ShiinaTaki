import { describe, expect, it } from "vitest";
import {
  MemoryReplicaBankSchema, MemoryReplicaErrorCodeSchema, MemoryReplicaRunResultSchema,
  MemoryReplicaScheduleConfigSchema, MemoryReplicaSyncStateSchema,
} from "./memory-replica-schedule-schema.ts";

describe("Memory Replica scheduling contracts", () => {
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
