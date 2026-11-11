import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TakiApplicationNamespace } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { MIGRATIONS } from "../../../db/migrations/index-list.ts";
import { openDatabase } from "../../../db/sqlite.ts";
import { applicationCheckpointHash, readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { hindsightRuntimeFixture } from "../../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHindsightRuntimeConnection } from "../hindsight-runtime-connection.ts";
import { applicationCommandTestInput } from "../../../db/hindsight-application-command-fixtures.ts";
import { curatorTestBank } from "../hindsight-policy-curator-fixtures.ts";
import { createTemplateOverlayStore } from "./template-overlay-store.ts";
import { publishTemplateDefaults, readTemplateDefaults } from "./template-default-store.ts";
import { templateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { templateProjectionDigest } from "./template-projection.ts";
import { readCurrentRuntimeTemplateIdentity, readRuntimeTemplateSelection, readSelectedTemplateLabelGroup, readTemplateSelectionIdentity } from "./template-runtime-selection.ts";
import { FIXTURE_AT, fixtureCommit, templateFixture } from "./template-test-fixtures.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

function managedFixture(publish = true) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); cleanup.push(() => db.close());
  const f = templateFixture("character"); const store = createTemplateOverlayStore(db);
  store.appendEnrollment({ enrollment: f.enrollment, expectedRevision: 0 });
  store.appendUser({ identity: f.identity, user: f.user, expectedRevision: null });
  store.storeCatalog(f.template);
  const selected = publish ? store.publish({ identity: f.identity, preview: f.preview, ...fixtureCommit(f.preview),
    expectedSelectionRevision: 0, committedAt: FIXTURE_AT, assertCurrent: () => undefined }) : null;
  createHindsightBankSetupRepo(db).upsert({ scope: f.identity.scope, canonicalIdentity: f.identity.canonicalIdentity,
    externalBankId: f.identity.target.bank_id, templateRevision: selected?.templateRevision ?? "taki-bank-v1",
    templateDigest: selected ? templateProjectionDigest(selected.projection) : "b".repeat(64), status: "verified",
    operationIds: [], lastVerifiedAt: FIXTURE_AT, lastError: null });
  const namespace: TakiApplicationNamespace = { application_id: "taki", provider_lineage: f.identity.target.provider_lineage,
    bank_generation: f.identity.target.bank_generation };
  return { ...f, db, store, selected, address: { bankId: f.identity.target.bank_id, namespace } };
}

