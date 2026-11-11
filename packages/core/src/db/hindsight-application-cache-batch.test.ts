import { afterEach, expect, it, vi } from "vitest";
import { curatorTestFixture } from "../memory/hindsight/hindsight-policy-curator-fixtures.ts";
import * as checkpoints from "./hindsight-application-replica-checkpoint.ts";

afterEach(() => vi.restoreAllMocks());

// Failure modes: batching bypasses a stale lease/checkpoint or returns damaged
// bytes as a cache hit. These bytes cannot authorize a Native effect.
it.each(["lease", "checkpoint", "body"] as const)("refuses a cache batch after %s changes", async (damage) => {
  const f = curatorTestFixture(); const bank = f.banks[0]!;
  const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "cache-batch", durationMs: 60_000 });
  const guard = { ...bank.scope, authorityEpochId: "epoch", expectedBank: { bankId: bank.scope.bankId, scope: "global" as const, characterId: null },
    expectedCheckpoint: f.replica.checkpoint(bank.scope.bankId)!, expectedNativeCheckpoint: f.replica.nativeCheckpoint(bank.scope.bankId)!,
    lease, deadlineAt: new Date(Date.parse(f.clock.at) + 60_000).toISOString(), refs: bank.artifacts.map((entry) => entry.body.ref) };
  try {
    expect(f.replica.cachedBodies(guard).size).toBe(guard.refs.length);
    if (damage === "lease") f.replica.leases.release(lease);
    if (damage === "checkpoint") f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash").run({ hash: "0".repeat(64) });
    if (damage === "body") f.db.exec("UPDATE hindsight_application_replica_bodies SET body_bytes=zeroblob(total_bytes)");
    expect(() => f.replica.cachedBodies(guard)).toThrow(damage === "lease" ? "HINDSIGHT_REPLICA_LEASE_LOST"
      : damage === "checkpoint" ? "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID" : "HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
    expect(bank.server.calls).toHaveLength(0);
  } finally { if (damage !== "lease") f.replica.leases.release(lease); await f.close(); }
});

it("checks one synchronous cache batch independently of its number of references", async () => {
  const f = curatorTestFixture(); const bank = f.banks[0]!;
  const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "cache-batch", durationMs: 60_000 });
  const guard = { ...bank.scope, authorityEpochId: "epoch", expectedBank: { bankId: bank.scope.bankId, scope: "global" as const, characterId: null },
    expectedCheckpoint: f.replica.checkpoint(bank.scope.bankId)!, expectedNativeCheckpoint: f.replica.nativeCheckpoint(bank.scope.bankId)!,
    lease, deadlineAt: new Date(Date.parse(f.clock.at) + 60_000).toISOString() };
  const publication = vi.spyOn(checkpoints, "assertApplicationPublication");
  try {
    for (const refs of [bank.artifacts.slice(0, 1), bank.artifacts]) {
      publication.mockClear();
      expect(f.replica.cachedBodies({ ...guard, refs: refs.map((entry) => entry.body.ref) }).size).toBe(refs.length);
      expect(publication).toHaveBeenCalledTimes(2);
    }
  } finally { f.replica.leases.release(lease); await f.close(); }
});
