import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { TakiApplicationNamespace } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { MIGRATIONS } from "../../../db/migrations/index-list.ts";
import { openDatabase } from "../../../db/sqlite.ts";
import { hindsightRuntimeFixture } from "../../../testing/hindsight-runtime-composition-fixtures.ts";
import { createTemplateOverlayStore } from "./template-overlay-store.ts";
import { templateProjectionDigest } from "./template-projection.ts";
import { readRuntimeTemplateSelection, readSelectedTemplateLabelGroup, readTemplateSelectionIdentity } from "./template-runtime-selection.ts";
import { FIXTURE_AT, fixtureCommit, templateFixture } from "./template-test-fixtures.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

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
