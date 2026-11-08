import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { HindsightMemoryRecallEnvelopeV1Schema } from "@taki/shared";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { openDatabase } from "../db/sqlite.ts";
import * as publications from "../db/memory-transition-publication-reader.ts";
import { publishMemoryTransition } from "../db/memory-transition-publication-repo.ts";
import { readTransitionAttempt } from "../db/memory-transition-repo.ts";
import { createMethodRegistry, type MethodContext } from "../server/method-registry.ts";
import { memoryAuthorityStatusMethod } from "../server/methods/memory-authority-status.ts";
import { createHealthyTransitionHarness, composeHealthyTransitionHarness } from "../testing/memory-transition-healthy-fixtures.ts";
import { hindsightRuntimeFixture, hindsightFixtureSecrets } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { createHealthyTransitionTransport } from "../testing/memory-transition-healthy-transport.ts";
import { createHindsightTemplateLifecycleService } from "./hindsight/template-lifecycle/template-lifecycle-service.ts";
import { templateLifecycleFixture } from "./hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createEmergencyTransitionService } from "./transitions/transition-emergency-service.ts";
import { createHindsightBackupStore } from "./hindsight-backup/hindsight-backup-store.ts";
import { readHindsightBackupIdentity } from "./hindsight-backup/hindsight-backup-identity.ts";
import { readCurrentMemoryAuthorityIdentity } from "./legacy-migration/legacy-activation-repo.ts";
import { createMemoryStatusObserver } from "./operations/memory-status-observer.ts";
import { readMemoryAuthorityStatus } from "./operations/memory-authority-status.ts";
import { fakeSetup } from "./operations/memory-operation-fixtures.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const f = await createHealthyTransitionHarness();
  try {
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const operation = f.owner.submit(await f.request(undefined, kind)); await f.owner.stop();
      expect(f.owner.status(operation.operationId).state).toBe("completed");
    }
    return f;
  } catch (error) { await f.close(); throw error; }
}
function damageHistory(db: ReturnType<typeof openDatabase>): void {
  db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
  db.prepare("UPDATE memory_transition_native_evidence SET body=CAST(json_set(CAST(body AS TEXT),'$.status.proof.proof_hash',:hash) AS BLOB)")
    .run({ hash: "0".repeat(64) });
}

