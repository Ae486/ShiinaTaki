import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryReplicaScheduleConfigSchema, type MutationRequest } from "@taki/shared";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { applicationTestCompatibility } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { captureHindsightMemoryWrite } from "./hindsight-memory-write-context.ts";
import { memoryWriteFixture, writeTestRetain, WRITE_TEST_MEMORY, type MemoryWriteFixture } from "./hindsight-memory-write-fixtures.ts";
import { createHindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";
import { createHindsightRuntimeBankService } from "./hindsight-runtime-bank-service.ts";
import { createHindsightPendingRecoveryRunner } from "./hindsight-pending-recovery-runner.ts";
import { ensureHindsightPendingSource } from "./hindsight-application-source-write.ts";
import type { HindsightReplicaRunInput } from "./hindsight-replica-sync-runner.ts";

const fixtures: MemoryWriteFixture[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const fixture of fixtures.splice(0)) await fixture.close();
  vi.useRealTimers();
});
function fixture() {
  const result = memoryWriteFixture(); result.deps.requestTimeoutMs = 10_000;
  fixtures.push(result); return result;
}
function elapsedClock() {
  const start = Date.now(); let elapsed = 0;
  vi.spyOn(Date, "now").mockImplementation(() => start + elapsed);
  return (value: number) => { elapsed = value; };
}
function parent(f: MemoryWriteFixture) {
  return f.journal.get({ authorityEpochId: "epoch", bankId: f.route.bankId, requestId: "write-a" })!;
}
function child(f: MemoryWriteFixture) {
  return f.pending.get({ authorityEpochId: "epoch", bankId: f.route.bankId, operationId: parent(f).nativeOperationId! })!;
}
function mutation(f: MemoryWriteFixture): MutationRequest {
  return { kind: "edit", bankId: f.route.bankId, memoryId: WRITE_TEST_MEMORY, expectedRevision: 1, patch: { layerId: "profile" } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

function scheduledRecovery(f: MemoryWriteFixture, automatic: boolean) {
  vi.useFakeTimers(); vi.setSystemTime(f.base.clock.at);
  const now = () => { f.base.clock.at = new Date().toISOString(); return f.base.clock.at; };
  const sync = async (input: HindsightReplicaRunInput) => {
    now();
    for (const event of f.bank.events) {
      const previous = f.base.replica.checkpoint(f.route.bankId)!;
      if (event.manifest.state_cursor <= previous.checkpoint.state_cursor) continue;
      f.base.replica.applyEvent({ ...f.bank.scope, authorityEpochId: "epoch", expectedBank: f.route,
        expectedCheckpoint: previous, expectedNativeCheckpoint: f.base.replica.nativeCheckpoint(f.route.bankId) ?? null,
        lease: input.run.lease, deadlineAt: input.deadlineAt!, event });
    }
    const checkpoint = f.nativeReplica.checkpoint(f.route.bankId)!;
    return { checkpoint, observedCursor: checkpoint.endCursor };
  };
  f.client.compatibility = async () => applicationTestCompatibility(f.bank.scope);
  const recovery = createHindsightPendingRecoveryRunner({ client: f.client, pending: f.pending, replica: f.nativeReplica,
    authority: f.base.authority, projection: { bankScope: () => f.bank.bankScope,
      source: () => { throw new Error("unused native projection"); }, memory: () => { throw new Error("unused native projection"); } },
    connection: { enabled: true, deploymentMode: "existing-instance", endpoint: "http://127.0.0.1:13891",
      apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 10_000, setupTimeoutMs: 5000,
      desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null,
        reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null,
        rerankerProvider: null, rerankerModel: null } }, secretMarker: "fixture", now, syncRunner: { run: sync, rebuild: sync },
    beforeNativeDispatch: (work) => ensureHindsightPendingSource({ writer: f.base.writer, ...work }) });
  const service = createHindsightRuntimeBankService({ replica: f.base.replica, recovery, sync: { run: sync, rebuild: sync },
    bank: f.deps.bank, assertConnection: () => f.assertActive(f.identity()), onRecovered: f.writes.advanceBank, now });
  f.deps.recover = service.recover;
  const repo = createHindsightReplicaSchedulerRepo(f.base.db, now);
  repo.ensureBank({ bank: f.route, config: MemoryReplicaScheduleConfigSchema.parse({ automatic }) });
  const run = vi.fn(service.runner.run);
  const scheduler = createHindsightReplicaScheduler({ repo, replica: f.nativeReplica, banks: [f.route],
    runner: { run, rebuild: service.runner.rebuild }, ownerId: "pending-settlement-test" });
  f.writes.setRetryScheduler(scheduler);
  cleanups.push(async () => { await scheduler.stop(); await service.stop(); });
  return { scheduler, run };
}

describe("durable write receipt after bounded recovery", () => {
  it.each([true, false])("settles the original accepted parent through scheduled recovery only when automatic=%s", async (automatic) => {
    const f = fixture(); const { scheduler, run } = scheduledRecovery(f, automatic);
    scheduler.start(); await scheduler.tick(); run.mockClear();
    const arm = vi.spyOn(scheduler, "requestRetry");
    const dispatch = f.client.trackedNativeWrite!; const read = f.client.nativeResult!;
    let ready = false;
    f.client.trackedNativeWrite = async (input) => {
      const response = await dispatch(input);
      if ("error" in response) throw new Error("fixture Native dispatch failed");
      return { ...response, status: "processing", result: null };
    };
    f.client.nativeResult = async (input) => {
      const response = await read(input);
      return ready ? response : { ...response, status: "processing", result: null };
    };
    const result = await f.writes.retain(f.call(), writeTestRetain(f.route.bankId));
    const original = parent(f); const native = child(f);
    expect(result.status).toBe("pending"); expect(native.phase).toBe("submitted");
    expect(native.nextRetryAt).not.toBeNull(); expect(original.terminal).toBeNull();
    expect(arm).toHaveBeenCalledExactlyOnceWith(f.route.bankId, native.nextRetryAt);
    expect(scheduler.status()[0]?.retryDueAt).toBe(automatic ? native.nextRetryAt : null);
    const delay = Date.parse(native.nextRetryAt!) - Date.now();
    ready = true;
    await vi.advanceTimersByTimeAsync(delay - 1); expect(run).not.toHaveBeenCalled();
    expect(parent(f).terminal).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    if (!automatic) {
      expect(run).not.toHaveBeenCalled(); expect(parent(f).terminal).toBeNull();
      scheduler.requestManual(f.route.bankId); await scheduler.tick();
    }
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].run.trigger).toBe(automatic ? "retry" : "manual");
    expect(parent(f)).toMatchObject({ identity: original.identity, preparedAt: original.preparedAt, terminal: { kind: "retain" } });
    expect(child(f)).toMatchObject({ phase: "completed", remoteOperationId: native.remoteOperationId, intent: native.intent });
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
    expect(scheduler.status()[0]).toMatchObject({ mode: "idle", retryDueAt: null, consecutiveFailures: 0 });
    arm.mockClear();
    expect((await f.writes.retain(f.call(), writeTestRetain(f.route.bankId))).status).toBe("completed");
    expect(arm).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["HINDSIGHT_TIMEOUT", "HINDSIGHT_PENDING_REMAINS", null])("returns durable pending after expiry with recovery outcome %s", async (error) => {
    const f = fixture(); const elapsed = elapsedClock(); const request = writeTestRetain(f.route.bankId);
    f.control.beforeRecovery = async () => { elapsed(10_001); if (error) throw new Error(error); };
    const result = await f.writes.retain(f.call(), request);
    expect(result).toMatchObject({ status: "pending", sourceRevision: null, memories: [] });
    if (result.status !== "pending") throw new Error("expected durable pending retain");
    const original = parent(f); const native = child(f); const source = f.base.writer.get({
      authorityEpochId: "epoch", bankId: f.route.bankId, requestId: `source:${native.remoteOperationId}`,
    })!;
    expect(original.terminal).toBeNull(); expect(native.phase).toBe("queued"); expect(f.native.calls).toEqual([]);
    expect(source.state).toBe("prepared");
    f.control.beforeRecovery = undefined; f.control.replayNative = true;
    const completed = await f.writes.retain(f.call(), request);
    expect(completed.status).toBe("completed"); expect(result.operationId).toBe(native.intent.operationId);
    expect(parent(f).identity).toEqual(original.identity); expect(parent(f).preparedAt).toBe(original.preparedAt);
    expect(child(f).remoteOperationId).toBe(native.remoteOperationId);
    expect(f.base.writer.get(source.key)?.request).toEqual(source.request);
    expect(f.base.writer.get(source.key)?.commands.bytes).toEqual(source.commands.bytes);
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
    expect(await f.writes.retain(f.call(), request)).toEqual(completed);
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
  });

  it("returns a pure-layer pending overlay after expiry and recovers the original application command", async () => {
    const f = fixture(); const elapsed = elapsedClock(); const request = mutation(f);
    f.control.beforeRecovery = async () => { elapsed(10_001); throw new Error("HINDSIGHT_TIMEOUT"); };
    const result = await f.writes.mutate(f.call(), request); const original = parent(f);
    expect(result).toMatchObject({ outcome: "pending", record: null, pending: {
      confirmed: false, operationId: "write-a", phase: "queued", operation: { kind: "mutation", request },
    } });
    expect(original.nativeOperationId).toBeNull(); expect(f.native.calls).toEqual([]);
    if (result.outcome !== "pending") throw new Error("expected durable pending mutation");
    expect(f.writes.mutationOverlays(f.route.bankId)).toEqual([result.pending]);
    f.control.beforeRecovery = undefined;
    const completed = await f.writes.mutate(f.call(), request);
    expect(completed).toMatchObject({ outcome: "applied", record: { policy: { layerId: "profile", policyVersion: 2 } } });
    expect(parent(f).identity).toEqual(original.identity); expect(f.native.calls).toEqual([]);
    expect(f.bank.server.calls.filter((call) => call.startsWith("commit:"))).toHaveLength(1);
    expect(f.writes.mutationOverlays(f.route.bankId)).toEqual([]);
  });

  it("reads an already completed pure-layer receipt when recovery returns after expiry", async () => {
    const f = fixture(); const elapsed = elapsedClock(); const recover = f.deps.recover;
    const requestRetry = vi.fn(); f.writes.setRetryScheduler({ requestRetry });
    f.deps.recover = async (input) => { await recover(input); elapsed(10_001); };
    expect(await f.writes.mutate(f.call(), mutation(f))).toMatchObject({ outcome: "applied", record: { policy: { layerId: "profile" } } });
    expect(parent(f).terminal?.kind).toBe("mutation"); expect(f.native.calls).toEqual([]);
    expect(requestRetry).not.toHaveBeenCalled();
  });

  it("propagates a saved terminal refusal after recovery expiry", async () => {
    const f = fixture(); const elapsed = elapsedClock();
    const requestRetry = vi.fn(); f.writes.setRetryScheduler({ requestRetry });
    f.control.beforeRecovery = async () => {
      const job = parent(f);
      f.journal.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "error", code: "MEMORY_INVALID_REQUEST" } });
      elapsed(10_001); throw new Error("HINDSIGHT_TIMEOUT");
    };
    await expect(f.writes.mutate(f.call(), mutation(f))).rejects.toThrow("MEMORY_INVALID_REQUEST");
    expect(parent(f).terminal).toEqual({ kind: "error", code: "MEMORY_INVALID_REQUEST" }); expect(f.native.calls).toEqual([]);
    expect(requestRetry).not.toHaveBeenCalled();
  });

  it.each(["unclassified recovery defect", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_INTEGRITY_ERROR"])("does not hide %s after expiry", async (code) => {
    const f = fixture(); const elapsed = elapsedClock();
    f.control.beforeRecovery = async () => { elapsed(10_001); throw new Error(code); };
    await expect(f.writes.retain(f.call(), writeTestRetain(f.route.bankId))).rejects.toThrow(code);
    expect(parent(f).terminal).toBeNull(); expect(child(f).phase).toBe("queued"); expect(f.native.calls).toEqual([]);
  });

  it.each(["MEMORY_AUTHORITY_MISMATCH", "MEMORY_INTEGRITY_ERROR"])("rechecks the current guard before receipt readback: %s", async (code) => {
    const f = fixture(); const elapsed = elapsedClock();
    f.control.beforeRecovery = async () => {
      elapsed(10_001); f.control.extraGuard = () => { throw new Error(code); };
      throw new Error("HINDSIGHT_TIMEOUT");
    };
    await expect(f.writes.retain(f.call(), writeTestRetain(f.route.bankId))).rejects.toThrow(code);
    f.control.extraGuard = undefined;
    expect(parent(f).terminal).toBeNull(); expect(child(f).phase).toBe("queued"); expect(f.native.calls).toEqual([]);
  });

  it("preserves caller cancellation ahead of expired recovery and avoids receipt reads", async () => {
    const f = fixture(); const elapsed = elapsedClock(); const controller = new AbortController();
    let get: ReturnType<typeof vi.spyOn> | undefined;
    f.control.beforeRecovery = async () => {
      elapsed(10_001); get = vi.spyOn(f.journal, "get"); controller.abort(); throw new Error("HINDSIGHT_TIMEOUT");
    };
    await expect(f.writes.retain({ ...f.call(), signal: controller.signal }, writeTestRetain(f.route.bankId))).rejects.toThrow("HINDSIGHT_CANCELLED");
    expect(get).not.toHaveBeenCalled(); expect(f.native.calls).toEqual([]);
    expect(parent(f).terminal).toBeNull(); expect(child(f).phase).toBe("queued");
  });

  it("drains stopped recovery without returning pending or accessing its journal after cancellation", async () => {
    const f = fixture(); const elapsed = elapsedClock(); const entered = deferred(); const blocked = deferred();
    f.control.beforeRecovery = async () => { entered.resolve(); await blocked.promise; throw new Error("HINDSIGHT_TIMEOUT"); };
    const operation = f.writes.mutate(f.call(), mutation(f));
    const rejected = expect(operation).rejects.toThrow("HINDSIGHT_CANCELLED"); await entered.promise;
    const get = vi.spyOn(f.journal, "get"); elapsed(10_001);
    let stopped = false; const stop = f.writes.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); blocked.resolve(); await rejected; await stop;
    expect(get).not.toHaveBeenCalled(); expect(f.native.calls).toEqual([]); expect(parent(f).terminal).toBeNull();
  });

  it("keeps the original shrinking request deadline and refuses expiry before durable admission", async () => {
    const f = fixture(); const elapsed = elapsedClock(); const request = writeTestRetain(f.route.bankId);
    const context = captureHindsightMemoryWrite(f.deps, { call: f.call(), operation: { kind: "retain", request, zeroResultAllowed: true } });
    elapsed(4_000); expect(context.request().timeoutMs).toBe(6_000);
    elapsed(10_001); expect(() => context.request()).toThrow("HINDSIGHT_TIMEOUT");
    elapsed(20_000); f.control.extraGuard = () => { elapsed(30_001); };
    await expect(f.writes.retain(f.call(), request)).rejects.toThrow("HINDSIGHT_TIMEOUT");
    f.control.extraGuard = undefined;
    expect(parent(f)).toBeUndefined(); expect(f.native.calls).toEqual([]);
    expect(f.base.db.prepare("SELECT COUNT(*) AS n FROM pending_memory").get()?.n).toBe(0);
    expect(f.base.db.prepare("SELECT COUNT(*) AS n FROM hindsight_application_command_jobs").get()?.n).toBe(0);
  });
});
