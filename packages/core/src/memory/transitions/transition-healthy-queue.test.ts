import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createCanonicalMemoryTools } from "../canonical-tools/canonical-memory-tools.ts";
import { attachEffectExecutionContext } from "../../governance/governed-tool.ts";
import { DEFAULT_TRANSITION_QUEUE_POLICY } from "../../db/memory-transition-repo.ts";
import { readTransitionQueue, readQueueOutcome, readQueueExecution } from "../../db/memory-transition-queue-repo.ts";
import * as hindsightModule from "../hindsight/hindsight-memory-subsystem.ts";
import * as localModule from "../canonical-local-subsystem.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { join } from "node:path";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function queueHarness() {
  const construct = hindsightModule.createHindsightMemorySubsystem;
  let source!: ReturnType<typeof construct>;
  vi.spyOn(hindsightModule, "createHindsightMemorySubsystem").mockImplementation((input) => {
    const result = construct(input); source ??= result; return result;
  });
  const h = await createHealthyTransitionHarness();
  const tools = await createCanonicalMemoryTools({ coordinator: source.state.coordinator, authority: source.state.runtime.epoch,
    router: { globalBankId: () => h.banks.find((bank) => bank.scope === "global")!.nativeBankId,
      characterBankId: () => h.banks.find((bank) => bank.scope === "character")!.nativeBankId, characterId: () => "taki" } });
  const retain = (label: string) => tools.retain!.execute!({ content: label, layer: "episodes", context: null },
    attachEffectExecutionContext({ toolCallId: label, messages: [] }, { runId: "queue-run", attemptId: "queue-attempt",
      effectId: `effect-${label}`, sourceRef: { type: "tool", toolName: "retain" } }) as never);
  return { ...h, source, tools, retain };
}