describe("runtime template enrollment boundary", () => {
  it("keeps real untracked v1 runtime Banks usable without canonical managed identities or new enrollment", async () => {
    const f = hindsightRuntimeFixture(); cleanup.push(f.close);
    expect(f.banks.map((bank) => bank.scope.bankId)).toEqual(["bank-a", "bank-taki"]);
    expect(readTemplateSelectionIdentity(f.db, "epoch")).toBeNull();
    for (const bank of f.banks) expect(readSelectedTemplateLabelGroup(f.db, bank.scope)).toBeNull();
    const runtime = f.compose();
    expect(runtime.operations()?.banks().map((bank) => bank.bankId).sort()).toEqual(["bank-a", "bank-taki"]);
    const run = await runtime.captureRun("taki");
    expect(run.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: "epoch" });
    expect(Object.keys(run.tools).sort()).toEqual(["invalidate_memory", "recall", "reflect", "restore_memory", "retain", "update_memory"]);
    expect(f.db.prepare("SELECT * FROM hindsight_template_enrollments").all()).toEqual([]);
  });

  it("returns only the receipt-verified selection and its selected label group for the complete managed identity", () => {
    const f = managedFixture();
    expect(readRuntimeTemplateSelection(f.db, f.address)).toEqual(f.selected);
    expect(readSelectedTemplateLabelGroup(f.db, f.address)).toEqual(f.template.labelGroup);
  });

  it.each(["provider_lineage", "bank_generation"] as const)("does not transfer ownership by Bank ID across %s", (key) => {
    const f = managedFixture(); const address = { ...f.address, namespace: { ...f.address.namespace, [key]: randomUUID() } };
    expect(readRuntimeTemplateSelection(f.db, address)).toBeNull();
    expect(readSelectedTemplateLabelGroup(f.db, address)).toBeNull();
    expect(readRuntimeTemplateSelection(f.db, f.address)).toEqual(f.selected);
  });

  it.each(["canonical_identity", "scope_kind", "template_revision", "template_digest", "missing_setup"] as const)(
    "refuses a managed Bank's changed %s instead of treating it as untracked", (field) => {
      const f = managedFixture();
      const changed = { canonical_identity: "character:different", scope_kind: "global", template_revision: "taki-bank-v1",
        template_digest: "f".repeat(64), missing_setup: "" }[field];
      if (field === "missing_setup") f.db.prepare("DELETE FROM hindsight_bank_setup WHERE external_bank_id=:bank").run({ bank: f.address.bankId });
      else f.db.prepare(`UPDATE hindsight_bank_setup SET ${field}=:value WHERE external_bank_id=:bank`).run({ value: changed, bank: f.address.bankId });
      expect(() => readRuntimeTemplateSelection(f.db, f.address)).toThrow();
      expect(() => readSelectedTemplateLabelGroup(f.db, f.address)).toThrow();
    });

  it("allows an enrolled but unapplied legacy Bank without inventing an applied selection", () => {
    const f = managedFixture(false);
    expect(readRuntimeTemplateSelection(f.db, f.address)).toBeNull();
    expect(readSelectedTemplateLabelGroup(f.db, f.address)).toBeNull();
  });

  it("refuses a missing enrollment before-image even before an applied selection exists", () => {
    const f = managedFixture(false);
    f.db.exec("DROP TRIGGER hindsight_template_bases_immutable_delete");
    f.db.exec("DELETE FROM hindsight_template_bases");
    expect(() => readRuntimeTemplateSelection(f.db, f.address)).toThrow("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  });

  it.each(["canonical_identity", "identity_json"] as const)("refuses mismatched stored %s on the same exact incarnation", (field) => {
    const f = managedFixture();
    f.db.exec("DROP TRIGGER hindsight_template_enrollments_immutable_update");
    const value = field === "canonical_identity" ? "character:different" : JSON.stringify({ ...f.identity, canonicalIdentity: "character:different" });
    f.db.prepare(`UPDATE hindsight_template_enrollments SET ${field}=:value WHERE bank_id=:bank`).run({ value, bank: f.address.bankId });
    expect(() => readRuntimeTemplateSelection(f.db, f.address)).toThrow();
  });
});

async function boundManagedFixture() {
  const f = templateLifecycleFixture(); cleanup.push(f.close);
  const operation = f.owner.submit(await f.request()); await f.owner.stop();
  expect(f.owner.status(operation.operationId).state).toBe("completed");
  const connect = () => createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.deps.config,
    secrets: f.deps.secrets, client: f.native.client });
  const runtime = connect(); cleanup.push(runtime.stop);
  runtime.assertConnection();
  return { ...f, runtime, connect, plan: f.plan(operation) };
}