describe("live authority validation and recovery ownership", () => {
  it("boots coherent identity with damaged history into registered control diagnostics without a memory runtime", async () => {
    const f = await fixture(); await f.runtime.stop();
    const selected = readCurrentMemoryAuthorityIdentity(f.db); damageHistory(f.db);
    const restarted = composeHealthyTransitionHarness(f);
    const observer = createMemoryStatusObserver({ db: f.db, runtime: restarted.runtime });
    try {
      expect(restarted.runtime.operations()).toBeNull();
      expect(restarted.runtime.selected.legacy).toBeNull();
      expect(restarted.runtime.hasPublishedBinding("local")).toBe(false);
      const registry = createMethodRegistry();
      registry.register(memoryAuthorityStatusMethod({ logger: createCaptureLogger().logger, read: () => {
        const view = observer.readRuntime();
        return readMemoryAuthorityStatus({ db: f.db, live: restarted.runtime.operations, setup: fakeSetup(), operations: restarted.owner,
          liveConnection: () => ({ state: "unconfigured", fingerprint: null }) }, view.selection, view);
      } }));
      const context: MethodContext = { connection: { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] } },
        notify: () => undefined, close: () => undefined, onClose: () => undefined };
      expect(await registry.dispatch({ jsonrpc: "2.0", id: 1, method: "memory.authority.status", params: {} }, context))
        .toMatchObject({ result: { authority: { mode: "hindsight", epochId: selected.epochId },
          runtime: { available: false, unavailableReason: "authority_invalid" }, replica: null, pending: null } });
      await expect(restarted.runtime.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_INVALID");
      expect(() => restarted.runtime.recoverHindsightBinding(selected.epochId!)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { observer.close(); await restarted.stop(); await f.close(); }
  }, 30_000);

  it.each(["template", "emergency"])("withdraws the bound runtime when %s preview catches invalid selected history", async (kind) => {
    const f = await fixture(); const old = f.runtime.operations()!;
    const templates = createHindsightTemplateLifecycleService({ db: f.db, runtime: f.runtime.templates,
      config: createConfigSource({ repo: createConfigRepo(f.db), env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } }),
      secrets: hindsightFixtureSecrets().catalog, client: () => f.remote.client, bootId: "preview", now: () => W3_AT });
    const emergency = createEmergencyTransitionService({ db: f.db, runtime: f.runtime.transitions, ownerId: "preview", actorId: "operator",
      now: () => W3_AT, store: createHindsightBackupStore(f.dataDir), ready: () => false });
    try {
      damageHistory(f.db); expect(() => old.assertConnection()).not.toThrow();
      const result = kind === "template" ? await templates.preview({ target: { kind: "defaults", globalTemplateRevision: "taki-bank-v2",
        characterTemplateRevision: "taki-bank-v2" }, enrollment: "fresh", directives: [], refresh: [] })
        : await emergency.preview({ kind: "transition.emergency-local" });
      expect(result).toMatchObject(kind === "template" ? { state: "refused" } : { takeover: "refused" });
      expect(f.runtime.hindsightBindingSnapshot().binding).toMatchObject({ kind: "unavailable", code: "MEMORY_AUTHORITY_INVALID" });
      expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
      await expect(f.runtime.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_INVALID");
    } finally { templates.stop(); await emergency.stop(); await f.close(); }
  }, 30_000);

  it("withdraws selected damaged history at the committed replay proof boundary", async () => {
    const f = await fixture(); const old = f.runtime.operations()!;
    const receiptId = readCurrentMemoryAuthorityIdentity(f.db).transitionReceiptId!;
    const publication = f.runtime.verifyTransitionPublication(receiptId);
    const lease = readTransitionAttempt(f.db, publication.transitionId)!;
    try {
      damageHistory(f.db);
      expect(() => f.runtime.transitions.publish({ lease, candidateId: publication.candidateId, now: W3_AT,
        currentTime: () => W3_AT, assertConfiguration: () => undefined })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(f.runtime.operations()).toBeNull(); expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
    } finally { await f.close(); }
  }, 30_000);

  it("withdraws selected damaged history before the live owner's queue preparation", async () => {
    const f = await createHealthyTransitionHarness();
    try {
      const returned = f.owner.submit(await f.request()); await f.owner.stop();
      expect(f.owner.status(returned.operationId).state).toBe("completed");
      const execute = f.runtime.transitions.executeIntents;
      let queueFailure: unknown;
      const queue = vi.spyOn(f.runtime.transitions, "executeIntents").mockImplementationOnce(async (lease) => {
        const old = f.runtime.operations()!; old.assertConnection(); damageHistory(f.db);
        try { await execute(lease); } catch (error) { queueFailure = error; }
        expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
        throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      });
      const operation = f.owner.submit(await f.request(undefined, "transition.reenter-hindsight")); await f.owner.stop();
      expect(queue).toHaveBeenCalledOnce(); expect(f.owner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(queueFailure).toEqual(new Error("MEMORY_TRANSITION_PROOF_INVALID"));
      expect(f.runtime.operations()).toBeNull();
      expect(f.runtime.hindsightBindingSnapshot().binding).toMatchObject({ kind: "unavailable", code: "MEMORY_AUTHORITY_INVALID" });
    } finally { await f.close(); }
  }, 30_000);

  it("isolates foreign/copy/input/config failures and preserves the original error on a failed live proof", async () => {
    const f = await fixture(); let old = f.runtime.operations()!;
    try {
      expect(() => f.runtime.verifyTransitionPublication("foreign-receipt")).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(f.runtime.operations()).not.toBeNull(); old.assertConnection();
      const selectedReceipt = readCurrentMemoryAuthorityIdentity(f.db).transitionReceiptId!;
      const historicalReceipt = f.db.prepare("SELECT receipt_id FROM memory_transition_publications WHERE receipt_id<>:current LIMIT 1")
        .get({ current: selectedReceipt })?.receipt_id;
      expect(historicalReceipt).toEqual(expect.any(String));
      const restoreHistory = new Error("restore historical receipt");
      expect(() => f.db.transaction(() => {
        damageHistory(f.db);
        expect(() => f.runtime.verifyTransitionPublication(String(historicalReceipt))).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(f.runtime.operations()).not.toBeNull(); old.assertConnection(); throw restoreHistory;
      })).toThrow(restoreHistory);
      await expect(f.service.preview({ kind: "invalid" } as never)).rejects.toMatchObject({ name: "ZodError" });
      f.fault.constructor = true;
      await expect(f.service.preview({ kind: "transition.return-local" })).rejects.toThrow("owned constructor failure");
      f.fault.constructor = false; old.assertConnection();
      const originalRead = f.db.prepare;
      vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
        if (sql === "SELECT * FROM memory_transition_publications WHERE receipt_id=:id") throw new TypeError("unexpected reader failure");
        return originalRead(sql);
      });
      expect(() => f.runtime.verifySelectedAuthority()).toThrow(new TypeError("unexpected reader failure")); vi.restoreAllMocks();
      expect(f.runtime.operations()).toBeNull();
      f.runtime.recoverHindsightBinding(old.epochId); old = f.runtime.operations()!; old.assertConnection();
      const path = join(f.dataDir, "invalid-copy.sqlite"); await f.db.backupTo(path);
      const copy = openDatabase({ path, migrations: [] });
      try {
        damageHistory(copy);
        expect(() => readHindsightBackupIdentity(copy, { epochId: old.epochId, configFingerprint: old.configFingerprint,
          deploymentMode: old.deploymentMode, banks: old.banks })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      } finally { copy.close(); }
      expect(f.runtime.operations()).not.toBeNull(); old.assertConnection();
      const rollback = new Error("rollback candidate");
      const uncommittedReceiptId = "f".repeat(64);
      expect(() => f.db.transaction(() => {
        f.db.prepare("UPDATE memory_authority_selection SET transition_receipt_id=:receipt").run({ receipt: uncommittedReceiptId });
        expect(() => f.runtime.verifyTransitionPublication(uncommittedReceiptId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(f.runtime.operations()).not.toBeNull(); throw rollback;
      })).toThrow(rollback);
      old.assertConnection(); expect(publications.readVerifiedTransitionPublication(f.db, readCurrentMemoryAuthorityIdentity(f.db).transitionReceiptId!)).toBeDefined();
    } finally { await f.close(); }
  }, 30_000);

  it("recovers an intact same-epoch interrupted binding and performs ordinary recall", async () => {
    const f = hindsightRuntimeFixture(); f.config.upsert("TAKI_HINDSIGHT_ENABLED", false); const runtime = f.compose();
    try {
      const selected = readCurrentMemoryAuthorityIdentity(f.db);
      expect(runtime.operations()).toBeNull(); f.config.upsert("TAKI_HINDSIGHT_ENABLED", true);
      expect(runtime.recoverHindsightBinding(selected.epochId!)).toEqual({ binding: "published", reconciledGroups: 0 });
      const run = await runtime.captureRun("taki");
      const result = HindsightMemoryRecallEnvelopeV1Schema.parse(await run.tools.recall!.execute!({ query: "fact", scope: "both", limit: 8, maxTokens: 1024 },
        { toolCallId: "recovered-recall", messages: [], context: {} }));
      expect(result).toMatchObject({ ok: true, data: { returned: 2, partial: false } });
      expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual(selected);
    } finally { await f.close(); }
  });

  it("keeps known-invalid authority ahead of an active template hold and disabled configuration", async () => {
    const f = templateLifecycleFixture(); const runtime = f.base.compose();
    try {
      f.admit(await f.request());
      expect(runtime.hindsightBindingSnapshot().binding).toMatchObject({ code: "MEMORY_TEMPLATE_HOLD" });
      f.db.prepare("UPDATE hindsight_cutover_runs SET phase='failed',status='failed' WHERE run_id='fixture-run'").run();
      expect(() => runtime.verifySelectedAuthority()).toThrow("MEMORY_INTEGRITY_ERROR");
      f.base.config.upsert("TAKI_HINDSIGHT_ENABLED", false);
      const observer = createMemoryStatusObserver({ db: f.db, runtime });
      try { expect(observer.readRuntime().runtime.unavailableReason).toBe("authority_invalid"); }
      finally { observer.close(); }
      await expect(runtime.captureRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_INVALID");
    } finally { await f.close(); }
  });

  it("withdraws initial Local only when its own activation receipt fails and recovers the same epoch", async () => {
    const f = hindsightRuntimeFixture({ mode: "local" }); const runtime = f.compose();
    try {
      const selected = readCurrentMemoryAuthorityIdentity(f.db); const rollback = new Error("restore Local proof");
      expect(() => f.db.transaction(() => {
        f.db.prepare("UPDATE memory_migration_runs SET activation_transaction_id='foreign-transaction'").run();
        expect(() => runtime.verifySelectedAuthority()).toThrow("MEMORY_INTEGRITY_ERROR");
        expect(runtime.bindingSnapshot().binding).toMatchObject({ kind: "unavailable", code: "MEMORY_AUTHORITY_INVALID" });
        expect(() => runtime.memory.retention.listActive("profile")).toThrow("MEMORY_INTEGRITY_ERROR: selected memory runtime is unavailable");
        throw rollback;
      })).toThrow(rollback);
      expect(runtime.recoverLocalBinding(selected.epochId!)).toMatchObject({ binding: "published" });
      const run = await runtime.captureRun("taki"); expect(run.snapshot.providerId).toBe("local");
      expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual(selected);
    } finally { await f.close(); }
  });

  it("withdraws a bound Local publication when real primary custody no longer proves its source", async () => {
    const f = await createTransitionPublicationFixture();
    const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
    session.repo.append({ characterId: "taki", role: "user", content: "exact custody to preserve" }); session.finalize();
    publishMemoryTransition(f.db, f.prove());
    const live = composeHealthyTransitionHarness({ ...f, remote: createHealthyTransitionTransport(f.proofs, f.db), clock: { value: W3_AT } });
    try {
      expect(live.runtime.hasPublishedBinding("local")).toBe(true);
      f.db.prepare("UPDATE primary_memory_members SET entry_id='foreign-entry'").run();
      expect(() => live.runtime.verifySelectedAuthority()).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
      expect(live.runtime.bindingSnapshot().binding).toMatchObject({ kind: "unavailable", code: "MEMORY_AUTHORITY_INVALID" });
      expect(() => live.runtime.memory.retention.listActive("profile")).toThrow("MEMORY_INTEGRITY_ERROR: selected memory runtime is unavailable");
    } finally { await live.stop(); await f.close(); }
  }, 30_000);

  it("records invalid committed-but-unbound target proof without retiring the other provider's predecessor", async () => {
    const f = await createHealthyTransitionHarness(); const old = f.runtime.operations()!;
    const bind = f.runtime.transitions.bind; let failure: unknown;
    vi.spyOn(f.runtime.transitions, "bind").mockImplementationOnce(async (transitionId) => {
      damageHistory(f.db);
      try { return await bind(transitionId); } catch (error) { failure = error; throw error; }
    });
    try {
      const operation = f.owner.submit(await f.request()); await f.owner.stop();
      expect(failure).toEqual(new Error("MEMORY_TRANSITION_PROOF_INVALID"));
      expect(f.owner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(f.runtime.bindingSnapshot()).toMatchObject({ selection: "canonical-local", binding: { kind: "unavailable", code: "MEMORY_AUTHORITY_INVALID" } });
      expect(f.runtime.bindingPublication("hindsight").binding).toEqual({ kind: "published", epochId: old.epochId });
      expect(() => old.assertConnection()).toThrow("MEMORY_AUTHORITY_MISMATCH");
    } finally { await f.close(); }
  }, 30_000);

  it("rolls failed target readback back without marking or withdrawing the valid predecessor", async () => {
    const f = await createHealthyTransitionHarness(); const old = f.runtime.operations()!;
    const selected = readCurrentMemoryAuthorityIdentity(f.db); const publish = f.runtime.transitions.publish;
    let verifiedRollback = false;
    vi.spyOn(f.runtime.transitions, "publish").mockImplementationOnce((work) => {
      const read = publications.readVerifiedTransitionPublication;
      const failure = new Error("MEMORY_TRANSITION_PROOF_INVALID");
      const guard = vi.spyOn(publications, "readVerifiedTransitionPublication").mockImplementation((db, receiptId, context) => {
        if (readCurrentMemoryAuthorityIdentity(db).mode === "canonical-local") throw failure;
        return read(db, receiptId, context);
      });
      try {
        expect(() => publish(work)).toThrow(failure);
        expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual(selected);
        expect(f.runtime.bindingPublication("hindsight").binding).toEqual({ kind: "published", epochId: old.epochId });
        old.assertConnection(); verifiedRollback = true;
      } finally { guard.mockRestore(); }
      throw failure;
    });
    try {
      f.owner.submit(await f.request()); await f.owner.stop(); expect(verifiedRollback).toBe(true);
    } finally { await f.close(); }
  }, 30_000);
});
