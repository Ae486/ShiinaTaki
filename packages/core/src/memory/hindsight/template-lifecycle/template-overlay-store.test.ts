import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../../db/sqlite.ts";
import { MIGRATIONS } from "../../../db/migrations/index-list.ts";
import { rmTempDir } from "../../../testing/rm-temp.ts";
import { createTemplateOverlayStore } from "./template-overlay-store.ts";
import { publishTemplateDefaults, readTemplateDefaults } from "./template-default-store.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { templateDocument, templateIdentityKey } from "./template-store-documents.ts";
import { templateFixture, fixtureCommit, FIXTURE_AT } from "./template-test-fixtures.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";

function prepare(db: Database) {
  const f = templateFixture(); const store = createTemplateOverlayStore(db);
  store.appendEnrollment({ enrollment: f.enrollment, expectedRevision: 0 });
  store.appendUser({ identity: f.identity, user: f.user, expectedRevision: null });
  store.storeCatalog(f.template);
  const publish = { identity: f.identity, preview: f.preview, ...fixtureCommit(f.preview),
    expectedSelectionRevision: 0, committedAt: FIXTURE_AT, assertCurrent: () => {} };
  return { ...f, store, publish };
}

describe("receipt-backed immutable overlay storage", () => {
  it("selects exact Native evidence with CAS and keeps independent desired user revisions", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); expect(f.store.selected(f.identity)).toBeNull();
      const selected = f.store.publish(f.publish);
      expect(selected.ownership).toEqual({ models: [f.template.models[0]!.id], directives: [f.snapshot.directives[0]!.id] });
      expect(() => f.store.publish(f.publish)).toThrow("STATE_CONFLICT");
      f.store.appendUser({ identity: f.identity, user: { ...f.user, revision: 1,
        config: [{ key: "retain_mission", choice: { mode: "value", value: "explicit desired" } }] }, expectedRevision: 0 });
      expect(f.store.user(f.identity)?.revision).toBe(1);
      expect(f.store.selected(f.identity)?.userRevision).toBe(0);
      expect(() => f.store.appendUser({ identity: f.identity, user: { ...f.user, revision: 2 }, expectedRevision: 0 })).toThrow("STATE_CONFLICT");
      expect(f.store.enrollment({ ...f.identity, target: { ...f.identity.target, bank_generation: randomUUID() } })).toBeNull();
      expect(f.store.selected(f.identity)).toEqual(selected);
    } finally { db.close(); }
  });

  it("keeps customized then removed selections and exact before-images across physical reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-template-store-")); const path = join(dir, "core.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS });
    try {
      const f = prepare(db); const first = f.store.publish(f.publish);
      const user = { ...f.user, revision: 1, labels: [{ key: "custom", choice: { mode: "value" as const, value: { key: "custom", type: "text" as const } } }] };
      f.store.appendUser({ identity: f.identity, user, expectedRevision: 0 });
      const removed = previewTemplateOverlay({ ...f.input, snapshot: first.snapshot, previous: first, user, template: null, requestId: randomUUID() });
      const selected = f.store.publish({ ...f.publish, preview: removed, ...fixtureCommit(removed), expectedSelectionRevision: 1 });
      expect(selected.templateRevision).toBe("none"); expect(selected.ownership).toEqual({ models: [], directives: [] });
      const rows = db.prepare("SELECT * FROM hindsight_template_selections ORDER BY revision").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS }); const store = createTemplateOverlayStore(db);
      expect(store.selected(f.identity)).toEqual(selected); expect(store.enrollment(f.identity)).toEqual(f.enrollment);
      expect(db.prepare("SELECT * FROM hindsight_template_selections ORDER BY revision").all()).toEqual(rows);
      expect(selected.projection.config.find((item) => item.key === "entity_labels")?.stored)
        .toEqual({ kind: "value", value: [{ key: "parent-group", type: "text" }, { key: "custom", type: "text" }] });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); rmTempDir(dir); }
  });

  it.each(["receipt", "readback", "request", "final-guard", "async-guard"])("rolls back selection/history on %s failure", (kind) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); const input = structuredClone({ ...f.publish, assertCurrent: undefined });
      if (kind === "receipt") input.receipt.receipt_hash = "a".repeat(64);
      if (kind === "readback") input.snapshot.snapshot_hash = "a".repeat(64);
      if (kind === "request") input.preview.request.request_hash = "a".repeat(64);
      const assertCurrent = kind === "final-guard" ? () => { throw new Error("fixture lease expired"); }
        : kind === "async-guard" ? async () => {} : () => {};
      expect(() => f.store.publish({ ...input, assertCurrent })).toThrow();
      expect(f.store.selected(f.identity)).toBeNull();
      expect(db.prepare("SELECT * FROM hindsight_template_selections").all()).toEqual([]);
      expect(f.store.publish(f.publish).revision).toBe(1);
    } finally { db.close(); }
  });

  it("rejects mutation/replace of every original evidence row and rejects rehashed forged creation ownership", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); const selected = f.store.publish(f.publish);
      for (const table of ["hindsight_template_enrollments", "hindsight_template_bases", "hindsight_template_users",
        "hindsight_template_catalog", "hindsight_template_selections"]) {
        expect(() => db.exec(`DELETE FROM ${table}`)).toThrow("immutable");
        expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow("immutable");
      }
      expect(() => db.exec("UPDATE hindsight_template_applied SET revision=1")).toThrow("CAS");
      db.exec("DROP TRIGGER hindsight_template_selections_immutable_update");
      const changed = { ...selected, ownership: { models: ["forged"], directives: [] } }; const document = templateDocument(changed);
      db.prepare("UPDATE hindsight_template_selections SET document_hash=:hash,document_json=:json").run(document);
      expect(() => f.store.selected(f.identity)).toThrow("RESPONSE_INVALID");
    } finally { db.close(); }
  });

  it("refuses an changed catalog revision and keeps captured bases append-only", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); f.store.storeCatalog(f.template);
      expect(() => f.store.storeCatalog({ ...f.template, config: { ...f.template.config, retain_mission: "changed" } })).toThrow("STATE_CONFLICT");
      expect(() => f.store.appendEnrollment({ enrollment: f.enrollment, expectedRevision: 0 })).toThrow("STATE_CONFLICT");
      const key = templateIdentityKey(f.identity);
      expect(db.prepare("SELECT count(*) AS count FROM hindsight_template_bases WHERE identity_key=:key").get({ key })?.count).toBe(1);
    } finally { db.close(); }
  });

  it("rolls back nested publication with the existing outer Core transaction", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db);
      expect(() => db.transaction(() => { f.store.publish(f.publish); throw new Error("later Bank publication failed"); })).toThrow();
      expect(f.store.selected(f.identity)).toBeNull();
      expect(f.store.publish(f.publish).revision).toBe(1);
    } finally { db.close(); }
  });

  it("rolls back selected/default history together when a deferred constraint rejects the outer COMMIT", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); f.store.storeCatalog(loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "character"));
      db.exec(`CREATE TABLE owned_publication_parent(id TEXT PRIMARY KEY);
        CREATE TABLE owned_publication_child(id TEXT REFERENCES owned_publication_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER reject_publication_commit AFTER INSERT ON hindsight_template_default_history
        BEGIN INSERT INTO owned_publication_child VALUES('missing'); END`);
      let guards = 0;
      const publish = () => db.transaction(() => {
        const selected = f.store.publish({ ...f.publish, assertCurrent: () => { guards++; } });
        publishTemplateDefaults(db, { expectedRevision: 0, assertCurrent: () => { guards++; }, value: {
          providerLineage: f.identity.target.provider_lineage, revision: 1,
          globalTemplateRevision: f.template.revision, characterTemplateRevision: f.template.revision,
          banks: [{ identity: f.identity, selectionRevision: selected.revision, receiptHash: selected.receipt.receipt_hash }],
        } });
      });
      expect(publish).toThrow("FOREIGN KEY constraint failed");
      expect(guards).toBe(2);
      expect(f.store.selected(f.identity)).toBeNull();
      expect(readTemplateDefaults(db, f.identity.target.provider_lineage)).toBeNull();
      for (const table of ["hindsight_template_selections", "hindsight_template_applied",
        "hindsight_template_default_history", "hindsight_template_defaults", "owned_publication_child"]) {
        expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      }
      expect(f.store.enrollment(f.identity)).toEqual(f.enrollment);
      expect(f.store.user(f.identity)).toEqual(f.user);
      db.exec("DROP TRIGGER reject_publication_commit");
      expect(publish).not.toThrow();
      expect(f.store.selected(f.identity)?.revision).toBe(1);
      expect(readTemplateDefaults(db, f.identity.target.provider_lineage)?.revision).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("refuses publishing an old desired user revision even when applied-selection CAS still matches", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); const user = { ...f.user, revision: 1,
        config: [{ key: "retain_mission" as const, choice: { mode: "value" as const, value: "new explicit user choice" } }] };
      f.store.appendUser({ identity: f.identity, user, expectedRevision: 0 });
      expect(() => f.store.publish(f.publish)).toThrow("STATE_CONFLICT");
      expect(f.store.selected(f.identity)).toBeNull();
      const preview = previewTemplateOverlay({ ...f.input, user, requestId: randomUUID() });
      expect(f.store.publish({ ...f.publish, preview, ...fixtureCommit(preview) }).userRevision).toBe(1);
    } finally { db.close(); }
  });

  it("publishes lineage-wide defaults only against exact selected references and final current guard", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = prepare(db); const selected = f.store.publish(f.publish);
      f.store.storeCatalog(loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "character"));
      const value = { providerLineage: f.identity.target.provider_lineage, revision: 1,
        globalTemplateRevision: f.template.revision, characterTemplateRevision: f.template.revision,
        banks: [{ identity: f.identity, selectionRevision: 1, receiptHash: selected.receipt.receipt_hash }] };
      const input = { value, expectedRevision: 0, assertCurrent: () => {} };
      expect(() => publishTemplateDefaults(db, { ...input, value: { ...value, banks: [{ ...value.banks[0]!, receiptHash: "a".repeat(64) }] } })).toThrow();
      expect(() => publishTemplateDefaults(db, { ...input, assertCurrent: () => { throw new Error("inventory moved"); } })).toThrow();
      expect(readTemplateDefaults(db, value.providerLineage)).toBeNull();
      publishTemplateDefaults(db, input); expect(readTemplateDefaults(db, value.providerLineage)).toEqual(value);
      expect(() => publishTemplateDefaults(db, input)).toThrow("STATE_CONFLICT");
      expect(f.store.user(f.identity)?.revision).toBe(0);
    } finally { db.close(); }
  });
});
