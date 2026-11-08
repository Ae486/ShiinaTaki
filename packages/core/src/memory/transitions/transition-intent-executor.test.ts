import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryProvider } from "../memory-provider.ts";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { readTransitionQueue, readQueueExecution, readQueueOutcome } from "../../db/memory-transition-queue-repo.ts";
import { readTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { createMemoryCoordinator } from "../memory-coordinator.ts";
import { createCanonicalMemoryTools } from "../canonical-tools/canonical-memory-tools.ts";
import { attachEffectExecutionContext } from "../../governance/governed-tool.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "../local-memory-provider.ts";
import { createCanonicalLocalRuntime } from "../canonical-local-runtime.ts";
import { transitionQueuedProvider } from "./transition-queued-provider.ts";
import { createTransitionIntentExecutor } from "./transition-intent-executor.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { join } from "node:path";
import type { ToolSet } from "ai";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function queuedFixture(invalidPolicy = false, loseAuthority = false) {
  const dispatch = vi.fn(async (): Promise<never> => { throw new Error("queued source must not dispatch"); });
  const f = await createTransitionPublicationFixture({ beforeFence: async ({ db, intent }) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
    const provider: MemoryProvider = { providerId: "hindsight", providerLineageId: intent.request.expected.sourceLineageId,
      capabilities: async () => ({ ...LOCAL_MEMORY_CAPABILITIES, providerId: "hindsight" }),
      retain: dispatch, mutate: dispatch, recall: dispatch, reflect: dispatch };
    const coordinator = createMemoryCoordinator({ authority: createCanonicalMemoryAuthorityRepo(db),
      providers: new Map([["hindsight", transitionQueuedProvider(db, provider, () => undefined)]]) });
    const banks = intent.request.expected.banks;
    const tools = await createCanonicalMemoryTools({ coordinator, authority: createCanonicalMemoryAuthorityRepo(db).authorityEpoch(),
      router: { globalBankId: () => banks.find((bank) => bank.scope.kind === "global")!.sourceBankId,
        characterBankId: () => banks.find((bank) => bank.scope.kind === "character")!.sourceBankId, characterId: () => "taki" } });
    const options = attachEffectExecutionContext({ toolCallId: "retain", messages: [] }, {
      runId: "original-run", attemptId: "original-attempt", effectId: "original-effect", sourceRef: { type: "tool", toolName: "retain" } }) as never;
    const queued = await tools.retain!.execute!({ content: "A newly queued memory", layer: "episodes", context: null }, options);
    expect(queued).toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUED", queue: { status: "queued", sequence: 1 } } });
    expect(readTransitionQueue(db, intent.transitionId)[0]?.provenance).toEqual({ callerId: "original-run",
      runId: "original-run", attemptId: "original-attempt", effectId: "original-effect" });
    if (loseAuthority) {
      const saved = readTransitionQueue(db, intent.transitionId)[0]!;
      if (saved.command.kind !== "retain") throw new Error("missing retained command");
      let release!: (value: Awaited<ReturnType<MemoryProvider["capabilities"]>>) => void;
      const deferred = new Promise<Awaited<ReturnType<MemoryProvider["capabilities"]>>>((resolve) => { release = resolve; });
      let current = true;
      const queued = transitionQueuedProvider(db, { ...provider, capabilities: () => deferred }, () => {
        if (!current) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      });
      const pending = queued.retain({ requestId: "drift-during-capabilities", authorityEpochId: saved.sourceEpochId,
        actor: "foreground-agent" }, saved.command.request);
      current = false; release(await provider.capabilities());
      expect(await pending).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(readTransitionQueue(db, intent.transitionId)).toHaveLength(1);
      expect(dispatch).not.toHaveBeenCalled();
    }
    if (invalidPolicy) {
      const saved = readTransitionQueue(db, intent.transitionId)[0]!;
      if (saved.command.kind !== "retain") throw new Error("expected retain fixture");
      await transitionQueuedProvider(db, provider, () => undefined).retain({ requestId: "invalid-policy", authorityEpochId: saved.sourceEpochId, actor: "foreground-agent" },
        { ...saved.command.request, policy: { ...saved.command.request.policy, layerId: "unknown-layer" } });
    }
    for (let index = 0; index < 2; index += 1) {
      const result = await tools.update_memory!.execute!({ scope: "global", memoryId: "unit-bank", expectedRevision: 1,
        changes: [{ field: "text", value: `Ordered edit ${index}` }] }, { toolCallId: `edit-${index}`, messages: [] } as never);
      expect(result).toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUED" } });
    }
    expect(readTransitionQueue(db, intent.transitionId)).toHaveLength(invalidPolicy ? 4 : 3); expect(dispatch).not.toHaveBeenCalled();
    vi.useRealTimers();
  } });
  const receipt = publishMemoryTransition(f.db, f.prove());
  const provider = createCanonicalLocalRuntime({ db: f.db, epochId: receipt.newEpochId }).provider;
  const lease = readTransitionAttempt(f.db, f.intent.transitionId)!;
  return { ...f, receipt, provider, lease, dispatch };
}

