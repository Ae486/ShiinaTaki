import { afterEach, describe, expect, it } from "vitest";
import { PendingMemoryIntentSchema } from "@taki/shared";
import { createHindsightIngestionSourceRepo } from "../../../db/hindsight-ingestion-source-repo.ts";
import { createPendingMemoryRepo } from "../../../db/pending-memory-repo.ts";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { failingGenerateModel } from "../../../testing/mock-language-model.ts";
import { createHindsightRuntimeConnection } from "../hindsight-runtime-connection.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { assertTemplateLocalPlan } from "./template-plan-guard.ts";
import { claimTemplateExecutor, assertTemplateExecutor } from "./template-executor-store.ts";
import { recordTemplateBankReceipt } from "./template-native-evidence-store.ts";
import { readTemplateHold } from "./template-execution-reads.ts";

const cleanup: Array<() => Promise<unknown> | void> = [];
const fixture = () => {
  const model = failingGenerateModel(new Error("test forbids model work during a template hold"));
  const f = templateLifecycleFixture({ model }); cleanup.push(f.close); return { f, model };
};
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe("durable hold through actual Hindsight runtime owners", () => {
  it("closes old tool/live reads and new captures while keeping the old immutable Run and primary witnesses", async () => {
    const { f, model } = fixture(); const subsystem = f.base.subsystem();
    const old = await subsystem.captureRun("taki"); const assembly = old.assemble!("same user text");
    const snapshot = structuredClone(old.snapshot); const calls = f.base.remote.calls.length;
    const operation = f.admit(await f.request()); const plan = f.plan(operation);
    expect(subsystem.state.runtime.driftReason()).toBe("template_hold");
    expect(() => subsystem.engine.assemble({ characterId: "taki", currentMessage: "no mixed state" })).toThrow("MEMORY_TEMPLATE_HOLD");
    const next = await subsystem.captureRun("taki");
    expect(next.snapshot.providerId).toBe("hindsight");
    expect(next.snapshot.authorityEpochId).toBe("epoch");
    expect(next.tools).toEqual({}); expect(next.automaticRecall).toBeUndefined();
    const result = await old.tools.recall!.execute!({ query: "fact", scope: "both", limit: 5, maxTokens: 1024 },
      { toolCallId: "held-recall", messages: [], context: {} });
    expect(result).toMatchObject({ ok: false });
    expect(await old.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() })).toBe("");
    expect(old.assemble!("same user text")).toBe(assembly); expect(old.snapshot).toEqual(snapshot);
    const entries = [f.base.timeline.append({ characterId: "taki", role: "user", content: "Primary source during template hold" })];
    subsystem.recordPrimaryCommitted({ characterId: "taki", entries });
    const witness = createHindsightIngestionSourceRepo(f.db).pendingEntries({ epochId: "epoch", characterId: "taki", throughSeq: entries[0]!.seq });
    expect(witness.map((entry) => entry.entry.id)).toEqual([entries[0]!.id]);
    await expect(subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq: entries[0]!.seq, operationId: "held-flush" }))
      .resolves.toMatchObject({ status: "retryable_failure", code: "MEMORY_FLUSH_INCOMPLETE" });
    await expect(subsystem.maintenance.run("taki", "primary")).rejects.toThrow("MEMORY_TEMPLATE_HOLD");
    expect(model.doGenerateCalls).toHaveLength(0); expect(f.base.remote.calls).toHaveLength(calls);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
  });

  it("retires the complete published scheduler and keeps unbound captures/status explicitly held", async () => {
    const { f, model } = fixture(); const runtime = f.base.compose(); runtime.start();
    const previous = runtime.operations()!; expect(previous.scheduler.started()).toBe(true);
    const operation = f.admit(await f.request()); const plan = f.plan(operation);
    const assertCurrent = () => assertTemplateLocalPlan(f.deps, { plan });
    await runtime.templates.quiesce({ plan, signal: new AbortController().signal, assertCurrent });
    expect(runtime.operations()).toBeNull(); expect(previous.scheduler.started()).toBe(false);
    expect(runtime.hindsightBindingSnapshot().binding).toMatchObject({ kind: "unavailable", code: "MEMORY_TEMPLATE_HOLD" });
    const run = await runtime.captureRun("taki"); expect(run.tools).toEqual({});
    expect(run.snapshot.authorityEpochId).toBe("epoch"); expect(runtime.selected.legacy).toBeNull();
    expect(() => runtime.recoverHindsightBinding("epoch")).toThrow("MEMORY_TEMPLATE_HOLD");
    const entries = [f.base.timeline.append({ characterId: "taki", role: "user", content: "Unbound primary source" })];
    runtime.recordPrimaryCommitted({ characterId: "taki", entries });
    expect(f.db.prepare("SELECT * FROM hindsight_ingestion_primary_commits WHERE timeline_seq=:seq").get({ seq: entries[0]!.seq })).toBeDefined();
    expect(model.doGenerateCalls).toHaveLength(0);
    f.owner.cancel(operation.operationId);
    expect(runtime.recoverHindsightBinding("epoch").binding).toBe("published");
    const recovered = runtime.operations()!;
    expect(recovered).not.toBeNull();
    expect(recovered.scheduler).not.toBe(previous.scheduler);
    expect(recovered.scheduler.started()).toBe(true);
    expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: "epoch" });
  });

  it("refuses a newly constructed ordinary runtime from the persistent hold after physical reopen", async () => {
    const { f } = fixture();
    const operation = f.admit(await f.request()); const plan = f.plan(operation);
    await f.reopen();
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(f.owner.status(operation.operationId).state).toBe("outcome_unknown");
    expect(() => createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.deps.config,
      secrets: f.deps.secrets, client: f.native.client })).toThrow("MEMORY_TEMPLATE_HOLD");
    expect(f.native.calls.filter((call) => call.method === "apply")).toEqual([]);
  });

  it.each(["complete", "expired", "stopped"] as const)("keeps private synchronization guarded when its executor is %s", async (outcome) => {
    const { f, model } = fixture(); const runtime = f.base.compose();
    await runtime.captureRun("taki");
    const pending = seedPending(f);
    const beforePending = f.db.prepare("SELECT * FROM pending_memory").all();
    const admissions = f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all();
    const operation = f.admit(await f.request()); const plan = f.plan(operation); const bank = plan.banks[0]!;
    createMemoryOperationRepo(f.db).transition({ operationId: operation.operationId, expectedState: "admitted", patch: { state: "running" } });
    const lease = claimTemplateExecutor(f.db, { planId: plan.planId, operationId: operation.operationId, bootId: f.state.bootId, now: f.state.now });
    const assertCurrent = () => { assertTemplateExecutor(f.db, { lease, now: f.state.now }); assertTemplateLocalPlan(f.deps, { plan }); };
    const receipt = await f.native.client.templateApply!({ request: bank.preview.request, context: { timeoutMs: 5000 } });
    recordTemplateBankReceipt(f.db, { lease, bank, receipt, now: f.state.now });
    const input = { plan, signal: new AbortController().signal, assertCurrent };
    await runtime.templates.quiesce(input);
    const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    f.base.remote.control.beforeChanges = async () => { entered.resolve(); await release.promise; };
    const syncing = runtime.templates.synchronize({ ...input, bank });
    const result = syncing.then(() => null, (error: unknown) => error);
    await entered.promise;
    expect((await runtime.captureRun("taki")).tools).toEqual({});
    expect(() => createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.deps.config,
      secrets: f.deps.secrets, client: f.native.client })).toThrow("MEMORY_TEMPLATE_HOLD");
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    const checkpoints = f.db.prepare("SELECT * FROM hindsight_application_replica_checkpoints").all();
    if (outcome === "expired") f.state.now = new Date(lease.deadlineMs + 1).toISOString();
    const stopping = outcome === "stopped" ? runtime.stop() : Promise.resolve();
    release.resolve();
    if (outcome === "complete") expect(await result).toBeNull();
    else {
      expect(await result).toBeInstanceOf(Error);
      expect(f.db.prepare("SELECT * FROM hindsight_application_replica_checkpoints").all()).toEqual(checkpoints);
    }
    await stopping;
    expect(f.db.prepare("SELECT * FROM pending_memory").all()).toEqual(beforePending);
    expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual(admissions);
    expect(pending.phase).toBe("queued"); expect(runtime.operations()).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(f.base.remote.calls.some((call) => call.operation.includes("/native/") || call.operation.includes("retain"))).toBe(false);
  });

  it("keeps holds current and rejects historical template damage at full construction", async () => {
    const { f } = fixture();
    const operation = f.owner.submit(await f.request()); await f.owner.stop();
    expect(f.owner.status(operation.operationId).state).toBe("completed");
    const runtime = createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.deps.config,
      secrets: f.deps.secrets, client: f.native.client });
    try {
      runtime.assertConnection(); runtime.assertConnection();
      f.db.exec("DROP TRIGGER hindsight_template_bases_immutable_update");
      const rollback = new Error("restore template fixture");
      expect(() => f.db.transaction(() => {
        f.db.prepare("UPDATE hindsight_template_bases SET document_hash=:hash").run({ hash: "0".repeat(64) });
        expect(() => runtime.assertConnection()).not.toThrow();
        expect(() => createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.deps.config,
          secrets: f.deps.secrets, client: f.native.client })).toThrow("HINDSIGHT_RESPONSE_INVALID");
        throw rollback;
      })).toThrow(rollback);
      runtime.assertConnection();
      f.admit(await f.request());
      expect(runtime.driftReason()).toBe("template_hold");
      expect(() => runtime.assertConnection()).toThrow("MEMORY_TEMPLATE_HOLD");
    } finally { runtime.stop(); }
  });
});

function seedPending(f: TemplateLifecycleFixture) {
  const bank = { bankId: f.bindings[0].externalBankId, scope: "global", characterId: null };
  const checkpoint = readApplicationCheckpoint(f.db, bank.bankId)!;
  return createPendingMemoryRepo(f.db, () => f.state.now, (id) => f.base.replica.bankBinding(id)?.bank).enqueue(PendingMemoryIntentSchema.parse({
    schemaVersion: 1, authorityEpochId: "epoch", providerId: "hindsight", providerLineageId: checkpoint.namespace.provider_lineage,
    bankGeneration: checkpoint.namespace.bank_generation, bank, operationId: "template-held-pending", originalAt: f.state.now,
    baseCursor: checkpoint.checkpoint.native_cursor, operation: { kind: "retain", zeroResultAllowed: true,
      request: { bankId: bank.bankId, content: "Pending remains held", context: null, timestamp: null, tags: [], entities: [], metadata: {},
        observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
        provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
          capturedAt: f.state.now, sanitized: true, sourceRef: null },
        policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
          retention: { kind: "permanent" }, policyVersion: 1 } } },
  }));
}
