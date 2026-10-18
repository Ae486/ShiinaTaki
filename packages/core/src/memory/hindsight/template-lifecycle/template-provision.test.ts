import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../../../db/hindsight-application-replica-repo.ts";
import { openDatabase } from "../../../db/sqlite.ts";
import { MIGRATIONS } from "../../../db/migrations/index-list.ts";
import { createHindsightLifecycleService } from "../../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import { createMemoryOperationService } from "../../operations/memory-operation-service.ts";
import { fakeSetup } from "../../operations/memory-operation-fixtures.ts";
import { applicationTestSnapshot, applicationTestNativeBaseline } from "../../../testing/hindsight-application-fixtures.ts";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";
import { curatorTestBank } from "../hindsight-policy-curator-fixtures.ts";
import { createIntlSegmenterTokenizer } from "../../search-tokenizer.ts";
import { templateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { createHindsightTemplateLifecycleService } from "./template-lifecycle-service.ts";
import { readTemplateHold, readTemplatePlan, readTemplatePublication } from "./template-execution-reads.ts";
import { templateHash } from "./template-integrity.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { readTemplateEmergencyEffects } from "../../../db/hindsight-template-emergency-evidence.ts";
import { HindsightTemplateRefusal } from "../hindsight-template-client.ts";
import { withoutApplicationHash } from "../hindsight-application-integrity.ts";
import { signFixtureSnapshot } from "./template-test-fixtures.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(characterRevision?: "none") {
  const f = templateLifecycleFixture(); cleanup.push(f.close);
  const params = f.params();
  if (params.target.kind !== "defaults") throw new Error("expected defaults");
  if (characterRevision) params.target.characterTemplateRevision = characterRevision;
  const applied = f.owner.submit(await f.request(params)); await f.owner.stop();
  expect(f.owner.status(applied.operationId).state).toBe("completed");
  const characterId = "new-character";
  const binding = hindsightBankBindings(characterId)[1];
  const bank = curatorTestBank({ bankId: binding.externalBankId, characterId, memories: [] });
  f.base.banks.push(bank);
  const installSync = () => {
    const prior = f.deps.runtime.synchronize;
    f.deps.runtime.synchronize = async (input) => {
      if (input.bank.identity.target.bank_id !== binding.externalBankId) return prior(input);
      input.assertCurrent();
      const receipt = f.native.receipts.get(input.bank.preview.request.request_id)!;
      const repo = createHindsightApplicationReplicaRepo({ db: f.db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
        bankScope: () => bank.bankScope, now: () => f.state.now });
      const bundle = applicationTestSnapshot({ scope: bank.scope, native: bank.native, artifacts: bank.artifacts,
        checkpoint: { native_cursor: Math.max(2, receipt.journal_after), state_cursor: 0 } });
      const lease = repo.leases.acquire({ bankId: binding.externalBankId, ownerId: "provision-fixture", durationMs: 60_000 });
      try {
        const checkpoint = repo.checkpoint(binding.externalBankId) ?? null;
        const value = { ...bank.scope, authorityEpochId: "epoch", expectedBank: { bankId: binding.externalBankId, scope: "character" as const, characterId },
          lease, deadlineAt: new Date(Date.parse(f.state.now) + 60_000).toISOString(), bundle, nativeBaseline: applicationTestNativeBaseline(bundle),
          expectedCheckpoint: checkpoint, expectedNativeCheckpoint: repo.nativeCheckpoint(binding.externalBankId) ?? null };
        if (checkpoint) repo.reconcileVerifiedSnapshot(value); else repo.seedVerifiedSnapshot(value);
      } finally { repo.leases.release(lease); }
      input.assertCurrent();
    };
  };
  installSync();
  const lifecycleFactory = () => createHindsightLifecycleService({ ...f.deps, templates: f.service, runtime: () => f.live,
    binding: () => ({ selection: "hindsight", selectedEpochId: "epoch", binding: { kind: "published", epochId: "epoch" }, lifetime: "running", flush: "available" }),
    replaceBinding: f.deps.runtime.replaceBinding, logger: f.base.logger, wait: async () => undefined });
  let lifecycle = lifecycleFactory();
  const ownerFactory = () => createMemoryOperationService({ db: f.db, live: () => f.live, templates: f.service, lifecycle,
    setup: fakeSetup(), logger: f.base.logger, bootId: f.state.bootId, now: () => f.state.now, onChanged: () => undefined });
  let owner = ownerFactory();
  cleanup.push(async () => { await lifecycle.stop(); await owner.stop(); });
  return { f, bank, binding, characterId, get owner() { return owner; },
    provision: async () => { const operation = owner.submit({ kind: "bank.provision", characterId }); await owner.stop(); return owner.status(operation.operationId); },
    reopen: async () => { await lifecycle.stop(); await owner.stop(); await f.reopen(); installSync(); lifecycle = lifecycleFactory(); owner = ownerFactory(); },
  };
}