// Failure modes: identity drift must invalidate the bound runtime; legal cursor/desired changes must not.
// Unconsumed body corruption moves to full validation, while setup's consumed projection keeps its digest check.
describe("current template identity without historical reconstruction", () => {
  it("matches full proof for two managed Banks and an independently advanced defaults revision", async () => {
    const f = await boundManagedFixture();
    expect(f.plan.banks).toHaveLength(2);
    const original = readTemplateSelectionIdentity(f.db, "epoch");
    expect(original).not.toBeNull();
    expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(original);
    const defaults = readTemplateDefaults(f.db, f.plan.guard.providerLineage)!;
    publishTemplateDefaults(f.db, { value: { ...defaults, revision: defaults.revision + 1 },
      expectedRevision: defaults.revision, assertCurrent: () => undefined });
    const next = readTemplateSelectionIdentity(f.db, "epoch");
    expect(next).not.toBe(original);
    expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(next);
    expect(() => f.runtime.assertConnection()).toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    const replacement = f.connect(); cleanup.push(replacement.stop);
    expect(replacement.templateSelectionIdentity).toBe(next);
    replacement.assertConnection();
  });

  it("preserves absent storage, untracked legacy and enrolled-but-unapplied null identities", () => {
    const old = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((migration) => migration.version < 58) });
    cleanup.push(() => old.close());
    const legacy = hindsightRuntimeFixture(); cleanup.push(legacy.close);
    const f = templateFixture("character");
    const unapplied = hindsightRuntimeFixture({ banks: [curatorTestBank({ bankId: f.identity.target.bank_id,
      characterId: f.identity.canonicalIdentity.slice("character:".length), namespace: { application_id: "taki",
        provider_lineage: f.identity.target.provider_lineage, bank_generation: f.identity.target.bank_generation } })] });
    cleanup.push(unapplied.close);
    createTemplateOverlayStore(unapplied.db).appendEnrollment({ enrollment: f.enrollment, expectedRevision: 0 });
    expect(readApplicationCheckpoint(unapplied.db, f.identity.target.bank_id)?.authorityEpochId).toBe("epoch");
    for (const db of [old, legacy.db, unapplied.db]) {
      expect(readTemplateSelectionIdentity(db, "epoch")).toBeNull();
      expect(readCurrentRuntimeTemplateIdentity(db, "epoch")).toBeNull();
    }
  });

  it("notices newly eligible managed membership without freezing the verified Bank inventory", async () => {
    const f = await boundManagedFixture();
    f.db.exec("UPDATE hindsight_bank_setup SET status='pending' WHERE scope_kind='character'");
    const onlyGlobal = f.connect(); cleanup.push(onlyGlobal.stop);
    expect(onlyGlobal.banks()).toHaveLength(1);
    f.db.exec("UPDATE hindsight_bank_setup SET status='verified' WHERE scope_kind='character'");
    expect(() => onlyGlobal.assertConnection()).toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(f.runtime.templateSelectionIdentity);
    f.runtime.assertConnection();
  });

  it.each([
    ["setup canonical identity", "", "UPDATE hindsight_bank_setup SET canonical_identity='character:changed' WHERE scope_kind='character'"],
    ["setup scope", "", "UPDATE hindsight_bank_setup SET scope_kind='global' WHERE scope_kind='character'"],
    ["setup template revision", "", "UPDATE hindsight_bank_setup SET template_revision='taki-bank-v1' WHERE scope_kind='character'"],
    ["setup digest", "", "UPDATE hindsight_bank_setup SET template_digest=printf('%064d',0) WHERE scope_kind='character'"],
    ["setup removal", "", "DELETE FROM hindsight_bank_setup WHERE scope_kind='character'"],
    ["enrollment canonical metadata", "hindsight_template_enrollments_immutable_update", "UPDATE hindsight_template_enrollments SET canonical_identity='character:changed' WHERE scope_kind='character'"],
    ["enrollment identity document", "hindsight_template_enrollments_immutable_update", "UPDATE hindsight_template_enrollments SET identity_json=json_set(identity_json,'$.canonicalIdentity','character:changed') WHERE scope_kind='character'"],
    ["enrollment removal", "hindsight_template_enrollments_immutable_delete", "DELETE FROM hindsight_template_enrollments WHERE scope_kind='character'"],
    ["missing enrollment before-image", "hindsight_template_bases_immutable_delete", "DELETE FROM hindsight_template_bases"],
    ["applied pointer removal", "hindsight_template_applied_no_delete", "DELETE FROM hindsight_template_applied"],
    ["applied pointer without selection", "", "UPDATE hindsight_template_applied SET revision=revision+1"],
    ["missing selected row", "hindsight_template_selections_immutable_delete", "DELETE FROM hindsight_template_selections"],
    ["missing selected user row", "hindsight_template_users_immutable_delete", "DELETE FROM hindsight_template_users"],
    ["receipt column", "hindsight_template_selections_immutable_update", "UPDATE hindsight_template_selections SET receipt_hash=printf('%064d',0)"],
    ["receipt current metadata", "hindsight_template_selections_immutable_update", "UPDATE hindsight_template_selections SET document_json=json_set(document_json,'$.receipt.receipt_hash',printf('%064d',0))"],
    ["defaults pointer removal", "hindsight_template_defaults_no_delete", "DELETE FROM hindsight_template_defaults"],
    ["defaults pointer without history", "", "UPDATE hindsight_template_defaults SET revision=revision+1"],
    ["missing defaults history", "hindsight_template_default_history_immutable_delete", "DELETE FROM hindsight_template_default_history"],
    ["defaults revision metadata", "hindsight_template_default_history_immutable_update", "UPDATE hindsight_template_default_history SET document_json=json_set(document_json,'$.revision',99)"],
    ["defaults lineage metadata", "hindsight_template_default_history_immutable_update", "UPDATE hindsight_template_default_history SET document_json=json_set(document_json,'$.providerLineage','99999999-9999-4999-8999-999999999999')"],
  ])("refuses out-of-band %s drift", async (_name, trigger, sql) => {
    const f = await boundManagedFixture();
    const { state } = f.base.subsystem();
    const command = applicationCommandTestInput({ scope: f.base.banks[0]!.scope }); command.key.authorityEpochId = "epoch";
    state.commands.prepare(command);
    const upload = vi.spyOn(f.base.remote.client, "uploadApplicationBody");
    const commit = vi.spyOn(f.base.remote.client, "commitApplication");
    // Emulate offline edits; normal writes cannot bypass immutable evidence/FK protections.
    f.db.exec("PRAGMA foreign_keys=OFF");
    if (trigger) f.db.exec(`DROP TRIGGER ${trigger}`);
    f.db.exec(sql);
    expect(() => f.runtime.assertConnection()).toThrow();
    expect(() => state.commands.prepare({ ...command, key: { ...command.key, requestId: "must-not-prepare" } })).toThrow();
    await expect(state.writer.run({ key: command.key, context: { timeoutMs: 10_000 } })).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM hindsight_application_command_jobs WHERE request_id=:id").all({ id: "must-not-prepare" })).toEqual([]);
    expect(() => {
      if (readTemplateSelectionIdentity(f.db, "epoch") !== f.runtime.templateSelectionIdentity) throw new Error("identity changed");
    }).toThrow();
  });

  it.each(["missing", "deleted", "wrong epoch", "wrong generation"] as const)("refuses a %s checkpoint", async (damage) => {
    const f = await boundManagedFixture(); const bank = f.plan.banks[0]!;
    const id = bank.identity.target.bank_id;
    if (damage === "missing") f.db.prepare("DELETE FROM hindsight_application_replica_checkpoints WHERE bank_id=:bank").run({ bank: id });
    else {
      const prior = readApplicationCheckpoint(f.db, id)!;
      const next = { ...prior, bankDeleted: damage === "deleted",
        authorityEpochId: damage === "wrong epoch" ? "other-epoch" : prior.authorityEpochId,
        namespace: { ...prior.namespace, bank_generation: damage === "wrong generation" ? randomUUID() : prior.namespace.bank_generation } };
      next.native = { ...prior.native, authorityEpochId: next.authorityEpochId, bankGeneration: next.namespace.bank_generation };
      f.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET bank_deleted=:deleted,authority_epoch_id=:epoch,
        bank_generation=:generation,checkpoint_json=:json,checkpoint_hash=:hash WHERE bank_id=:bank`).run({ bank: id,
        deleted: next.bankDeleted ? 1 : 0, epoch: next.authorityEpochId, generation: next.namespace.bank_generation,
        json: JSON.stringify(next), hash: applicationCheckpointHash(next) });
    }
    expect(() => f.runtime.assertConnection()).toThrow();
    if (damage !== "wrong generation") expect(() => readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    else expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).not.toBe(f.runtime.templateSelectionIdentity);
  });

  it("ignores mutable checkpoint cursors and unapplied user/catalog revisions", async () => {
    const f = await boundManagedFixture(); const bank = f.plan.banks[0]!;
    const store = createTemplateOverlayStore(f.db);
    const user = store.user(bank.identity)!;
    store.appendUser({ identity: bank.identity, user: { ...user, revision: user.revision + 1 }, expectedRevision: user.revision });
    store.storeCatalog({ ...bank.template!, revision: "unapplied-revision" });
    const id = bank.identity.target.bank_id; const prior = readApplicationCheckpoint(f.db, id)!;
    const next = { ...prior, checkpoint: { ...prior.checkpoint, state_cursor: prior.checkpoint.state_cursor + 1 } };
    f.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET state_cursor=:cursor,checkpoint_json=:json,
      checkpoint_hash=:hash WHERE bank_id=:bank`).run({ bank: id, cursor: next.checkpoint.state_cursor,
      json: JSON.stringify(next), hash: applicationCheckpointHash(next) });
    expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(f.runtime.templateSelectionIdentity);
    expect(readTemplateSelectionIdentity(f.db, "epoch")).toBe(f.runtime.templateSelectionIdentity);
    f.runtime.assertConnection();
  });

  it("defers unchanged-metadata document corruption to the unchanged full reader and fresh construction", async () => {
    const f = await boundManagedFixture();
    const before = f.db.prepare("SELECT template_revision,scope_kind,document_hash FROM hindsight_template_catalog").all();
    f.db.exec("DROP TRIGGER hindsight_template_catalog_immutable_update");
    f.db.exec("UPDATE hindsight_template_catalog SET document_json=json_set(document_json,'$.config.retain_mission','changed offline')");
    expect(f.db.prepare("SELECT template_revision,scope_kind,document_hash FROM hindsight_template_catalog").all()).toEqual(before);
    expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(f.runtime.templateSelectionIdentity);
    f.runtime.assertConnection();
    expect(() => readTemplateSelectionIdentity(f.db, "epoch")).toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(() => f.connect()).toThrow("HINDSIGHT_RESPONSE_INVALID");
    const bank = f.plan.banks[0]!;
    expect(() => readRuntimeTemplateSelection(f.db, { bankId: bank.identity.target.bank_id, namespace: bank.namespace })).toThrow();
  });

  it("still refuses corruption of the current projection consumed for the setup digest", async () => {
    const f = await boundManagedFixture();
    f.db.exec("DROP TRIGGER hindsight_template_selections_immutable_update");
    f.db.exec("UPDATE hindsight_template_selections SET document_json=json_set(document_json,'$.projection.config[0].stored',json('{\"kind\":\"absent\"}'))");
    expect(() => readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    expect(() => readTemplateSelectionIdentity(f.db, "epoch")).toThrow();
  });
});
