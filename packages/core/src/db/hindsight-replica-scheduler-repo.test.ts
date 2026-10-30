import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MemoryReplicaScheduleConfigSchema, type MemoryReplicaCheckpoint } from "@taki/shared";
import { createHindsightReplicaSchedulerRepo, type HindsightReplicaSchedulerRepo } from "./hindsight-replica-scheduler-repo.ts";
import { publishReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const at = "2026-09-06T00:00:00.000Z";
const bank = { bankId: "global", scope: "global" as const, characterId: null };
const dbs: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-b5-schedule-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db);
  let now = at;
  const repo = createHindsightReplicaSchedulerRepo(db, () => now);
  repo.ensureBank({ bank });
  return { db, repo, advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); } };
}
function take(repo: HindsightReplicaSchedulerRepo) {
  const run = repo.claim({ bankId: bank.bankId, ownerId: "process-a", leaseDurationMs: 60_000 });
  if (!run) throw new Error("fixture run was not due");
  return run;
}
function installCheckpoint(db: Database): MemoryReplicaCheckpoint {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const checkpoint = { bankId: bank.bankId, providerLineageId: uuid, bankGeneration: uuid,
    authorityEpochId: "authority", replicaEpochId: uuid, endCursor: 8, snapshotId: uuid, snapshotCursor: 8,
    snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: at };
  db.transaction(() => publishReplicaCheckpoint(db, { previous: null, next: checkpoint }));
  return checkpoint;
}

