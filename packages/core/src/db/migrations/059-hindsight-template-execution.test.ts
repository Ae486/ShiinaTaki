import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { createConfigRepo } from "../config-repo.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightTemplateExecutionMigration059 } from "./059-hindsight-template-execution.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { templateFixture, fixtureCommit } from "../../memory/hindsight/template-lifecycle/template-test-fixtures.ts";
import { createTemplateOverlayStore } from "../../memory/hindsight/template-lifecycle/template-overlay-store.ts";
import { appendTemplateEnrollment, appendTemplateUser, storeTemplateCatalogEntry } from "../../memory/hindsight/template-lifecycle/template-overlay-history.ts";

const EXECUTION_TABLES = ["hindsight_template_plans", "hindsight_template_admissions", "hindsight_template_executors",
  "hindsight_template_dispatches", "hindsight_template_bank_receipts", "hindsight_template_observations",
  "hindsight_template_holds", "hindsight_template_publications", "hindsight_template_bank_reservations"];

describe("059 durable template execution lineage", () => {
  it("creates an empty fresh execution schema without inferring legacy effects", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 59) });
    try {
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(59);
      for (const table of EXECUTION_TABLES) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(db.prepare("SELECT revision FROM hindsight_template_config_clock").get()?.revision).toBe(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("physically upgrades and reopens populated 058 ownership without changing any original receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-059-")); const path = join(dir, "core.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((item) => item.version <= 58) });
    try {
      const f = templateFixture(); const committed = fixtureCommit(f.preview);
      appendTemplateEnrollment(db, { enrollment: f.enrollment, expectedRevision: 0 });
      appendTemplateUser(db, { identity: f.identity, user: f.user, expectedRevision: null });
      storeTemplateCatalogEntry(db, f.template);
      createTemplateOverlayStore(db).publish({ identity: f.identity, expectedSelectionRevision: 0, preview: f.preview,
        ...committed, committedAt: "2026-10-08T00:00:00.000Z", assertCurrent: () => undefined });
      const before = createTemplateOverlayStore(db).selected(f.identity);
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(createTemplateOverlayStore(db).selected(f.identity)).toEqual(before);
      expect(db.prepare("SELECT * FROM migrations WHERE version<=58 ORDER BY version").all()).toEqual(receipts);
      for (const table of EXECUTION_TABLES) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      const schema = db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(createTemplateOverlayStore(db).selected(f.identity)).toEqual(before);
      expect(db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all()).toEqual(schema);
      expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); rmTempDir(dir); }
  });

  it.each(["sql", "receipt", "commit"])("rolls back %s failure and leaves the whole 058 database usable", (failure) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 58) });
    try {
      const history = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      const schema = db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all();
      if (failure === "receipt") db.exec("CREATE TRIGGER fail_059 BEFORE INSERT ON migrations WHEN NEW.version=59 BEGIN SELECT RAISE(ABORT,'owned failure'); END");
      if (failure === "commit") db.exec(`CREATE TABLE owned_parent(id TEXT PRIMARY KEY);
        CREATE TABLE owned_child(id TEXT REFERENCES owned_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_059 AFTER INSERT ON migrations WHEN NEW.version=59 BEGIN INSERT INTO owned_child VALUES('missing'); END`);
      const migration = failure === "sql" ? { ...hindsightTemplateExecutionMigration059,
        sql: hindsightTemplateExecutionMigration059.sql + "INSERT INTO owned_absent VALUES(1);" } : hindsightTemplateExecutionMigration059;
      expect(() => runMigrations(db, [migration])).toThrow();
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(history);
      expect(db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all()).toEqual(schema);
      db.exec("CREATE TABLE after_failure_usable(id TEXT)");
    } finally { db.close(); }
  });

  it("detects same-value and A-B-A Hindsight configuration writes without tracking unrelated settings", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const config = createConfigRepo(db);
      const clock = () => db.prepare("SELECT revision FROM hindsight_template_config_clock").get()?.revision;
      config.upsert("unrelated_fixture_setting", true); expect(clock()).toBe(0);
      config.upsert("TAKI_HINDSIGHT_ENABLED", true); expect(clock()).toBe(1);
      config.upsert("TAKI_HINDSIGHT_ENABLED", true); expect(clock()).toBe(2);
      config.upsert("TAKI_HINDSIGHT_ENABLED", false); expect(clock()).toBe(3);
      config.upsert("TAKI_HINDSIGHT_ENABLED", true); expect(clock()).toBe(4);
      db.prepare("DELETE FROM config WHERE key=:key").run({ key: "TAKI_HINDSIGHT_ENABLED" });
      expect(clock()).toBe(5);
      expect(() => db.transaction(() => {
        config.upsert("TAKI_HINDSIGHT_ENABLED", true); throw new Error("fixture rollback");
      })).toThrow("fixture rollback");
      expect(clock()).toBe(5);
    } finally { db.close(); }
  });
});
