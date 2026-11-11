import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryOperationSchema, MemoryReplicaScheduleConfigSchema, type MemoryOperation, type MemoryReplicaBank, type MemoryReplicaErrorCode } from "@taki/shared";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createHindsightReplicaLeaseRepo } from "../../db/hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaSchedulerRepo, type HindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import { createMethodRegistry, type MethodContext } from "../../server/method-registry.ts";
import { registerMemoryOperationMethods } from "../../server/methods/memory-operation-methods.ts";
import { createMemoryOperationSubscriptions } from "../../server/memory-operation-subscriptions.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import type { HindsightReplicaRunInput } from "../hindsight/hindsight-replica-sync-runner.ts";
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
  db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,reason)
    VALUES ('epoch','local','local-lineage','active',:now,'initial-local')`).run({ now: AT });
  db.prepare("INSERT INTO canonical_memory_authority_state VALUES (1,'epoch',:now)").run({ now: AT });
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
  let holding = false; let manualError: MemoryReplicaErrorCode | null = null;
  const run = async (input: HindsightReplicaRunInput) => {
    calls.push(input);
    if (holding) await new Promise<void>((resolve) => gates.push(resolve));
    if (manualError && input.run.trigger === "manual") throw new Error(manualError);
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
      live: () => ({ epochId: "epoch", configFingerprint: "a".repeat(64), deploymentMode: "existing-instance", scheduler, writeFence: createCanonicalLocalWriteFence(), banks: () => banks, assertConnection: () => undefined, driftReason: () => "none",
        pendingSummary: () => ({ pendingCount: 0, nativeConfirmedCount: 0, completedCount: 0, supersededCount: 0, failedCount: 0, unknownCount: 0, cancelledCount: 0 }) }),
    });
    services.push(service);
    return { scheduler, service, changes };
  };
  const untilCalls = async (count: number) => { while (calls.length < count) await new Promise((resolve) => setImmediate(resolve)); };
  return { db, repo, calls, build, untilCalls, hold: () => { holding = true; }, release: () => { holding = false; gates.splice(0).forEach((open) => open()); },
    failManual: (code: MemoryReplicaErrorCode | null = "HINDSIGHT_UNREACHABLE") => { manualError = code; },
    advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); } };
}

function acceptedPending(db: Database) {
  db.prepare(`INSERT INTO pending_memory(authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES ('epoch','global','accepted','retain',:hash,'submitted',1,:json)`).run({ hash: "a".repeat(64),
    json: JSON.stringify({ acceptedAt: AT, nextRetryAt: "2026-09-19T00:05:00.000Z", diagnosticCode: "HINDSIGHT_PENDING_REMAINS",
      dispatch: { protocol: "tracked_native_v1" }, nativeStatus: { status: "processing" } }) });
}

describe("replica.sync against the real B5 scheduler", () => {
  it("returns terminal waiting through registered submit/status/list and releases the family for an independent check", async () => {
    const f = fixture(); acceptedPending(f.db); f.failManual("HINDSIGHT_PENDING_REMAINS");
    f.repo.ensureBank({ bank: GLOBAL, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    const { scheduler, service, changes } = f.build(); scheduler.start();
    const registry = createMethodRegistry(); registerMemoryOperationMethods(registry, { service,
      subscriptions: createMemoryOperationSubscriptions(), logger: createLogger("fatal") });
    const ctx: MethodContext = { connection: { state: { status: "authenticated", deviceId: "home", role: "operator", capabilities: [] } },
      notify: () => undefined, close: () => undefined, onClose: () => undefined };
    const call = (method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, ctx);
    expect(await call("memory.operations.submit", { request: sync() })).toMatchObject({ result: { operation: { state: "admitted" } } });
    await service.stop(); const waiting = MemoryOperationSchema.parse(changes.at(-1));
    expect(waiting).toMatchObject({ state: "waiting", reason: null, errorCode: null, terminalAt: AT,
      result: { kind: "replica", errorCode: null, nextAction: "explicit_retry_required", lastSuccessAt: null } });
    expect(changes.map((row) => row.state)).toEqual(["admitted", "waiting"]);
    expect(await call("memory.operations.status", { operationId: waiting.operationId })).toMatchObject({ result: { operation: waiting } });
    expect(await call("memory.operations.list", {})).toMatchObject({ result: { operations: [] } });
    expect(await call("memory.operations.list", { includeTerminal: true })).toMatchObject({ result: { operations: [waiting] } });
    const requests = f.db.prepare("SELECT * FROM hindsight_replica_manual_requests").all();
    f.failManual(null); f.advance(1_000);
    expect(await call("memory.operations.submit", { request: sync() })).toMatchObject({ result: { operation: { state: "admitted" } } });
    await service.stop();
    expect(changes.at(-1)?.state).toBe("completed"); expect(service.status(waiting.operationId)).toEqual(waiting);
    expect(f.db.prepare("SELECT * FROM hindsight_replica_manual_requests ORDER BY rowid LIMIT 1").all()).toEqual(requests);
    expect(f.calls.map((call) => call.run.trigger)).toEqual(["manual", "manual"]);
  });

  it("boot observes the exact waiting request before generic unknown fallback without redispatch", () => {
    const f = fixture(); acceptedPending(f.db); const requestId = randomUUID(); const operationId = randomUUID();
    const operations = createMemoryOperationRepo(f.db, () => AT);
    operations.insertAdmitted({ operationId, kind: "replica.sync", family: "replica:global", authorityEpochId: "epoch",
      request: sync(), producer: { kind: "replica", bankId: "global", admittedAt: AT, requestId }, bootId: "previous" });
    f.repo.requestManual({ bankId: "global", kind: "incremental", requestId });
    const run = f.repo.claim({ bankId: "global", ownerId: "previous", leaseDurationMs: 60_000 })!;
    f.repo.fail({ run, errorCode: "HINDSIGHT_PENDING_REMAINS" });
    const { service, changes } = f.build();
    expect(service.status(operationId)).toMatchObject({ state: "waiting", errorCode: null, reason: null,
      result: { nextAction: "automatic_retry_scheduled", lastSuccessAt: null } });
    expect(operations.activeInFamily("replica:global")).toBeUndefined();
    expect(f.repo.request(requestId)).toMatchObject({ state: "waiting", claim: run.lease });
    expect(f.calls).toEqual([]); expect(changes.map((row) => row.state)).toEqual(["waiting"]);
  });

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
    expect(f.repo.get("global")?.pendingManualKind).toBeNull();
    expect(changes.map((operation) => operation.state)).toEqual(["admitted", "failed"]);
    expect(service.status(admitted.operationId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_REPLICA_SCHEDULE_STALE",
      result: { kind: "replica", errorCode: "HINDSIGHT_REPLICA_SCHEDULE_STALE", nextAction: "automatic_retry_scheduled" } });
  });

  it.each([0, 1_000])("attributes a failed manual claim after an earlier success with %i ms between admission and settlement", async (elapsed) => {
    const f = fixture(); const { scheduler, service } = f.build();
    f.hold(); f.failManual(); scheduler.start();
    const drain = scheduler.tick(); await f.untilCalls(1);
    const operation = service.submit(sync()); f.advance(elapsed); f.release();
    await drain; await service.stop();
    const settled = service.status(operation.operationId);
    expect(f.calls.map((call) => call.run.trigger)).toEqual(["catch_up", "manual"]);
    expect(settled).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE",
      result: { errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "automatic_retry_scheduled" } });
    const ref = settled.producer;
    if (ref?.kind !== "replica" || !ref.requestId) throw new Error("missing exact identity");
    expect(f.repo.request(ref.requestId)).toMatchObject({ state: "failed", claim: f.calls[1]!.run.lease });
    expect(f.calls[1]!.run.manualRequestId).toBe(ref.requestId);
  });

  it("cancels only its queued request while an earlier run holds the same Bank", async () => {
    const f = fixture(); const { scheduler, service } = f.build();
    f.hold(); scheduler.start(); const drain = scheduler.tick(); await f.untilCalls(1);
    const operation = service.submit(sync());
    expect(service.cancel(operation.operationId).state).toBe("cancelled");
    expect(f.repo.get("global")?.run?.lease).toEqual(f.calls[0]!.run.lease);
    f.release(); await drain; await service.stop();
    expect(f.calls).toHaveLength(1);
    expect(service.status(operation.operationId).state).toBe("cancelled");
  });

  it("never attributes another Bank's supervisor error to an unclaimed request", async () => {
    const f = fixture([GLOBAL, CHARACTER]);
    const broken: HindsightReplicaSchedulerRepo = { ...f.repo, claim: (input) => {
      if (input.bankId === GLOBAL.bankId) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
      return undefined;
    } };
    const { scheduler, service } = f.build(broken); scheduler.start();
    const operation = service.submit(sync(CHARACTER.bankId)); await service.stop();
    expect(scheduler.lastError()).toBe("HINDSIGHT_REPLICA_SCHEDULE_STALE");
    expect(service.status(operation.operationId).state).toBe("admitted");
    expect(service.cancel(operation.operationId).state).toBe("cancelled");
  });

  it("keeps a committed request unresolved when the admission status read fails", async () => {
    const f = fixture(); let unreadable = false;
    const repo: HindsightReplicaSchedulerRepo = { ...f.repo,
      requestManual: (input) => { const state = f.repo.requestManual(input); unreadable = true; return state; },
      get: (bankId) => { if (unreadable) throw new Error("fixture status unavailable"); return f.repo.get(bankId); },
    };
    const { scheduler, service, changes } = f.build(repo); scheduler.start();
    const operation = service.submit(sync()); await service.stop();
    expect(f.repo.get(GLOBAL.bankId)?.pendingManualRequestId).toBeTruthy();
    expect(changes.map((row) => row.state)).toEqual(["admitted"]);
    unreadable = false;
    expect(service.status(operation.operationId).state).toBe("admitted");
    await scheduler.tick();
    expect(service.status(operation.operationId).state).toBe("completed");
    expect(f.calls.filter((call) => call.run.trigger === "manual")).toHaveLength(1);
  });

  it("does not turn an unavailable receipt read into a failed operation after execution", async () => {
    const f = fixture(); let unreadable = true;
    const repo: HindsightReplicaSchedulerRepo = { ...f.repo, request: (requestId) => {
      if (unreadable) throw new Error("fixture receipt unavailable"); return f.repo.request(requestId);
    } };
    const { scheduler, service, changes } = f.build(repo); scheduler.start();
    const operation = service.submit(sync()); await service.stop();
    expect(changes.map((row) => row.state)).toEqual(["admitted"]);
    unreadable = false;
    expect(service.status(operation.operationId).state).toBe("completed");
    expect(f.calls.filter((call) => call.run.trigger === "manual")).toHaveLength(1);
  });
});
