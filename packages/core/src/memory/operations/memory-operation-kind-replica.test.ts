import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryReplicaBank } from "@taki/shared";
import { createHindsightReplicaLeaseRepo } from "../../db/hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaSchedulerRepo, type HindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import type { HindsightReplicaRunInput } from "../hindsight/hindsight-replica-sync-runner.ts";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { AT, CHARACTER, GLOBAL, fakeSetup } from "./memory-operation-fixtures.ts";
import { createMemoryOperationService, type MemoryOperationService } from "./memory-operation-service.ts";

const dbs: Database[] = []; const schedulers: HindsightReplicaScheduler[] = []; const services: MemoryOperationService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const db of dbs.splice(0)) db.close();
});

const UUID = "11111111-1111-4111-8111-111111111111";
const sync = (bankId = "global") => ({ kind: "replica.sync" as const, bankId, syncKind: "incremental" as const });

/** Real B5 scheduler + repos on a temporary SQLite; only the data-plane runner is injected. */
function fixture(banks: MemoryReplicaBank[] = [GLOBAL]) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
  let now = AT; const clock = () => now;
  const repo = createHindsightReplicaSchedulerRepo(db, clock);
  const leases = createHindsightReplicaLeaseRepo(db, clock);
  for (const bank of banks) {
    repo.ensureBank({ bank });
    publishReplicaCheckpoint(db, { previous: null, next: { bankId: bank.bankId, providerLineageId: UUID, bankGeneration: UUID, authorityEpochId: "epoch",
      replicaEpochId: UUID, endCursor: 8, snapshotId: UUID, snapshotCursor: 8, snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: AT } });
  }
  const calls: HindsightReplicaRunInput[] = []; const gates: Array<() => void> = [];
  let holding = false;
  const run = async (input: HindsightReplicaRunInput) => {
    calls.push(input);
    if (holding) await new Promise<void>((resolve) => gates.push(resolve));
    const checkpoint = readReplicaCheckpoint(db, input.bank.bankId);
    if (!checkpoint) throw new Error("fixture missing checkpoint");
    return { checkpoint, observedCursor: checkpoint.endCursor };
  };
  const build = (schedulerRepo: HindsightReplicaSchedulerRepo = repo) => {
    const scheduler = createHindsightReplicaScheduler({ banks, repo: schedulerRepo, replica: { leases, checkpoint: (id) => readReplicaCheckpoint(db, id) },
      ownerId: "process", runner: { run, rebuild: run }, setTimer: () => setTimeout(() => undefined, 0) });
    schedulers.push(scheduler);
    const changes: MemoryOperation[] = [];
    const service = createMemoryOperationService({
      db, setup: fakeSetup(), bootId: "boot", now: clock, logger: createLogger("fatal"), onChanged: (operation) => changes.push(operation),
      live: () => ({ epochId: "epoch", scheduler, banks: () => banks, assertConnection: () => undefined, driftReason: () => "none",
        pendingSummary: () => ({ pendingCount: 0, nativeConfirmedCount: 0, completedCount: 0, supersededCount: 0, failedCount: 0, unknownCount: 0, cancelledCount: 0 }) }),
    });
    services.push(service);
    return { scheduler, service, changes };
  };
  const untilCalls = async (count: number) => { while (calls.length < count) await new Promise((resolve) => setImmediate(resolve)); };
  return { db, repo, calls, build, untilCalls, hold: () => { holding = true; }, release: () => { holding = false; gates.splice(0).forEach((open) => open()); },
    advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); } };
}

describe("replica.sync against the real B5 scheduler", () => {
  it("settles through the changed push right after submit + one awaited tick, with no later status read", async () => {
    const f = fixture(); const { scheduler, service, changes } = f.build();
    scheduler.start(); await scheduler.tick(); f.calls.length = 0; f.advance(1_000);
    const admitted = service.submit(sync());
    expect(admitted.state).toBe("admitted");
    await service.stop();
    expect(f.calls.map((call) => call.run.trigger)).toEqual(["manual"]);
    expect(changes.map((operation) => operation.state)).toEqual(["admitted", "completed"]);
    expect(changes[1]).toMatchObject({ operationId: admitted.operationId, terminalAt: "2026-09-19T00:00:01.000Z",
      result: { kind: "replica", errorCode: null, nextAction: null, lastSuccessAt: "2026-09-19T00:00:01.000Z" } });
  });

  it("never reports a run that was already in flight at admission as this operation's outcome, even in the same millisecond", async () => {
    const f = fixture(); const { scheduler, service, changes } = f.build();
    f.hold(); scheduler.start();
    const drain = scheduler.tick(); await f.untilCalls(1);
    expect(f.calls[0]?.run.trigger).toBe("catch_up");
    const admitted = service.submit(sync());
    expect(service.status(admitted.operationId).state).toBe("admitted");
    // The Bank is busy with the earlier run: nothing may be cancelled or fabricated while it settles.
    expect(() => service.cancel(admitted.operationId)).toThrow(MemoryOperationRefusal);
    f.release(); f.hold(); await f.untilCalls(2);
    expect(f.calls[1]?.run.trigger).toBe("manual");
    expect(service.status(admitted.operationId).state).toBe("running");
    f.release(); await drain; await service.stop();
    expect(changes.map((operation) => operation.state)).toEqual(["admitted", "running", "completed"]);
    expect(changes.at(-1)).toMatchObject({ state: "completed", result: { lastSuccessAt: AT } });
  });

  it("cancels an unclaimed request while another Bank's run holds the drain, and the scheduler never runs it", async () => {
    const f = fixture([GLOBAL, CHARACTER]); const { scheduler, service, changes } = f.build();
    f.hold(); scheduler.start();
    const drain = scheduler.tick(); await f.untilCalls(1);
    expect(f.calls[0]?.bank.bankId).toBe("global");
    const admitted = service.submit(sync("character"));
    expect(f.repo.get("character")?.pendingManualKind).toBe("incremental");
    expect(service.cancel(admitted.operationId)).toMatchObject({ state: "cancelled", reason: "cancelled_before_claim" });
    expect(f.repo.get("character")?.pendingManualKind).toBeNull();
    f.release(); await drain; await service.stop();
    expect(f.calls.map((call) => [call.bank.bankId, call.run.trigger])).toEqual([["global", "catch_up"], ["character", "catch_up"]]);
    expect(changes.map((operation) => operation.state)).toEqual(["admitted", "cancelled"]);
    expect(service.status(admitted.operationId).state).toBe("cancelled");
  });

  it("settles failed with the supervisor code when the drain throws before the claim", async () => {
    const f = fixture();
    const broken: HindsightReplicaSchedulerRepo = { ...f.repo, claim: vi.fn(() => { throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE"); }) };
    const { scheduler, service, changes } = f.build(broken);
    scheduler.start();
    const admitted = service.submit(sync()); await service.stop();
    expect(f.calls).toEqual([]);
    expect(f.repo.get("global")?.pendingManualKind).toBe("incremental");
    expect(changes.map((operation) => operation.state)).toEqual(["admitted", "failed"]);
    expect(service.status(admitted.operationId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_REPLICA_SCHEDULE_STALE",
      result: { kind: "replica", errorCode: "HINDSIGHT_REPLICA_SCHEDULE_STALE", nextAction: "automatic_retry_scheduled" } });
  });
});
