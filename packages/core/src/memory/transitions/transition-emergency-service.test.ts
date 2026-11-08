import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { composeMemoryTransitions } from "../../boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { fakeSetup } from "../operations/memory-operation-fixtures.ts";
import { readEmergencyIncident } from "../../db/memory-transition-emergency-repo.ts";
import { readTransitionAttempt, claimTransition } from "../../db/memory-transition-repo.ts";
import { sourceTransition } from "./transition-queued-provider.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { createHindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import { createHindsightBackupStore } from "../hindsight-backup/hindsight-backup-store.ts";
import { readHindsightBackupCustody } from "../hindsight-backup/hindsight-backup-custody.ts";
import { createCanonicalIngestionSourceRepo } from "../../db/canonical-ingestion-source-repo.ts";
import { createHindsightRuntimeConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { createHindsightRuntimeState } from "../hindsight/hindsight-runtime-state.ts";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { createHindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";
import { applicationCommandTestInput, applicationCommandTestReceipt } from "../../db/hindsight-application-command-fixtures.ts";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { PendingMemoryIntentSchema } from "@taki/shared";
import { emergencyRowHash } from "../../db/memory-transition-row-hash.ts";
import { appendUnboundEmergencyMemory, appendRebindingEmergencyMemory } from "../../testing/memory-transition-emergency-service-fixtures.ts";
import { readCurrentReplicaClosure } from "../../db/memory-transition-surviving-capture.ts";
import * as survivingPolicy from "../../db/memory-transition-surviving-policy.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const h = await createHealthyTransitionHarness({ aliases: true });
  for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
    const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
    expect(h.owner.status(operation.operationId).state).toBe("completed");
  }
  return emergencyFor(h);
}
function emergencyFor(h: Awaited<ReturnType<typeof createHealthyTransitionHarness>>) {
  const { logger } = createCaptureLogger();
  const config = createConfigSource({ repo: createConfigRepo(h.db), env: { TAKI_HINDSIGHT_ENABLED: "false" } });
  const secrets = hindsightFixtureSecrets(); secrets.state.value = null;
  const backup = createHindsightBackupService({ db: h.db, store: createHindsightBackupStore(h.dataDir), logger,
    route: { available: () => true, snapshot: async () => { throw new Error("unexpected backup Native call"); }, readBack: async () => null },
    custody: () => readHindsightBackupCustody({ catalog: secrets.catalog, storeId: "owned" }), missingCredentials: () => [], now: () => h.clock.value });
  const service = composeMemoryTransitions({ db: h.db, config, secrets: secrets.catalog,
    runtime: h.runtime, ownerId: "emergency-owner", actorId: "operator", logger, client: h.remote.client, now: () => h.clock.value, backup });
  const owner = createMemoryOperationService({ db: h.db, live: h.runtime.operations, setup: fakeSetup(), transition: service,
    bootId: "healthy-fixture", logger, now: () => h.clock.value, onChanged: () => undefined, backup });
  const request = async (recoveryTransitionId?: string) => {
    const preview = await service.preview({ kind: "transition.emergency-local", recoveryTransitionId });
    if (!preview.expected) throw new Error(`owned fixture refused: ${preview.blocking.join(",")}`);
    return { kind: preview.kind, previewId: preview.previewId, previewHash: preview.previewHash, expected: preview.expected,
      requestId: randomUUID(), confirmation: "emergency-takeover" as const, ...(preview.recovery ? { recovery: preview.recovery } : {}) };
  };
  return { ...h, backup, emergency: service, emergencyOwner: owner, emergencyRequest: request,
    close: async () => { await service.stop(); await backup.stop(); await owner.stop(); await h.close(); } };
}