describe("complete healthy driver with actual queue and custody entrypoints", () => {
  it("retains committed authority and queued intent when Local index initialization fails, then recovers without republishing", async () => {
    const construct = localModule.createCanonicalLocalSubsystem;
    vi.spyOn(localModule, "createCanonicalLocalSubsystem").mockImplementation((input) => {
      const value = construct(input);
      vi.spyOn(value.engine, "reconfigureSearch").mockRejectedValueOnce(new Error("MEMORY_SEARCH_INDEX_UNAVAILABLE"));
      return value;
    });
    const h = await queueHarness();
    try {
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => { await h.retain("failed-local-index"); await quiesce(work); });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "outcome_unknown", result: { authorityCommitted: true } });
      const marker = h.db.prepare("SELECT * FROM memory_authority_selection").get();
      const receipts = h.db.prepare("SELECT * FROM memory_transition_receipts").all();
      expect(receipts).toHaveLength(1);
      expect(h.runtime.memory.searchStatus?.().ready).toBe(false);
      const queue = readTransitionQueue(h.db, transitionId);
      expect(queue).toHaveLength(1); expect(readQueueExecution(h.db, queue[0]!.intentId)).toBeUndefined();
      h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.runtime.memory.searchStatus?.().ready).toBe(true);
      expect(h.db.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
      expect(h.db.prepare("SELECT * FROM memory_transition_receipts").all()).toEqual(receipts);
      expect(readQueueOutcome(h.db, queue[0]!.intentId)?.status).toBe("completed");
    } finally { await h.close(); }
  });

  it("rejects late Local index initialization after runtime shutdown", async () => {
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const construct = localModule.createCanonicalLocalSubsystem;
    vi.spyOn(localModule, "createCanonicalLocalSubsystem").mockImplementation((input) => {
      const value = construct(input); const reconfigure = value.engine.reconfigureSearch!;
      vi.spyOn(value.engine, "reconfigureSearch").mockImplementationOnce(async (policy, signal) => {
        entered(); await gate; return reconfigure(policy, signal);
      });
      return value;
    });
    const h = await queueHarness();
    try {
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => { await h.retain("stopped-local-index"); await quiesce(work); });
      const admitted = h.owner.submit(await h.request()); await started;
      const marker = h.db.prepare("SELECT * FROM memory_authority_selection").get();
      const stopping = h.runtime.stop(); release(); await stopping; await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.db.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(1);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_queue_executions").get()?.n).toBe(0);
    } finally { release(); await h.close(); }
  });

  it("applies the Local search projection before a queued retain uses the newly published target", async () => {
    const h = await queueHarness();
    let readyAtBind: boolean | undefined;
    try {
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
        await h.retain("new-local-index"); await quiesce(work);
      });
      const bind = h.runtime.transitions.bind;
      vi.spyOn(h.runtime.transitions, "bind").mockImplementation(async (transitionId) => {
        const result = await bind(transitionId);
        readyAtBind = h.runtime.memory.searchStatus?.().ready;
        return result;
      });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(readyAtBind).toBe(true);
      expect(h.owner.status(admitted.operationId).state).toBe("completed");
    } finally { await h.close(); }
  });
  it("commits queue custody before ACK, executes Local effects in order and exposes a revision conflict", async () => {
    const h = await queueHarness();
    try {
      const sourceRetain = vi.spyOn(h.source.state.provider, "retain"); const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
        expect(await h.retain("queued-real-source")).toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUED" } });
        const saved = readTransitionQueue(h.db, work.lease.transitionId);
        expect(saved[0]?.provenance).toMatchObject({ runId: "queue-run", attemptId: "queue-attempt", effectId: "effect-queued-real-source" });
        for (const index of [1, 2]) {
          expect(await h.tools.update_memory!.execute!({ scope: "global", memoryId: "unit-bank", expectedRevision: 1,
            changes: [{ field: "text", value: `queued ordered ${index}` }] }, { toolCallId: `update-${index}`, messages: [] } as never))
            .toMatchObject({ ok: false, error: { code: "MEMORY_TRANSITION_QUEUED" } });
        }
        await quiesce(work);
      });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "completed", result: { queue: "settled" } });
      const queue = readTransitionQueue(h.db, transitionId);
      expect(queue.map((row) => readQueueOutcome(h.db, row.intentId)?.status)).toEqual(["completed", "completed", "conflict"]);
      expect(readQueueExecution(h.db, queue[0]!.intentId)?.targetRequestId).not.toBe(queue[0]!.callerRequestId);
      expect(sourceRetain).not.toHaveBeenCalled();
      expect(h.service.status(transitionId).progress.queue).toEqual({ admitted: 3, settled: 3, unknown: 0 });
    } finally { await h.close(); }
  });

  it("enforces admission capacity and cutoff while preserving the admitted write", async () => {
    const h = await queueHarness();
    try {
      const plan = h.service.plan;
      vi.spyOn(h.service, "plan").mockImplementation((request) => ({ ...plan(request), queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY, maxIntents: 1 } }));
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
        expect(await h.retain("first")).toMatchObject({ error: { code: "MEMORY_TRANSITION_QUEUED" } });
        expect(await h.retain("full")).toMatchObject({ error: { code: "MEMORY_TRANSITION_QUEUE_FULL", retryable: true } });
        await quiesce(work);
      });
      const fence = h.remote.client.fenceTransition!;
      vi.spyOn(h.remote.client, "fenceTransition").mockImplementationOnce(async (work) => {
        expect(await h.retain("late")).toMatchObject({ error: { code: "MEMORY_TRANSITION_CUTOFF", retryable: false } });
        return fence(work);
      });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("completed");
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_queue").get()?.n).toBe(1);
    } finally { await h.close(); }
  });

  it("recovers target effect-before-ACK from the original receipt without another write", async () => {
    const h = await queueHarness();
    try {
      const priorReceipts = h.db.prepare("SELECT count(*) n FROM canonical_memory_operation_receipts").get()!.n;
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => { await h.retain("lost-ack"); await quiesce(work); });
      h.db.exec("CREATE TRIGGER fail_queue_ack BEFORE INSERT ON memory_transition_queue_results BEGIN SELECT RAISE(ABORT,'owned lost ACK'); END");
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "outcome_unknown", result: { authorityCommitted: true } });
      const receipts = h.db.prepare("SELECT * FROM canonical_memory_operation_receipts").all();
      expect(receipts).toHaveLength(Number(priorReceipts) + 1); h.db.exec("DROP TRIGGER fail_queue_ack");
      h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.db.prepare("SELECT * FROM canonical_memory_operation_receipts").all()).toEqual(receipts);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(1);
    } finally { await h.close(); }
  });

  it("positively aborts acquired Banks and cancels queued callers without executing them", async () => {
    const h = await queueHarness();
    try {
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => { await h.retain("source-abort"); await quiesce(work); });
      vi.spyOn(h.remote.client, "fenceTransition").mockRejectedValueOnce(new Error("owned fence refusal"));
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "failed", result: { runtime: "source" } });
      const queue = readTransitionQueue(h.db, transitionId); expect(queue).toHaveLength(1);
      expect(readQueueOutcome(h.db, queue[0]!.intentId)?.status).toBe("cancelled");
      expect(readQueueExecution(h.db, queue[0]!.intentId)).toBeUndefined();
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_outcomes").get()?.n).toBe(1);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_undispatched").get()?.n).toBe(1);
    } finally { await h.close(); }
  });

  it("preserves primary appends during drain and finalization while the committed target is unbound", async () => {
    const h = await queueHarness();
    try {
      const session = h.runtime.custody.begin({ characterId: "taki", repo: h.timeline });
      const first = session.repo.append({ characterId: "taki", role: "user", content: "before fence" });
      const quiesce = h.runtime.transitions.quiesce;
      let secondSeq = 0;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
        secondSeq = session.repo.append({ characterId: "taki", role: "assistant", content: "during drain" }).seq;
        await quiesce(work);
      });
      vi.spyOn(h.runtime.transitions, "bind").mockImplementationOnce(async () => { session.finalize(); throw new Error("owned unbound target"); });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "outcome_unknown", result: { authorityCommitted: true } });
      const receipt = h.service.status(transitionId).transition.receipt!;
      const reopened = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      try {
        expect(readVerifiedTransitionPublication(reopened, receipt.receiptId).sourceCustody.groups[0]?.members.map((row) => row.seq)).toEqual([first.seq, secondSeq]);
        expect(reopened.prepare("SELECT timeline_seq FROM canonical_memory_primary_commits ORDER BY timeline_seq").all())
          .toEqual([{ timeline_seq: first.seq }, { timeline_seq: secondSeq }]);
      } finally { reopened.close(); }
      h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.service.status(transitionId).transition.receipt).toEqual(receipt);
    } finally { await h.close(); }
  });
});
