import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";
import { AT, CHARACTER, GLOBAL, fakeRuntime, fakeSetup, setupSnapshot, type FakeRuntime } from "./memory-operation-fixtures.ts";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { createMemoryOperationService, type MemoryOperationService } from "./memory-operation-service.ts";

const dbs: Database[] = [];
const services: MemoryOperationService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const db of dbs.splice(0)) db.close();
});

function fixture(options: { runtime?: FakeRuntime | null; bootId?: string; db?: Database } = {}) {
  const db = options.db ?? openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  if (!options.db) {
    dbs.push(db);
    db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
  }
  let now = AT;
  const clock = () => now;
  const runtime = options.runtime === undefined ? fakeRuntime([GLOBAL, CHARACTER], clock) : options.runtime;
  const setup = fakeSetup();
  const changes: MemoryOperation[] = [];
  const service = createMemoryOperationService({ db, live: () => runtime, setup, bootId: options.bootId ?? "boot-a", now: clock,
    onChanged: (operation) => changes.push(operation), logger: createLogger("fatal") });
  services.push(service);
  return { db, runtime, setup, service, changes, advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const sync = (bankId = "global", syncKind: "incremental" | "full" = "incremental") => ({ kind: "replica.sync" as const, bankId, syncKind });
function refusal(run: () => unknown) {
  try { run(); } catch (error) { if (error instanceof MemoryOperationRefusal) return error; throw error; }
  throw new Error("expected a refusal");
}

describe("memory operation service — replica.sync", () => {
  it("admits immediately, is readable from any caller while running, and settles completed after the tick", async () => {
    const f = fixture(); const release = f.runtime!.scheduler.hold();
    const admitted = f.service.submit(sync());
    expect(admitted).toMatchObject({ state: "admitted", kind: "replica.sync", authorityEpochId: "epoch", producer: { kind: "replica", bankId: "global", admittedAt: AT }, result: null });
    expect(f.runtime!.scheduler.requestManual).toHaveBeenCalledWith("global", "incremental", expect.any(String));
    expect(f.runtime!.scheduler.status("global")[0]?.pendingManualKind).toBe("incremental");
    expect(f.service.status(admitted.operationId).state).toBe("admitted");
    expect(f.service.list({ includeTerminal: false, limit: 20 }).map((operation) => operation.operationId)).toEqual([admitted.operationId]);
    f.advance(1_000); release(); await f.service.stop();
    const settled = f.service.status(admitted.operationId);
    expect(settled).toMatchObject({ state: "completed", reason: null, errorCode: null, terminalAt: "2026-09-19T00:00:01.000Z",
      producer: { kind: "replica", bankId: "global", admittedAt: AT }, result: { kind: "replica", errorCode: null, nextAction: null, lastSuccessAt: "2026-09-19T00:00:01.000Z" } });
    expect(f.service.list({ includeTerminal: false, limit: 20 })).toEqual([]);
    expect(f.service.list({ includeTerminal: true, limit: 20 })).toEqual([settled]);
    expect(f.changes.map((operation) => operation.state)).toEqual(["admitted", "completed"]);
  });

  it("refuses a second request for the same Bank with the active id and keeps other Banks independent", async () => {
    const f = fixture(); const release = f.runtime!.scheduler.hold();
    const first = f.service.submit(sync());
    const refused = refusal(() => f.service.submit(sync("global", "full")));
    expect(refused).toMatchObject({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: first.operationId });
    expect(f.service.submit(sync("character")).state).toBe("admitted");
    expect(f.runtime!.scheduler.requestManual).toHaveBeenCalledTimes(2);
    release();
  });

  it("settles failed with the Bank's diagnostic; manual mode yields explicit_retry_required", async () => {
    const f = fixture();
    f.runtime!.scheduler.program({ kind: "failure", errorCode: "HINDSIGHT_UNREACHABLE" });
    const automatic = f.service.submit(sync()); await f.service.stop();
    expect(f.service.status(automatic.operationId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_UNREACHABLE",
      result: { kind: "replica", errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "automatic_retry_scheduled" } });
    f.advance(1_000); f.runtime!.scheduler.program({ kind: "failure", errorCode: "HINDSIGHT_TIMEOUT", automatic: false });
    const manual = f.service.submit(sync("character")); await f.service.stop();
    expect(f.service.status(manual.operationId)).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_TIMEOUT",
      result: { nextAction: "explicit_retry_required" } });
    f.advance(1_000); f.runtime!.scheduler.program({ kind: "supervisor", errorCode: "HINDSIGHT_REPLICA_SYNC_FAILED" });
    const supervisor = f.service.submit(sync()); await f.service.stop();
    expect(f.service.status(supervisor.operationId)).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_REPLICA_SYNC_FAILED",
      result: { nextAction: "automatic_retry_scheduled" } });
  });

  it("cancels an admitted request by clearing the manual claim and ignores the late tick", async () => {
    const f = fixture(); const release = f.runtime!.scheduler.hold();
    const admitted = f.service.submit(sync());
    const cancelled = f.service.cancel(admitted.operationId);
    expect(cancelled).toMatchObject({ state: "cancelled", reason: "cancelled_before_claim", terminalAt: AT });
    expect(f.runtime!.scheduler.status("global")[0]?.pendingManualKind).toBeNull();
    f.advance(1_000); release(); await f.service.stop();
    expect(f.service.status(admitted.operationId)).toEqual(cancelled);
    expect(refusal(() => f.service.cancel(admitted.operationId)).reason).toBe("MEMORY_OPERATION_SETTLED");
    expect(f.service.submit(sync()).state).toBe("admitted");
  });

  it("marks a claimed run running on observation, refuses its cancel, and settles from the later Bank state", async () => {
    const f = fixture(); f.runtime!.scheduler.program({ kind: "claim" });
    const admitted = f.service.submit(sync()); await f.service.stop();
    const observed = f.service.status(admitted.operationId);
    expect(observed.state).toBe("running");
    expect(refusal(() => f.service.cancel(admitted.operationId)).reason).toBe("MEMORY_OPERATION_RUNNING");
    expect(f.runtime!.scheduler.status("global")[0]?.run).not.toBeNull();
    f.advance(2_000); f.runtime!.scheduler.settleClaimed("global", true);
    expect(f.service.list({ includeTerminal: false, limit: 20 })).toEqual([]);
    expect(f.service.status(admitted.operationId)).toMatchObject({ state: "completed", result: { lastSuccessAt: "2026-09-19T00:00:02.000Z" } });
    expect(f.changes.map((operation) => operation.state)).toEqual(["admitted", "running", "completed"]);
  });

  it("refuses when no Hindsight runtime is live, when the scheduler is stopped, or for an unknown Bank", () => {
    expect(refusal(() => fixture({ runtime: null }).service.submit(sync())).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    const f = fixture();
    expect(refusal(() => f.service.submit(sync("elsewhere"))).reason).toBe("MEMORY_OPERATION_BANK_UNKNOWN");
    f.runtime!.scheduler.setStarted(false);
    expect(refusal(() => f.service.submit(sync())).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    f.runtime!.scheduler.setStarted(true); f.runtime!.breakConnection("MEMORY_AUTHORITY_MISMATCH");
    expect(refusal(() => f.service.submit(sync())).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(refusal(() => f.service.status("44444444-4444-4444-8444-444444444444")).reason).toBe("MEMORY_OPERATION_NOT_FOUND");
  });
});

describe("memory operation service — setup kinds", () => {
  it("wraps validate: the row runs while the service works and settles with the resulting snapshot revision", async () => {
    const f = fixture();
    let finish = (): void => undefined;
    f.setup.validate = vi.fn(async () => { await new Promise<void>((resolve) => { finish = resolve; }); f.setup.current = setupSnapshot({ revision: 4, attemptId: "attempt-4" }); return f.setup.current; });
    const admitted = f.service.submit({ kind: "setup.validate", expectedRevision: 3 });
    await flush();
    expect(f.service.status(admitted.operationId)).toMatchObject({ state: "running", producer: { kind: "setup", revisionBefore: 3, revisionAfter: null } });
    expect(refusal(() => f.service.cancel(admitted.operationId)).reason).toBe("MEMORY_OPERATION_RUNNING");
    expect(refusal(() => f.service.submit({ kind: "setup.apply", expectedRevision: 3, characterId: "taki" })).reason).toBe("MEMORY_OPERATION_BUSY");
    finish(); await f.service.stop();
    expect(f.service.status(admitted.operationId)).toMatchObject({ state: "completed", producer: { attemptId: "attempt-4", revisionAfter: 4 },
      result: { kind: "setup", phase: "compatible", revision: 4, latestError: null } });
    expect(f.setup.validate).toHaveBeenCalledWith({ expectedRevision: 3 });
  });

  it("classifies a persisted failed phase as producer_failed and a thrown refusal as producer_refused", async () => {
    const f = fixture();
    const latestError = hindsightError("HINDSIGHT_UNREACHABLE").projection();
    f.setup.setup = vi.fn(async () => { f.setup.current = setupSnapshot({ revision: 5, phase: "failed", latestError }); return f.setup.current; });
    const failed = f.service.submit({ kind: "setup.apply", expectedRevision: 3, characterId: "taki" }); await f.service.stop();
    expect(f.service.status(failed.operationId)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_UNREACHABLE",
      result: { kind: "setup", phase: "failed", revision: 5, latestError } });
    expect(f.setup.setup).toHaveBeenCalledWith({ expectedRevision: 3, characterId: "taki" });
    f.setup.validate = vi.fn(async () => { throw hindsightError("HINDSIGHT_STATE_CONFLICT"); });
    const refused = f.service.submit({ kind: "setup.validate", expectedRevision: 9 }); await f.service.stop();
    expect(f.service.status(refused.operationId)).toMatchObject({ state: "failed", reason: "producer_refused", errorCode: "HINDSIGHT_STATE_CONFLICT",
      result: { kind: "setup", phase: "failed", revision: 5 }, producer: { attemptId: null, revisionAfter: 5 } });
  });
});

describe("memory operation service — restart", () => {
  it("reconciles rows left open by another boot into outcome_unknown/core_restart and publishes them", async () => {
    const first = fixture(); const release = first.runtime!.scheduler.hold();
    const open = first.service.submit(sync());
    release();
    const second = fixture({ db: first.db, bootId: "boot-b" });
    expect(second.changes).toHaveLength(1);
    expect(second.service.status(open.operationId)).toMatchObject({ state: "outcome_unknown", reason: "core_restart", result: null });
    expect(second.service.submit(sync()).state).toBe("admitted");
    expect(fixture({ db: first.db, bootId: "boot-b" }).changes).toEqual([]);
  });
});
