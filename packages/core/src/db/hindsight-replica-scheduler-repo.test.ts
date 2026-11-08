import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MemoryReplicaScheduleConfigSchema, type MemoryReplicaCheckpoint } from "@taki/shared";
import { createHindsightReplicaSchedulerRepo, type HindsightReplicaSchedulerRepo } from "./hindsight-replica-scheduler-repo.ts";
import { replicaNextWake, replicaScheduleDue } from "./hindsight-replica-schedule-state.ts";
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
  it.each(["retry", "manual", "catch_up"] as const)("consumes the outstanding retry on a %s claim and clears it on plain success", (trigger) => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db);
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_UNREACHABLE" });
    f.advance(60_000);
    if (trigger === "manual") f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    if (trigger === "catch_up") f.repo.requestCatchUp(bank.bankId);
    const run = take(f.repo);
    expect(run).toMatchObject({ trigger, kind: "full" });
    expect(f.repo.get(bank.bankId)).toMatchObject({ run, retryDueAt: null, retryAttempt: 1, retryKind: "full" });
    expect(f.repo.succeed({ run, result: { checkpoint, observedCursor: 8 } })).toMatchObject({
      run: null, retryDueAt: null, retryAttempt: 0, retryKind: null, consecutiveFailures: 0,
    });
  });

  it.each(["interval", "manual", "catch_up", "retry"] as const)("preserves a retry requested during a %s run and claims it at its due time", (trigger) => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db);
    if (trigger === "retry") {
      f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
      f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_UNREACHABLE" }); f.advance(60_000);
      f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_UNREACHABLE" }); f.advance(300_000);
    }
    if (trigger === "manual") f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    if (trigger === "catch_up") f.repo.requestCatchUp(bank.bankId);
    const run = take(f.repo); expect(run.trigger).toBe(trigger);
    const dueAt = new Date(Date.parse(f.repo.now()) + 30_000).toISOString();
    const kind = trigger === "retry" ? "full" : "incremental";
    f.repo.requestRetry(bank.bankId, dueAt); f.advance(1_000);
    const settled = f.repo.succeed({ run, result: { checkpoint, observedCursor: 8 } });
    expect(settled).toMatchObject({ run: null, retryDueAt: dueAt, retryAttempt: 1, retryKind: kind, consecutiveFailures: 0 });
    expect(replicaNextWake(settled, f.repo.now())).toBe(dueAt);
    f.advance(28_999);
    expect(replicaScheduleDue(settled, f.repo.now())).toBeUndefined();
    expect(f.repo.claim({ bankId: bank.bankId, ownerId: "process-a", leaseDurationMs: 60_000 })).toBeUndefined();
    f.advance(1);
    expect(replicaScheduleDue(settled, f.repo.now())).toEqual({ trigger: "retry", kind });
    const retry = take(f.repo); expect(retry).toMatchObject({ trigger: "retry", kind });
    expect(f.repo.succeed({ run: retry, result: { checkpoint, observedCursor: 8 } })).toMatchObject({
      retryDueAt: null, retryAttempt: 0, retryKind: null,
    });
  });

  it.each(["fail", "recover"] as const)("keeps failure backoff after a consumed retry and new request settle via %s", (settlement) => {
    const f = fixture();
    f.repo.requestManual({ bankId: bank.bankId, kind: "full" });
    f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_UNREACHABLE" }); f.advance(60_000);
    const run = take(f.repo);
    f.repo.requestRetry(bank.bankId, new Date(Date.parse(f.repo.now()) + 10_000).toISOString());
    if (settlement === "recover") f.advance(60_000);
    const state = settlement === "fail" ? f.repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" }) : f.repo.recover(bank.bankId);
    expect(state).toMatchObject({ run: null, mode: "failed", retryAttempt: 2, retryKind: "full", consecutiveFailures: 2 });
    expect(Date.parse(state.retryDueAt!) - Date.parse(f.repo.now())).toBe(300_000);
  });

  it.each([
    { first: 30_000, second: 45_000, earliest: 30_000 },
    { first: 45_000, second: 30_000, earliest: 30_000 },
    { first: 90_000, second: 120_000, earliest: 60_000 },
  ])("keeps the earliest pending request or lease expiry during one run: %j", ({ first, second, earliest }) => {
    const f = fixture(); const run = take(f.repo);
    const dueAt = (delay: number) => new Date(Date.parse(at) + delay).toISOString();
    f.repo.requestRetry(bank.bankId, dueAt(first));
    expect(f.repo.requestRetry(bank.bankId, dueAt(second))).toMatchObject({ run, retryDueAt: dueAt(earliest), retryAttempt: 1 });
  });

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

  it("holds a provider rollback for explicit runs only until a success clears it", () => {
    const f = fixture(); const checkpoint = installCheckpoint(f.db);
    const held = { mode: "failed", errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED", nextAction: "explicit_retry_required",
      retryAttempt: 0, retryKind: null, retryDueAt: null };
    expect(f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" })).toMatchObject(held);
    f.advance(7 * 60 * 60_000);
    expect(f.repo.requestCatchUp(bank.bankId).catchUpRequested).toBe(false);
    expect(f.repo.claim({ bankId: bank.bankId, ownerId: "process-a", leaseDurationMs: 60_000 })).toBeUndefined();
    expect(replicaNextWake(f.repo.get(bank.bankId)!, f.repo.now())).toBeNull();
    expect(f.repo.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({}) })).toMatchObject(held);

    f.repo.requestManual({ bankId: bank.bankId, kind: "incremental" });
    expect(replicaNextWake(f.repo.get(bank.bankId)!, f.repo.now())).toBe(f.repo.now());
    expect(f.repo.fail({ run: take(f.repo), errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" }))
      .toMatchObject({ ...held, consecutiveFailures: 2 });
    f.repo.requestManual({ bankId: bank.bankId, kind: "incremental" });
    expect(f.repo.succeed({ run: take(f.repo), result: { checkpoint, observedCursor: 8 } }))
      .toMatchObject({ mode: "idle", errorCode: null, nextAction: null, consecutiveFailures: 0 });
    f.advance(6 * 60 * 60_000);
    expect(take(f.repo)).toMatchObject({ kind: "incremental", trigger: "interval" });
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