describe("B5 durable scheduler recovery regressions", () => {
  it("preserves an explicit manual configuration when rediscovering the Bank", () => {
    const { repo } = fixture();
    repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false, autoIntervalMs: 120_000 }) });
    expect(repo.ensureBank({ bank })).toMatchObject({ automatic: false, autoIntervalMs: 120_000,
      nextDueAt: null, nextFullDueAt: null, retryDueAt: null });
    expect(() => repo.ensureBank({ bank: { ...bank, scope: "character", characterId: "taki" } }))
      .toThrow("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  });

  it("claims a durable running state and its predecessor before invoking a runner", () => {
    const { repo, db } = fixture(); const checkpoint = installCheckpoint(db);
    repo.requestManual({ bankId: bank.bankId, kind: "full" });
    const run = take(repo);
    expect(repo.get(bank.bankId)).toMatchObject({ mode: "running", run, fullReconciliationState: "running", pendingManualKind: null });
    expect(run).toMatchObject({ kind: "full", trigger: "manual", predecessor: checkpoint });
    expect(repo.claim({ bankId: bank.bankId, ownerId: "process-b", leaseDurationMs: 60_000 })).toBeUndefined();
  });

  it("does not discard or downgrade a manual request arriving during a failed run", () => {
    const { repo } = fixture(); const run = take(repo);
    repo.requestManual({ bankId: bank.bankId, kind: "full" });
    repo.requestManual({ bankId: bank.bankId, kind: "incremental" });
    repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" });
    expect(repo.get(bank.bankId)?.pendingManualKind).toBe("full");
    const next = take(repo);
    expect(next).toMatchObject({ kind: "full", trigger: "manual" });
    expect(next.lease.fence).toBe(run.lease.fence + 1);
  });

  it("rejects an arbitrary diagnostic before persisting any state", () => {
    const { repo } = fixture(); const run = take(repo); const before = repo.get(bank.bankId);
    // @ts-expect-error Untrusted diagnostics must be rejected even if a caller bypasses the typed API.
    expect(() => repo.fail({ run, errorCode: "API_KEY=private-value" })).toThrow();
    expect(repo.get(bank.bankId)).toEqual(before);
  });

  it("counts a failed manual attempt without creating a background retry", () => {
    const { repo } = fixture();
    repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    repo.requestManual({ bankId: bank.bankId, kind: "incremental" });
    repo.fail({ run: take(repo), errorCode: "HINDSIGHT_UNREACHABLE" });
    expect(repo.get(bank.bankId)).toMatchObject({ consecutiveFailures: 1, retryDueAt: null, retryKind: null, retryAttempt: 0 });
    expect(repo.requestCatchUp(bank.bankId).catchUpRequested).toBe(false);
    expect(repo.claim({ bankId: bank.bankId, ownerId: "process-a", leaseDurationMs: 60_000 })).toBeUndefined();
  });

  it("honors every persisted retry delay even when the ordinary and full polls are overdue", () => {
    const f = fixture();
    f.repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ fullReconciliationIntervalMs: 60_000 }) });
    const delays = [60_000, 300_000, 900_000, 3_600_000, 21_600_000, 21_600_000, 21_600_000];
    for (const [index, delay] of delays.entries()) {
      const run = take(f.repo);
      const state = f.repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" });
      expect(Date.parse(state.retryDueAt!) - Date.parse(f.repo.now())).toBe(delay);
      expect(state.consecutiveFailures).toBe(index + 1);
      expect(state.retryAttempt).toBe(Math.min(5, index + 1));
      f.advance(delay - 1);
      expect(f.repo.claim({ bankId: bank.bankId, ownerId: "process-a", leaseDurationMs: 60_000 })).toBeUndefined();
      f.advance(1);
    }
  });

  it("bypasses retry once on verified reconnection and clears failure state after checkpoint-bound success", () => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db);
    f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_UNREACHABLE" });
    f.repo.requestCatchUp(bank.bankId);
    const run = take(f.repo);
    expect(run.trigger).toBe("catch_up");
    const state = f.repo.succeed({ run, result: { checkpoint, observedCursor: 11 } });
    expect(state).toMatchObject({ mode: "idle", consecutiveFailures: 0, retryAttempt: 0,
      retryDueAt: null, retryKind: null, catchUpRequested: false, lastObservedCursor: 11, errorCode: null });
    expect(Date.parse(state.nextDueAt!) - Date.parse(f.repo.now())).toBe(6 * 60 * 60_000);
    expect(f.repo.requestCatchUp(bank.bankId).catchUpRequested).toBe(false);
  });

  it("keeps manual full reconciliation pending after an in-flight success", () => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db); const run = take(f.repo);
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    f.repo.succeed({ run, result: { checkpoint, observedCursor: 8 } });
    const full = take(f.repo);
    const state = f.repo.succeed({ run: full, result: { checkpoint, observedCursor: 8 } });
    expect(state).toMatchObject({ lastFullReconciliationAt: at, fullReconciliationState: "succeeded" });
    expect(Date.parse(state.nextFullDueAt!) - Date.parse(f.repo.now())).toBe(7 * 24 * 60 * 60_000);
  });

  it.each([false, true])("preserves disabled scheduling and queued manual work through in-flight failure=%s", (failure) => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db);
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" }); const run = take(f.repo);
    f.repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false,
      autoIntervalMs: 120_000, fullReconciliationIntervalMs: 180_000 }) });
    f.repo.requestManual({ bankId: bank.bankId, kind: "incremental" }); f.advance(1_000);
    const state = failure ? f.repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" })
      : f.repo.succeed({ run, result: { checkpoint, observedCursor: 8 } });
    expect(state).toMatchObject({ automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 180_000,
      pendingManualKind: "incremental", nextDueAt: null, nextFullDueAt: null, retryDueAt: null,
      lastAttemptAt: at, fullReconciliationState: failure ? "failed" : "succeeded" });
    expect(state.lastFullReconciliationAt).toBe(failure ? null : f.repo.now());
    expect(take(f.repo)).toMatchObject({ kind: "incremental", trigger: "manual" });
  });

  it("refuses stale owner/run/fence and checkpoint settlement without changing current status", () => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db); const run = take(f.repo);
    expect(() => f.repo.fail({ run: { ...run, lease: { ...run.lease, ownerId: "other" } }, errorCode: "HINDSIGHT_UNREACHABLE" }))
      .toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(() => f.repo.succeed({ run, result: { checkpoint: { ...checkpoint, endCursor: 9 }, observedCursor: 9 } }))
      .toThrow("HINDSIGHT_REPLICA_RESULT_INVALID");
    expect(f.repo.get(bank.bankId)?.run).toEqual(run);
    f.advance(60_000);
    f.repo.recover(bank.bankId); const next = take(f.repo);
    const before = f.repo.get(bank.bankId);
    expect(() => f.repo.succeed({ run, result: { checkpoint, observedCursor: 8 } })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(() => f.repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.repo.get(bank.bankId)).toEqual(before);
    expect(next.lease.fence).toBe(run.lease.fence + 1);
  });

  it("reopens durable retry/manual state and recovers an expired run once", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-b5-schedule-")); roots.push(root);
    const path = join(root, "workspace.db"); const f = fixture(path);
    const run = take(f.repo);
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    f.db.close();
    const reopened = fixture(path); reopened.advance(60_000);
    expect(reopened.repo.get(bank.bankId)?.pendingManualKind).toBe("full");
    expect(reopened.repo.recover(bank.bankId)).toMatchObject({ mode: "failed",
      errorCode: "HINDSIGHT_REPLICA_LEASE_LOST", consecutiveFailures: 1, catchUpRequested: true });
    const recovered = take(reopened.repo);
    expect(recovered).toMatchObject({ kind: "full", trigger: "manual" });
    expect(recovered.lease.fence).toBe(run.lease.fence + 1);
    const failed = reopened.repo.fail({ run: recovered, errorCode: "HINDSIGHT_UNREACHABLE" });
    reopened.db.close();
    const again = fixture(path);
    expect(again.repo.get(bank.bankId)).toEqual(failed);
    expect(again.repo.ensureBank({ bank }).retryDueAt).toBe(failed.retryDueAt);
  });

  it("rolls back schedule settlement and lease release together on a durable write failure", () => {
    const f = fixture(); const run = take(f.repo); const before = f.repo.get(bank.bankId);
    f.db.exec("CREATE TRIGGER fail_schedule BEFORE UPDATE ON hindsight_replica_sync_schedule BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    expect(() => f.repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" })).toThrow("injected");
    expect(f.repo.get(bank.bankId)).toEqual(before);
    expect(f.db.prepare("SELECT expires_at FROM hindsight_replica_sync_leases WHERE bank_id='global'").get()?.expires_at).toBe(run.lease.expiresAt);
  });

  it("cancels an unclaimed manual request and refuses once the run is claimed", () => {
    const f = fixture();
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    expect(f.repo.cancelManual(bank.bankId)).toMatchObject({ pendingManualKind: null, run: null });
    expect(f.repo.cancelManual(bank.bankId).pendingManualKind).toBeNull();
    f.repo.requestManual({ bankId: bank.bankId, kind: "incremental" });
    const run = take(f.repo);
    expect(() => f.repo.cancelManual(bank.bankId)).toThrow("HINDSIGHT_REPLICA_BUSY");
    expect(f.repo.get(bank.bankId)).toMatchObject({ run, mode: "running" });
  });
});