describe("transition intents through canonical tools and actual Local target receipts", () => {
  it("refuses authority drift after capabilities resolve and before a new queue side effect", async () => {
    const f = await queuedFixture(false, true);
    await f.close();
  });

  it("records a factual Local validation refusal and continues in order without inventing a completed effect", async () => {
    const f = await queuedFixture(true);
    try {
      const executor = createTransitionIntentExecutor({ db: f.db, provider: () => f.provider, now: () => W3_AT });
      await executor.run(f.lease); await executor.stop();
      const queued = readTransitionQueue(f.db, f.intent.transitionId);
      expect(readQueueOutcome(f.db, queued[0]!.intentId)?.status).toBe("completed");
      expect(readQueueOutcome(f.db, queued[1]!.intentId)).toMatchObject({ status: "failed", errorCode: "MEMORY_INVALID_REQUEST" });
      expect(readQueueOutcome(f.db, queued[2]!.intentId)?.status).toBe("completed");
      expect(readQueueOutcome(f.db, queued[3]!.intentId)?.status).toBe("conflict");
      const execution = readQueueExecution(f.db, queued[1]!.intentId)!;
      expect(f.db.prepare("SELECT * FROM canonical_memory_operation_receipts WHERE request_id=:id").get({ id: execution.targetRequestId })).toBeUndefined();
      for (const table of ["memory_transition_target_refusals", "memory_transition_effect_receipts"]) {
        expect(() => f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow("immutable");
      }
      const reopened = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      try { expect(readQueueOutcome(reopened, queued[1]!.intentId)).toEqual(readQueueOutcome(f.db, queued[1]!.intentId)); }
      finally { reopened.close(); }
      const unexpected = vi.fn(async () => { throw new Error("no repeated dispatch"); });
      const resumed = createTransitionIntentExecutor({ db: f.db, provider: () => ({ ...f.provider, retain: unexpected, mutate: unexpected }), now: () => W3_AT });
      await resumed.run(f.lease); await resumed.stop(); expect(unexpected).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it("returns retryable capacity and terminal cutoff errors through the actual tool, without inserting refused work", async () => {
    let tools!: ToolSet; let queuedProvider!: MemoryProvider;
    const f = await createTransitionPublicationFixture({ queuePolicy: { maxIntents: 1 }, beforeFence: async ({ db, intent }) => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
      const unexpected = async (): Promise<never> => { throw new Error("must not dispatch source"); };
      queuedProvider = transitionQueuedProvider(db, { providerId: "hindsight", providerLineageId: intent.request.expected.sourceLineageId,
        capabilities: async () => ({ ...LOCAL_MEMORY_CAPABILITIES, providerId: "hindsight" }),
        retain: unexpected, mutate: unexpected, recall: unexpected, reflect: unexpected }, () => undefined);
      const coordinator = createMemoryCoordinator({ authority: createCanonicalMemoryAuthorityRepo(db), providers: new Map([["hindsight", queuedProvider]]) });
      tools = await createCanonicalMemoryTools({ coordinator, authority: createCanonicalMemoryAuthorityRepo(db).authorityEpoch(),
        router: { globalBankId: () => intent.request.expected.banks[0]!.sourceBankId,
          characterBankId: () => intent.request.expected.banks[1]!.sourceBankId, characterId: () => "taki" } });
      const request = { content: "Queued once", layer: "episodes", context: null };
      expect(await tools.retain!.execute!(request, { toolCallId: "first", messages: [] } as never)).toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUED" } });
      expect(await tools.retain!.execute!(request, { toolCallId: "capacity", messages: [] } as never))
        .toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUE_FULL", category: "availability", retryable: true, nextAction: "retry" } });
      expect(readTransitionQueue(db, intent.transitionId)).toHaveLength(1);
    } });
    try {
      expect(await tools.retain!.execute!({ content: "too late", layer: "episodes", context: null }, { toolCallId: "cutoff", messages: [] } as never))
        .toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_CUTOFF", retryable: false } });
      const saved = readTransitionQueue(f.db, f.intent.transitionId)[0]!;
      if (saved.command.kind !== "retain") throw new Error("missing retain fixture");
      const context = { requestId: "unsupported", authorityEpochId: saved.sourceEpochId, actor: "foreground-agent" as const };
      for (const change of [{ strategy: "custom" }, { updateMode: "append" as const }, { documentId: "named" }]) {
        expect(await queuedProvider.retain(context, { ...saved.command.request, ...change })).toMatchObject({ ok: false });
      }
      const controller = new AbortController(); controller.abort();
      expect(await queuedProvider.retain({ ...context, signal: controller.signal }, saved.command.request))
        .toMatchObject({ ok: false, error: { code: "MEMORY_OPERATION_CANCELLED" } });
      expect(readTransitionQueue(f.db, f.intent.transitionId)).toHaveLength(1);
    } finally { vi.useRealTimers(); await f.close(); }
  });
  it("keeps unknown target work under the same identity across another observer and executor restart", async () => {
    const f = await queuedFixture();
    try {
      const dispatch = vi.fn(async () => { throw new Error("target response unknown"); });
      const provider = { ...f.provider, retain: dispatch };
      const executor = createTransitionIntentExecutor({ db: f.db, provider: () => provider, now: () => W3_AT });
      await executor.run(f.lease); await executor.stop();
      const queue = readTransitionQueue(f.db, f.intent.transitionId); const saved = readQueueExecution(f.db, queue[0]!.intentId)!;
      const reopened = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      try { expect(readQueueOutcome(reopened, queue[0]!.intentId)).toMatchObject({ status: "outcome_unknown", targetRequestId: saved.targetRequestId }); }
      finally { reopened.close(); }
      const recoverTarget = vi.fn<(execution: typeof saved, signal: AbortSignal) => Promise<void>>(async () => undefined);
      const resumed = createTransitionIntentExecutor({ db: f.db, provider: () => provider, now: () => W3_AT, recoverTarget });
      await resumed.run(f.lease); await resumed.stop();
      expect(dispatch).toHaveBeenCalledOnce(); expect(recoverTarget.mock.calls[0]?.[0]).toEqual(saved);
      expect(readQueueExecution(f.db, queue[1]!.intentId)).toBeUndefined();
    } finally { await f.close(); }
  });
  it("does not reserve work for an unavailable target, and settles active dispatch on shutdown", async () => {
    const f = await queuedFixture();
    try {
      const unavailable = createTransitionIntentExecutor({ db: f.db, now: () => W3_AT,
        provider: () => { throw new Error("MEMORY_RUNTIME_UNAVAILABLE"); } });
      await expect(unavailable.run(f.lease)).rejects.toThrow("MEMORY_RUNTIME_UNAVAILABLE"); await unavailable.stop();
      expect(f.db.prepare("SELECT * FROM memory_transition_queue_executions").all()).toEqual([]);
      let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
      const retain: MemoryProvider["retain"] = async (context) => {
        entered(); await new Promise<void>((resolve) => context.signal!.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("cancelled with unknown dispatch outcome");
      };
      const executor = createTransitionIntentExecutor({ db: f.db, now: () => W3_AT, provider: () => ({ ...f.provider, retain }) });
      const run = executor.run(f.lease); await started; await executor.stop(); await run;
      const queue = readTransitionQueue(f.db, f.intent.transitionId);
      expect(readQueueOutcome(f.db, queue[0]!.intentId)?.status).toBe("outcome_unknown");
      expect(readQueueExecution(f.db, queue[1]!.intentId)).toBeUndefined();
    } finally { await f.close(); }
  });
  it("commits admission before ACK, preserves provenance, executes in order and conflicts the second old revision", async () => {
    const f = await queuedFixture();
    try {
      const executor = createTransitionIntentExecutor({ db: f.db, provider: () => f.provider, now: () => W3_AT });
      await executor.run(f.lease);
      const queue = readTransitionQueue(f.db, f.intent.transitionId);
      expect(queue.map((row) => readQueueOutcome(f.db, row.intentId)?.status)).toEqual(["completed", "completed", "conflict"]);
      expect(readQueueExecution(f.db, queue[0]!.intentId)?.targetRequestId).not.toBe(queue[0]!.callerRequestId);
      const receipts = f.db.prepare("SELECT * FROM memory_transition_effect_receipts").all(); expect(receipts).toHaveLength(2);
      await executor.run(f.lease); expect(f.db.prepare("SELECT * FROM memory_transition_effect_receipts").all()).toEqual(receipts);
      await executor.stop();
    } finally { await f.close(); }
  });
  it("recovers effect-before-ACK without dispatching the retained effect twice", async () => {
    const f = await queuedFixture();
    try {
      const retain = vi.spyOn(f.provider, "retain");
      f.db.exec("CREATE TRIGGER fail_queue_ack BEFORE INSERT ON memory_transition_queue_results BEGIN SELECT RAISE(ABORT,'lost queue ack'); END");
      const executor = createTransitionIntentExecutor({ db: f.db, provider: () => f.provider, now: () => W3_AT });
      await expect(executor.run(f.lease)).rejects.toThrow("lost queue ack");
      expect(retain).toHaveBeenCalledTimes(1);
      f.db.exec("DROP TRIGGER fail_queue_ack"); await executor.stop();
      const resumed = createTransitionIntentExecutor({ db: f.db, provider: () => f.provider, now: () => W3_AT });
      await resumed.run(f.lease); expect(retain).toHaveBeenCalledTimes(1); await resumed.stop();
    } finally { await f.close(); }
  });
});
