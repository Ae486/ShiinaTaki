import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigSource } from "../../../config/config-source.ts";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { composeMemoryTransitions } from "../../../boot/memory-transition-boot.ts";
import { createCanonicalIngestionSourceRepo } from "../../../db/canonical-ingestion-source-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../../../db/hindsight-application-replica-repo.ts";
import { readEmergencyIncident } from "../../../db/memory-transition-emergency-repo.ts";
import { emergencyRowHash } from "../../../db/memory-transition-row-hash.ts";
import { applicationTestSnapshot, applicationTestNativeBaseline } from "../../../testing/hindsight-application-fixtures.ts";
import { createMemoryOperationService } from "../../operations/memory-operation-service.ts";
import { fakeSetup } from "../../operations/memory-operation-fixtures.ts";
import { createHindsightLifecycleService } from "../../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import { createHindsightBackupService } from "../../hindsight-backup/hindsight-backup-service.ts";
import { createHindsightBackupStore } from "../../hindsight-backup/hindsight-backup-store.ts";
import { readHindsightBackupCustody } from "../../hindsight-backup/hindsight-backup-custody.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { createIntlSegmenterTokenizer } from "../../search-tokenizer.ts";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";
import { curatorTestBank } from "../hindsight-policy-curator-fixtures.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { checkpointTemplateExecutor, readTemplateExecutor, type TemplateExecutorLease } from "./template-executor-store.ts";
import { readTemplateHold, readTemplatePublication } from "./template-execution-reads.ts";

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-08T00:00:00.000Z"); });
afterEach(async () => {
  try { for (const close of cleanup.splice(0).reverse()) await close(); }
  finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

function fixture(f = templateLifecycleFixture()) {
  cleanup.push(f.close);
  const runtime = f.base.compose();
  f.deps.runtime = runtime.templates;
  const lifecycle = createHindsightLifecycleService({ ...f.deps, templates: f.service, runtime: runtime.operations,
    binding: runtime.hindsightBindingSnapshot, replaceBinding: runtime.templates.replaceBinding, logger: f.base.logger, wait: async () => undefined });
  const backup = createHindsightBackupService({ db: f.db, store: createHindsightBackupStore(f.base.dataDir), logger: f.base.logger,
    route: { available: () => true, snapshot: async () => { throw new Error("unexpected emergency Native backup"); }, readBack: async () => null },
    custody: () => readHindsightBackupCustody({ catalog: f.base.secrets.catalog, storeId: "template-emergency-fixture" }),
    missingCredentials: () => [], now: () => f.state.now });
  const transition = composeMemoryTransitions({ ...f.deps, runtime, backup, lifecycle, ownerId: "template-emergency", actorId: "operator",
    config: createConfigSource({ repo: createConfigRepo(f.db), env: { TAKI_HINDSIGHT_ENABLED: "false" } }),
    logger: f.base.logger, client: f.native.client });
  const owner = createMemoryOperationService({ db: f.db, bootId: f.state.bootId, now: () => f.state.now,
    live: runtime.operations, setup: fakeSetup(), transition, templates: f.service, lifecycle, backup,
    logger: f.base.logger, onChanged: () => undefined });
  cleanup.push(async () => { await transition.stop(); await lifecycle.stop(); await backup.stop(); await owner.stop(); });
  const request = async () => {
    const preview = await transition.preview({ kind: "transition.emergency-local" });
    expect(preview.expected, preview.blocking.join(",")).not.toBeNull();
    return { kind: "transition.emergency-local" as const, requestId: randomUUID(), previewId: preview.previewId,
      previewHash: preview.previewHash, expected: preview.expected!, confirmation: "emergency-takeover" as const };
  };
  return { f, runtime, owner, transition, lifecycle, backup, request };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const counters = (f: TemplateLifecycleFixture) => ({ template: structuredClone(f.native.calls), runtime: structuredClone(f.base.remote.calls) });

function planEvidence(f: TemplateLifecycleFixture, planId: string) {
  return ["hindsight_template_plans", "hindsight_template_admissions", "hindsight_template_executors",
    "hindsight_template_dispatches", "hindsight_template_bank_receipts", "hindsight_template_observations",
    "hindsight_template_holds", "hindsight_template_publications"].map((table) => ({ table,
    rows: f.db.prepare(`SELECT * FROM ${table} WHERE plan_id=:id`).all({ id: planId }) }));
}

describe("template holds through the actual offline emergency producer", () => {
  it("does not revisit closed SQLite when an ignored Apply finishes after takeover and shutdown", async () => {
    const h = fixture(); const { f, owner } = h;
    const entered = deferred(); const release = deferred(); const delivered = deferred();
    f.native.hooks.before = async (call) => {
      if (call.method === "apply") { entered.resolve(); await release.promise; }
    };
    f.native.hooks.afterCommit = () => { delivered.resolve(); };
    const prepare = f.db.prepare; const transaction = f.db.transaction;
    try {
      const original = owner.submit(await f.request()); await entered.promise;
      const plan = f.plan(original);
      const emergency = owner.submit(await h.request()); await owner.stop();
      expect(owner.status(emergency.operationId).state).toBe("completed");
      expect(owner.status(original.operationId).state).toBe("outcome_unknown");
      expect(readTemplateHold(f.db, plan.planId)?.state).toBe("quarantined");
      const empty = f.db.prepare("SELECT 1 WHERE 0");
      // Match main.ts: stop templates, stop the other producers, retire the memory
      // runtime, await the operation owner, and only then close its physical Database.
      f.service.stop();
      await Promise.all([h.lifecycle.stop(), h.backup.stop(), h.transition.stop()]);
      await h.runtime.stop();
      await owner.stop();
      for (const close of cleanup.splice(0).reverse()) await close();
      const attempts: string[] = [];
      // Record all late access without producing an unrelated unhandled rejection in the
      // test runner. Even a swallowed read of a closed Database violates this boundary.
      f.db.prepare = (sql) => {
        attempts.push(sql);
        return { ...empty, get: () => undefined, all: () => [], run: () => { throw new Error("closed fixture write"); } };
      };
      f.db.transaction = () => { attempts.push("transaction"); throw new Error("closed fixture transaction"); };
      release.resolve(); await delivered.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(attempts).toEqual([]);
    } finally {
      release.resolve(); f.db.prepare = prepare; f.db.transaction = transaction;
    }
  }, 30_000);

  it.each(["unknown", "hung"] as const)("takes over a %s Apply without remote work and rejects its late completion", async (mode) => {
    const h = fixture(); const { f, runtime, owner } = h;
    const entered = deferred(); const release = deferred(); cleanup.push(async () => release.resolve());
    if (mode === "hung") f.native.hooks.before = async (call) => {
      if (call.method === "apply") { entered.resolve(); await release.promise; }
    };
    else f.native.hooks.afterCommit = () => { throw new Error("HINDSIGHT_TIMEOUT"); };
    const original = owner.submit(await f.request());
    if (mode === "hung") await entered.promise; else await owner.stop();
    const plan = f.plan(original);
    const oldOperation = owner.status(original.operationId);
    expect(oldOperation.state).toBe(mode === "hung" ? "running" : "outcome_unknown");
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    const lease = readTemplateExecutor(f.db, plan.planId) as TemplateExecutorLease;
    const before = planEvidence(f, plan.planId);
    const entry = f.base.timeline.append({ characterId: "taki", role: "user", content: "Primary source while rollout is held" });
    runtime.recordPrimaryCommitted({ characterId: "taki", entries: [entry] });
    f.base.secrets.state.value = null; f.base.remote.control.offline = true;
    const calls = counters(f);
    const emergencyRequest = await h.request();
    const emergency = owner.submit(emergencyRequest);
    await owner.stop();
    expect(owner.status(emergency.operationId)).toMatchObject({ state: "completed",
      result: { authorityCommitted: true, runtime: "ready", queue: "settled" } });
    expect(owner.submit(emergencyRequest).operationId).toBe(emergency.operationId);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("quarantined");
    expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    expect(readTemplateExecutor(f.db, plan.planId)).toEqual(lease);
    const selected = readMemoryAuthoritySelection(f.db);
    expect(selected.mode).toBe("canonical-local");
    expect(runtime.hasPublishedBinding("local")).toBe(true);
    expect(runtime.hasPublishedBinding("hindsight")).toBe(false);
    const local = createCanonicalIngestionSourceRepo(f.db);
    local.recordPrimaryCommitted({ epochId: selected.epochId!, characterId: "taki", entries: [entry] });
    expect(local.pendingEntries({ epochId: selected.epochId!, characterId: "taki", throughSeq: entry.seq })
      .filter((value) => value.entry.id === entry.id)).toHaveLength(1);
    expect(emergency.producer?.kind).toBe("transition");
    const transitionId = emergency.producer?.kind === "transition" ? emergency.producer.transitionId : "";
    const incident = readEmergencyIncident(f.db, transitionId)!;
    const inventory = incident.transition!.unknownEffects.filter((effect) => effect.table.startsWith("hindsight_template_"));
    const after = planEvidence(f, plan.planId);
    expect(inventory).toHaveLength(after.reduce((total, item) => total + item.rows.length, 0));
    for (const { table, rows } of after) for (const row of rows) {
      expect(inventory).toContainEqual(expect.objectContaining({ table, epochId: "epoch", rowHash: emergencyRowHash(row), disposition: "held-unknown" }));
    }
    for (const item of before.filter((value) => value.table !== "hindsight_template_holds")) {
      expect(after.find((value) => value.table === item.table)?.rows).toEqual(item.rows);
    }
    if (mode === "unknown") expect(owner.status(original.operationId)).toEqual(oldOperation);
    else expect(owner.status(original.operationId).state).toBe("outcome_unknown");
    const quarantined = owner.status(original.operationId);
    expect(() => checkpointTemplateExecutor(f.db, { lease, now: f.state.now })).toThrow("MEMORY_TEMPLATE_QUARANTINED");
    release.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(owner.status(original.operationId)).toEqual(quarantined);
    expect(planEvidence(f, plan.planId)).toEqual(after);
    expect(readMemoryAuthoritySelection(f.db)).toEqual(selected);
    expect(counters(f)).toEqual(calls);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }, 30_000);

  it.each(["reservation-only", "unpublished-plan"] as const)("preserves a failed Bank's %s in the sealed incident", async (mode) => {
    const f = templateLifecycleFixture();
    const params = f.params();
    if (params.target.kind !== "defaults") throw new Error("expected scope defaults");
    params.target.globalTemplateRevision = "none"; params.target.characterTemplateRevision = "none";
    const defaults = f.owner.submit(await f.request(params)); await f.owner.stop();
    expect(f.owner.status(defaults.operationId).state).toBe("completed");
    const h = fixture(f); const characterId = "emergency-character";
    const binding = hindsightBankBindings(characterId)[1];
    const bank = curatorTestBank({ bankId: binding.externalBankId, characterId, memories: [] });
    f.base.banks.push(bank);
    seedSurvivingBank(f, bank);
    if (mode === "reservation-only") {
      const create = f.native.client.createOrUpdateBank;
      f.native.client.createOrUpdateBank = async (id, context) => { await create(id, context); throw new Error("HINDSIGHT_TIMEOUT"); };
    } else f.native.hooks.before = (call) => { if (call.method === "apply") throw new Error("HINDSIGHT_TIMEOUT"); };
    const original = h.owner.submit({ kind: "bank.provision", characterId }); await h.owner.stop();
    const failed = h.owner.status(original.operationId);
    expect(failed.state).toBe("failed");
    const reservation = f.db.prepare("SELECT * FROM hindsight_template_bank_reservations WHERE operation_id=:id").get({ id: original.operationId })!;
    expect(reservation).toBeDefined();
    const plans = f.db.prepare("SELECT * FROM hindsight_template_plans WHERE operation_id=:id").all({ id: original.operationId });
    expect(plans).toHaveLength(mode === "unpublished-plan" ? 1 : 0);
    f.base.secrets.state.value = null; f.base.remote.control.offline = true;
    const calls = counters(f);
    const emergency = h.owner.submit(await h.request()); await h.owner.stop();
    expect(h.owner.status(emergency.operationId).state).toBe("completed");
    expect(h.owner.status(original.operationId)).toEqual(failed);
    expect(f.db.prepare("SELECT * FROM hindsight_template_bank_reservations WHERE operation_id=:id").get({ id: original.operationId })).toEqual(reservation);
    expect(f.db.prepare("SELECT operation_id FROM memory_transition_emergency_quarantine WHERE operation_id=:id").get({ id: original.operationId }))
      .toEqual({ operation_id: original.operationId });
    const transitionId = emergency.producer?.kind === "transition" ? emergency.producer.transitionId : "";
    expect(readEmergencyIncident(f.db, transitionId)!.transition!.unknownEffects).toContainEqual({
      table: "hindsight_template_bank_reservations", epochId: "epoch", recordKey: JSON.stringify([reservation.reservation_id]),
      rowHash: emergencyRowHash(reservation), disposition: "held-unknown" });
    if (plans.length) expect(readTemplateHold(f.db, String(plans[0]!.plan_id))?.state).toBe("quarantined");
    expect(counters(f)).toEqual(calls);
  }, 30_000);
});

/** Independent synthetic surviving closure is installed through the actual replica repository before the hold.
 * Emergency still produces, copies, seals, validates and publishes its own evidence through the real driver. */
function seedSurvivingBank(f: TemplateLifecycleFixture, bank: ReturnType<typeof curatorTestBank>) {
  const repo = createHindsightApplicationReplicaRepo({ db: f.db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
    bankScope: () => bank.bankScope, now: () => f.state.now });
  const bundle = applicationTestSnapshot({ scope: bank.scope, native: bank.native, artifacts: bank.artifacts,
    checkpoint: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } });
  const lease = repo.leases.acquire({ bankId: bank.scope.bankId, ownerId: "surviving-bank-fixture", durationMs: 60_000 });
  try {
    repo.seedVerifiedSnapshot({ ...bank.scope, authorityEpochId: "epoch", bundle, nativeBaseline: applicationTestNativeBaseline(bundle),
      expectedBank: { bankId: bank.scope.bankId, scope: "character", characterId: bank.bankScope.characterId },
      expectedCheckpoint: null, expectedNativeCheckpoint: null, lease, deadlineAt: new Date(Date.now() + 60_000).toISOString() });
  } finally { repo.leases.release(lease); }
}