describe("offline emergency through the production operation owner", () => {
  it.each(["during-copy", "after-commit-before-bind"] as const)("keeps primary finalization %s assigned exactly once", async (boundary) => {
    const h = await fixture();
    try {
      const session = h.runtime.custody.begin({ characterId: "taki", repo: h.timeline });
      const entry = session.repo.append({ characterId: "taki", role: "user", content: "owned late finalization" });
      if (boundary === "during-copy") {
        const copy = h.db.backupTo.bind(h.db);
        vi.spyOn(h.db, "backupTo").mockImplementationOnce(async (path) => { const pages = await copy(path); session.finalize(); return pages; });
      } else {
        const bind = h.runtime.transitions.bind.bind(h.runtime.transitions);
        vi.spyOn(h.runtime.transitions, "bind").mockImplementationOnce(async (id) => { session.finalize(); return bind(id); });
      }
      const operation = h.emergencyOwner.submit(await h.emergencyRequest()); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("completed");
      const epochId = readMemoryAuthoritySelection(h.db).epochId!;
      const local = createCanonicalIngestionSourceRepo(h.db);
      local.recordPrimaryCommitted({ characterId: "taki", entries: [entry], epochId });
      expect(local.pendingEntries({ epochId, characterId: "taki", throughSeq: entry.seq }).filter((value) => value.entry.seq === entry.seq)).toHaveLength(1);
    } finally { await h.close(); }
  }, 30_000);
  it("seals original Pending uncertainty without relabeling or dispatching it under Local", async () => {
    const h = await fixture();
    try {
      const runtime = h.runtime.operations()!; const bank = runtime.banks()[0]!;
      const checkpoint = readApplicationCheckpoint(h.db, bank.bankId)!;
      // Exercise the same D77 bank reader and epoch/namespace/fence guards as the published runtime.
      const state = createHindsightRuntimeState({ db: h.db, config: loadMemoryConfig({}),
        runtime: createHindsightRuntimeConnection({ db: h.db, epochId: runtime.epochId, client: h.remote.client,
          secrets: hindsightFixtureSecrets().catalog, config: createConfigSource({ repo: createConfigRepo(h.db),
            env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } }) }) });
      const pending = state.pending.enqueue(PendingMemoryIntentSchema.parse({ schemaVersion: 1,
        authorityEpochId: runtime.epochId, providerId: "hindsight", providerLineageId: checkpoint.namespace.provider_lineage,
        bankGeneration: checkpoint.namespace.bank_generation, bank, operationId: "owned-unknown-pending", originalAt: W3_AT,
        baseCursor: checkpoint.checkpoint.native_cursor, operation: { kind: "retain", zeroResultAllowed: true,
          request: { bankId: bank.bankId, content: "Owned unknown retained fact", context: null, timestamp: null, tags: [], entities: [], metadata: {},
            observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
            provenance: { actor: "user", origin: "explicit-user", characterId: bank.characterId, timelineFromSeq: null,
              timelineToSeq: null, capturedAt: W3_AT, sanitized: true, sourceRef: null },
            policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
              retention: { kind: "permanent" }, policyVersion: 1 } } } }));
      const parents = createHindsightMemoryWriteRepo({ db: h.db, assertActive: state.assertActive });
      const parent = parents.prepare({ identity: { key: { authorityEpochId: runtime.epochId, bankId: bank.bankId,
        requestId: pending.intent.operationId }, namespace: checkpoint.namespace, actor: "foreground-agent", operation: pending.intent.operation },
        nativeOperationId: pending.remoteOperationId, target: null });
      const command = applicationCommandTestInput({ scope: { bankId: bank.bankId, namespace: checkpoint.namespace } });
      command.key.authorityEpochId = runtime.epochId;
      const prepared = state.commands.prepare(command);
      const dispatched = state.commands.markDispatched({ key: prepared.key, revision: prepared.revision });
      const old = h.db.prepare("SELECT * FROM pending_memory WHERE operation_id=:id").get({ id: pending.intent.operationId })!;
      const tables = ["hindsight_memory_write_intents", "hindsight_application_command_jobs"] as const;
      const originalRows = tables.map((table) => h.db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch`).all({ epoch: runtime.epochId }));
      const before = { ...h.remote.calls }; const operation = h.emergencyOwner.submit(await h.emergencyRequest()); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("completed");
      const id = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      expect(readEmergencyIncident(h.db, id)!.transition!.unknownEffects).toContainEqual({ table: "pending_memory", epochId: runtime.epochId,
        recordKey: JSON.stringify([bank.bankId, pending.intent.operationId]), rowHash: emergencyRowHash(old), disposition: "held-unknown" });
      expect(h.db.prepare("SELECT * FROM pending_memory WHERE operation_id=:id").get({ id: pending.intent.operationId })).toEqual(old);
      tables.forEach((table, index) => {
        const rows = h.db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch`).all({ epoch: runtime.epochId });
        expect(rows).toEqual(originalRows[index]);
        for (const row of rows) expect(readEmergencyIncident(h.db, id)!.transition!.unknownEffects).toContainEqual({ table,
          epochId: runtime.epochId, recordKey: JSON.stringify([row.bank_id, row.request_id]), rowHash: emergencyRowHash(row), disposition: "held-unknown" });
      });
      expect(() => parents.application({ key: parent.identity.key, revision: parent.revision, command: dispatched.key })).toThrow();
      const late = applicationCommandTestReceipt({ job: dispatched });
      expect(() => state.commands.recordReceipt({ key: dispatched.key, revision: dispatched.revision, receipt: late.receipt,
        affectedVersionsBody: late.body })).toThrow();
      tables.forEach((table, index) => expect(h.db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch`).all({ epoch: runtime.epochId })).toEqual(originalRows[index]));
      expect(h.remote.calls).toEqual(before);
    } finally { await h.close(); }
  }, 30_000);
  it("accepts complete surviving evidence even when historical setup is no longer verified", async () => {
    const h = await fixture();
    try {
      h.db.exec("UPDATE hindsight_bank_setup SET status='pending',last_verified_at=NULL");
      const operation = h.emergencyOwner.submit(await h.emergencyRequest()); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("completed");
    } finally { await h.close(); }
  }, 30_000);
  it.each(["missing", "partial"] as const)("discloses %s replica state without creating a submit identity", async (mode) => {
    const h = await fixture();
    try {
      h.db.exec("DELETE FROM hindsight_application_replica_checkpoints");
      if (mode === "missing") h.db.exec("DELETE FROM hindsight_replica_sync_checkpoints");
      const before = { ...h.remote.calls };
      const preview = await h.emergency.preview({ kind: "transition.emergency-local" });
      expect(preview).toMatchObject({ expected: null, takeover: "refused", inventory: "complete", blocking: ["incomplete-replica"] });
      expect(preview.banks.every((bank) => bank.evidence === (mode === "missing" ? "missing" : "native-only"))).toBe(true);
      expect(h.remote.calls).toEqual(before);
    } finally { await h.close(); }
  }, 30_000);
  it.each(["binding_missing", "rebind_required"] as const)("refuses paired evidence with an unreconstructible %s Memory before withdrawing the source", async (binding) => {
    const h = await fixture();
    try {
      const identity = (await h.emergencyRequest()).expected;
      const bank = identity.banks[0]!;
      const head = binding === "binding_missing" ? appendUnboundEmergencyMemory(h.db, bank.sourceBankId)
        : appendRebindingEmergencyMemory(h.db, bank.sourceBankId);
      const closure = readCurrentReplicaClosure(h.db, { epochId: identity.predecessorEpochId, bank, lineage: identity.sourceLineageId });
      expect(closure.heads).toContainEqual(head);
      expect(head.binding_state).toBe(binding);
      const before = { ...h.remote.calls };
      const selected = readMemoryAuthoritySelection(h.db);
      const retired = vi.spyOn(h.runtime.transitions, "emergencyQuiesce");
      const admitted = vi.spyOn(h.emergency, "emergencyAdmitted");
      const preview = await h.emergency.preview({ kind: "transition.emergency-local" });
      expect(preview).toMatchObject({ expected: null, takeover: "refused", inventory: "complete", blocking: ["incomplete-replica"] });
      expect(preview.banks.every((row) => row.evidence === "paired-replica")).toBe(true);
      expect(retired).not.toHaveBeenCalled(); expect(admitted).not.toHaveBeenCalled();
      expect(h.runtime.hasPublishedBinding("hindsight")).toBe(true);
      expect(readMemoryAuthoritySelection(h.db)).toEqual(selected); expect(h.remote.calls).toEqual(before);
    } finally { await h.close(); }
  }, 30_000);
  it.each([1, 2])("refuses a previously issued rebinding preview at admission plan %i without sealing or retiring", async (planNumber) => {
    const h = await fixture();
    try {
      const bank = (await h.emergencyRequest()).expected.banks[0]!;
      appendRebindingEmergencyMemory(h.db, bank.sourceBankId);
      // Represent a persisted preview issued by the old eligibility check; admission must independently reject it.
      const oldEligibility = vi.spyOn(survivingPolicy, "readSurvivingBaselinePolicies").mockReturnValue(new Map());
      const request = await h.emergencyRequest(); oldEligibility.mockRestore();
      const selected = readMemoryAuthoritySelection(h.db); const remote = { ...h.remote.calls };
      const rows = h.db.prepare("SELECT * FROM memory_operations").all();
      const retired = vi.spyOn(h.runtime.transitions, "emergencyQuiesce");
      const admitted = vi.spyOn(h.emergency, "emergencyAdmitted");
      const copy = vi.spyOn(h.db, "backupTo");
      const plan = vi.spyOn(h.emergency, "plan");
      // Isolate the second plan's check from the first plan's refusal.
      if (planNumber === 2) plan.mockReturnValueOnce({ current: request.expected, actorId: "operator" });
      expect(() => h.emergencyOwner.submit(request)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(plan).toHaveBeenCalledTimes(planNumber);
      expect(retired).not.toHaveBeenCalled(); expect(admitted).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
      expect(h.db.prepare("SELECT * FROM memory_transition_emergency_captures").all()).toEqual([]);
      expect(h.db.prepare("SELECT * FROM memory_transition_incidents").all()).toEqual([]);
      expect(h.db.prepare("SELECT * FROM memory_operations").all()).toEqual(rows);
      expect(h.runtime.hasPublishedBinding("hindsight")).toBe(true);
      expect(readMemoryAuthoritySelection(h.db)).toEqual(selected); expect(h.remote.calls).toEqual(remote);
    } finally { await h.close(); }
  }, 30_000);
  it.each(["replica", "backup"] as const)("passes a hung %s producer and rejects its later callback", async (kind) => {
    const h = await fixture(); let release: (() => void) | undefined;
    try {
      const live = h.runtime.operations()!;
      const stopped = kind === "backup" ? vi.spyOn(live.scheduler, "stop").mockImplementation(() => new Promise<void>((resolve) => { release = resolve; })) : null;
      const called = kind === "replica" ? vi.spyOn(h.remote.client, "compatibility").mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(structuredClone(h.remote.manifest));
      })) : null;
      const operation = h.emergencyOwner.submit(kind === "replica" ? { kind: "replica.sync", bankId: live.banks()[0]!.bankId, syncKind: "full" }
        : { kind: "backup.capture", expectedEpochId: live.epochId, route: "native-endpoint" });
      await vi.waitFor(() => expect(release).toBeDefined());
      const before = { ...h.remote.calls }; const preexisting = called?.mock.calls.length ?? 0;
      const request = await h.emergencyRequest(); const emergency = h.emergencyOwner.submit(request); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(emergency.operationId).state).toBe("completed");
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      const selected = readMemoryAuthoritySelection(h.db);
      const manual = h.db.prepare("SELECT * FROM hindsight_replica_manual_requests").all();
      expect(() => live.scheduler.start()).toThrow();
      expect(() => live.scheduler.requestManual(live.banks()[0]!.bankId)).toThrow();
      release!(); stopped?.mockRestore();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(readMemoryAuthoritySelection(h.db)).toEqual(selected);
      expect(h.db.prepare("SELECT * FROM hindsight_replica_manual_requests").all()).toEqual(manual);
      expect(h.remote.calls).toEqual(before);
      if (called) expect(called).toHaveBeenCalledTimes(preexisting);
    } finally { release?.(); await h.close(); }
  }, 30_000);

  it("uses the committed Hindsight receipt to quarantine a reentry whose admission still names Local", async () => {
    const base = await createHealthyTransitionHarness({ aliases: true });
    const returned = base.owner.submit(await base.request()); await base.owner.stop(); expect(base.owner.status(returned.operationId).state).toBe("completed");
    const h = emergencyFor(base); let release!: () => void;
    try {
      const bind = h.runtime.transitions.bind.bind(h.runtime.transitions);
      vi.spyOn(h.runtime.transitions, "bind").mockImplementationOnce(() => new Promise<"published">((resolve) => { release = () => resolve("published"); }));
      const old = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight"));
      await vi.waitFor(() => expect(release).toBeDefined(), { timeout: 10_000 });
      const source = readMemoryAuthoritySelection(h.db);
      expect(source.mode).toBe("hindsight"); expect(old.authorityEpochId).not.toBe(source.epochId);
      vi.mocked(h.runtime.transitions.bind).mockImplementation(bind);
      const emergency = h.emergencyOwner.submit(await h.emergencyRequest()); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(emergency.operationId).state).toBe("completed");
      const selected = readMemoryAuthoritySelection(h.db); const before = { ...h.remote.calls };
      release(); await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.owner.status(old.operationId).state).toBe("outcome_unknown");
      expect(readMemoryAuthoritySelection(h.db)).toEqual(selected); expect(h.remote.calls).toEqual(before);
    } finally { release?.(); await h.close(); }
  }, 30_000);
  it("commits and binds Local with absent credentials and backup without any new Native dispatch", async () => {
    const h = await fixture();
    try {
      const before = { ...h.remote.calls };
      const calls = Object.keys(h.remote.client).filter((key) => typeof h.remote.client[key as keyof typeof h.remote.client] === "function")
        .map((key) => vi.spyOn(h.remote.client, key as "compatibility").mockImplementation(() => new Promise(() => undefined)));
      const request = await h.emergencyRequest();
      const operation = h.emergencyOwner.submit(request); await h.emergencyOwner.stop();
      expect(h.emergencyOwner.status(operation.operationId)).toMatchObject({ state: "completed",
        result: { authorityCommitted: true, runtime: "ready", queue: "settled" } });
      expect(h.emergencyOwner.submit(request).operationId).toBe(operation.operationId);
      const transitionId = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      const incident = readEmergencyIncident(h.db, transitionId)!;
      expect(incident.lastVerifiedBackupId).toBeNull();
      expect(incident.transition!.banks.every((bank) => bank.remoteHead === "unknown" && bank.remoteLoss === "unknown")).toBe(true);
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(h.runtime.hasPublishedBinding("hindsight")).toBe(false);
      expect(h.remote.calls).toEqual(before);
      for (const call of calls) expect(call).not.toHaveBeenCalled();
      await expect(h.emergency.preview({ kind: "transition.reenter-hindsight" })).rejects.toThrow();
    } finally { await h.close(); }
  }, 30_000);

  it("quarantines a permanently hung healthy operation without rewriting its attempt or dispatch history", async () => {
    const h = await fixture();
    let release: (() => void) | undefined;
    try {
      const healthy = await h.request();
      const compatibility = vi.spyOn(h.remote.client, "compatibility").mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(structuredClone(h.remote.manifest));
      }));
      const old = h.owner.submit(healthy);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.owner.status(old.operationId).state).toBe("running");
      const oldId = old.producer!.kind === "transition" ? old.producer!.transitionId : "";
      const attempt = readTransitionAttempt(h.db, oldId)!;
      const callsBeforeEmergency = compatibility.mock.calls.length;
      const request = await h.emergencyRequest(); const operation = h.emergencyOwner.submit(request);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([h.emergencyOwner.stop(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("emergency waited for old compatibility")), 5000);
      })]); } finally { clearTimeout(timer); }
      expect(h.emergencyOwner.status(operation.operationId).state).toBe("completed");
      expect(h.owner.status(old.operationId).state).toBe("outcome_unknown");
      expect(readTransitionAttempt(h.db, oldId)).toEqual(attempt);
      expect(() => claimTransition(h.db, { transitionId: oldId, operationId: old.operationId, ownerId: "late",
        now: new Date(Date.parse(W3_AT) + 600_000).toISOString(), leaseMs: 10_000 })).toThrow("MEMORY_TRANSITION_LEASE_LOST");
      expect(sourceTransition(h.db, request.expected.predecessorEpochId)).toBeUndefined();
      expect(compatibility).toHaveBeenCalledTimes(callsBeforeEmergency);
      const selected = readMemoryAuthoritySelection(h.db); const calls = { ...h.remote.calls };
      release!(); await h.owner.stop();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.owner.status(old.operationId).state).toBe("outcome_unknown");
      expect(readTransitionAttempt(h.db, oldId)).toEqual(attempt);
      expect(readMemoryAuthoritySelection(h.db)).toEqual(selected);
      expect(h.remote.calls).toEqual(calls);
      expect(h.db.prepare(`SELECT count(*) AS n FROM memory_transition_queue_executions e JOIN memory_transition_queue q USING(intent_id)
        WHERE q.transition_id=:id`).get({ id: oldId })?.n).toBe(0);
    } finally { release?.(); await h.close(); }
  }, 30_000);
});