function planId(operation: MemoryOperation): string {
  if (operation.producer?.kind !== "bank" || !operation.producer.templateProvision) throw new Error("expected managed bank producer");
  return operation.producer.templateProvision.planId;
}

describe("managed Character provisioning", () => {
  it("keeps a published but unbound Bank operation unknown at actual persisted-copy boot", async () => {
    const h = await fixture(); const { f, characterId } = h;
    let entered!: () => void; let release!: () => void;
    const bindingEntered = new Promise<void>((resolve) => { entered = resolve; });
    const bindingReleased = new Promise<void>((resolve) => { release = resolve; });
    f.state.beforeBinding = async () => { entered(); await bindingReleased; };
    f.state.failBinding = true;
    const original = h.owner.submit({ kind: "bank.provision", characterId });
    await bindingEntered;
    expect(readTemplatePublication(f.db, planId(original))).not.toBeNull();
    const calls = structuredClone(f.native.calls);
    const copyPath = join(f.base.dataDir, "template-unbound-boot.sqlite");
    await f.db.backupTo(copyPath);
    const db = openDatabase({ path: copyPath, migrations: MIGRATIONS });
    const deps = { ...f.deps, db, bootId: "after-unbound-publication", runtime: { ...f.deps.runtime, boundSelectionIdentity: () => null } };
    const templates = createHindsightTemplateLifecycleService(deps);
    const lifecycle = createHindsightLifecycleService({ ...deps, templates, runtime: () => f.live,
      binding: () => ({ selection: "hindsight", selectedEpochId: "epoch", binding: { kind: "published", epochId: "epoch" },
        lifetime: "running", flush: "available" }), replaceBinding: deps.runtime.replaceBinding, logger: f.base.logger, wait: async () => undefined });
    try {
      const boot = createMemoryOperationService({ ...deps, live: () => f.live, templates, lifecycle,
        setup: fakeSetup(), logger: f.base.logger, onChanged: () => undefined });
      expect(boot.status(original.operationId)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete" });
      expect(templates.provisionBound(original.producer as Extract<NonNullable<MemoryOperation["producer"]>, { kind: "bank" }>)).toBe(false);
      expect(f.native.calls).toEqual(calls);
      await boot.stop();
    } finally {
      templates.stop(); await lifecycle.stop(); db.close(); release(); await h.owner.stop();
    }
  });

  it.each([undefined, "none"] as const)("inherits the admitted Character scope default %s with an exact initialization receipt", async (revision) => {
    const { f, binding, provision } = await fixture(revision);
    const operation = await provision();
    expect(operation).toMatchObject({ state: "completed", result: { readiness: "ready" } });
    const plan = readTemplatePlan(f.db, planId(operation));
    expect(plan.guard.provisionBankId).toBe(binding.externalBankId);
    const [planned] = plan.banks;
    expect(planned!.preview.templateRevision).toBe(revision ?? "taki-bank-v2");
    expect(planned!.preview.request.initialization).toEqual({ template_revision: revision ?? "taki-bank-v2",
      template_hash: planned!.preview.effectiveDefinitionHash });
    const selected = readAppliedTemplateSelection(f.db, planned!.identity)!;
    expect(selected.receipt.initialization_proof_hash).not.toBeNull();
    expect(selected.ownership.models).toEqual(revision === "none" ? [] : planned!.preview.request.changes.models.map((entry) => entry.kind === "upsert" ? entry.definition.id : entry.id).sort());
    expect(readTemplateDefaults(f.db, plan.guard.providerLineage)?.revision).toBe(1);
    expect(createHindsightBankSetupRepo(f.db).get(binding.canonicalIdentity)?.status).toBe("verified");
    const calls = f.native.calls.filter((call) => call.bankId === binding.externalBankId).map((call) => call.method);
    expect(calls.slice(0, 4)).toEqual(["stats", "create", "stats", "snapshot"]);
    expect(f.service.provisionBound(operation.producer as Extract<NonNullable<MemoryOperation["producer"]>, { kind: "bank" }>)).toBe(true);
    await f.reopen();
    expect(readAppliedTemplateSelection(f.db, planned!.identity)).toEqual(selected);
  });

  it("reprobes after a lost create reply and physical restart, preserving the original reservation", async () => {
    const h = await fixture(); const { f, binding } = h;
    const create = f.native.client.createOrUpdateBank; let lose = true;
    f.native.client.createOrUpdateBank = async (id, context) => {
      const result = await create(id, context);
      if (lose) { lose = false; throw new Error("HINDSIGHT_TIMEOUT"); }
      return result;
    };
    const first = await h.provision();
    expect(first.state).toBe("failed");
    const reservation = f.db.prepare("SELECT * FROM hindsight_template_bank_reservations").all();
    expect(reservation).toHaveLength(1);
    expect(reservation[0]?.operation_id).toBe(first.operationId);
    expect(readTemplateEmergencyEffects(f.db, "epoch").some((entry) => entry.table === "hindsight_template_bank_reservations")).toBe(true);
    expect(f.db.prepare("SELECT * FROM hindsight_template_plans WHERE operation_id=:id").get({ id: first.operationId })).toBeUndefined();
    await h.reopen();
    const next = await h.provision();
    expect(next.state).toBe("completed");
    expect(f.db.prepare("SELECT * FROM hindsight_template_bank_reservations").all()).toEqual(reservation);
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && call.method === "stats")).toHaveLength(3);
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && call.method === "apply")).toHaveLength(1);
  });

  it("refuses content arriving after reservation and before the post-create occupancy probe", async () => {
    const h = await fixture(); const { f, binding } = h;
    const create = f.native.client.createOrUpdateBank;
    f.native.client.createOrUpdateBank = async (id, context) => { const reply = await create(id, context); f.native.occupied.add(id); return reply; };
    const operation = await h.provision();
    expect(operation).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_BANK_OCCUPIED" });
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && ["snapshot", "apply"].includes(call.method))).toEqual([]);
    expect(createHindsightBankSetupRepo(f.db).get(binding.canonicalIdentity)?.status).toBe("pending");
  });

  it("refuses a reused reservation if the Bank was written externally while Core was offline", async () => {
    const h = await fixture(); const { f, binding } = h;
    const create = f.native.client.createOrUpdateBank;
    f.native.client.createOrUpdateBank = async (id, context) => { await create(id, context); throw new Error("HINDSIGHT_TIMEOUT"); };
    await h.provision(); await h.reopen();
    f.native.occupied.add(binding.externalBankId); f.native.client.createOrUpdateBank = create;
    const creates = f.native.calls.filter((call) => call.method === "create").length;
    expect(await h.provision()).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_BANK_OCCUPIED" });
    expect(f.native.calls.filter((call) => call.method === "create")).toHaveLength(creates);
  });

  it("does not adopt a pristine-looking same-ID Bank with an existing managed-field override", async () => {
    const h = await fixture(); const { f, binding } = h;
    const snapshot = f.native.client.templateSnapshot!;
    f.native.client.templateSnapshot = async (input) => {
      const value = await snapshot(input);
      if (input.request.target.bank_id !== binding.externalBankId) return value;
      return signFixtureSnapshot({ ...value, config: value.config.map((entry) => entry.key === "retain_mission"
        ? { ...entry, stored: { kind: "value", value: "external owner choice" } } : entry) });
    };
    const operation = await h.provision();
    expect(operation.state).toBe("failed");
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && call.method === "apply")).toEqual([]);
    expect(readTemplatePublication(f.db, planId(operation))).toBeNull();
  });

  it("retains the original initialized request and hold when Native rejects a late ever-used race", async () => {
    const h = await fixture(); const { f, binding } = h;
    f.native.hooks.before = (call) => { if (call.method === "apply" && call.bankId === binding.externalBankId) throw new HindsightTemplateRefusal("initialization_refused"); };
    const operation = await h.provision();
    const plan = readTemplatePlan(f.db, planId(operation));
    expect(operation.state).toBe("failed");
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(plan.banks[0]!.preview.request.initialization).not.toBeNull();
    expect(f.service.status().recoverPlanId).toBe(plan.planId);
    const recovery = f.owner.submit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }); await f.owner.stop();
    expect(f.owner.status(recovery.operationId).state).toBe("outcome_unknown");
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && call.method === "apply").map((call) => call.request))
      .toEqual([plan.banks[0]!.preview.request, plan.banks[0]!.preview.request]);
  });

  it("refuses a rehashed receipt missing the required pristine initialization proof", async () => {
    const h = await fixture(); const { f, binding } = h;
    f.native.hooks.receipt = (value) => {
      if (value.target.bank_id !== binding.externalBankId) return value;
      const changed = { ...value, initialization_proof_hash: null };
      return { ...changed, receipt_hash: templateHash("receipt", withoutApplicationHash(changed, "receipt_hash")) };
    };
    const operation = await h.provision();
    expect(operation.state).toBe("failed");
    expect(readTemplateHold(f.db, planId(operation))?.state).toBe("active");
    expect(readTemplatePublication(f.db, planId(operation))).toBeNull();
  });

  it("rejects a create response for another Bank before requesting its generation or snapshot", async () => {
    const h = await fixture(); const { f, binding } = h;
    f.native.client.createOrUpdateBank = async () => ({ bankId: "foreign-bank", name: null });
    expect(await h.provision()).toMatchObject({ state: "failed", errorCode: "MEMORY_TEMPLATE_IDENTITY_CHANGED" });
    expect(f.native.calls.filter((call) => call.bankId === binding.externalBankId && call.method === "snapshot")).toEqual([]);
  });
});
