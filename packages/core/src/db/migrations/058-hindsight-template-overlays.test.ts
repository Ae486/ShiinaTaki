import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightTemplateOverlaysMigration058 } from "./058-hindsight-template-overlays.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

const TABLES = ["hindsight_template_enrollments", "hindsight_template_catalog", "hindsight_template_bases", "hindsight_template_users",
  "hindsight_template_selections", "hindsight_template_applied", "hindsight_template_default_history", "hindsight_template_defaults"];

describe("058 exact-incarnation template overlay lineage", () => {
  it("creates an empty fresh schema and keeps all evidence empty after reopen", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 58) });
    try {
      for (const table of TABLES) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(58);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("preserves populated legacy setup/057 receipts and never fabricates ownership on physical upgrade/reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-058-")); const path = join(dir, "core.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((item) => item.version <= 57) });
    try {
      db.prepare(`INSERT INTO hindsight_bank_setup VALUES
        ('global','global','legacy-bank','taki-bank-v1',:hash,'verified','[]','original-time',NULL,'original-time')`).run({ hash: "a".repeat(64) });
      const old = db.prepare("SELECT * FROM hindsight_bank_setup").all();
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all(); db.close();
      db = openDatabase({ path, migrations: MIGRATIONS });
      for (const table of TABLES) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(db.prepare("SELECT * FROM hindsight_bank_setup").all()).toEqual(old);
      expect(db.prepare("SELECT * FROM migrations WHERE version<=57 ORDER BY version").all()).toEqual(receipts);
      const schema = db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT * FROM sqlite_schema WHERE name LIKE 'hindsight_template_%' ORDER BY name").all()).toEqual(schema);
      expect(db.prepare("SELECT * FROM hindsight_bank_setup").all()).toEqual(old);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); rmTempDir(dir); }
  });

  it.each(["sql", "receipt", "commit"])("rolls back %s failure without modifying previous migration receipts", (failure) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 57) });
    try {
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      if (failure === "receipt") db.exec("CREATE TRIGGER fail_058 BEFORE INSERT ON migrations WHEN NEW.version=58 BEGIN SELECT RAISE(ABORT,'owned failure'); END");
      if (failure === "commit") db.exec(`CREATE TABLE owned_parent(id TEXT PRIMARY KEY);
        CREATE TABLE owned_child(id TEXT REFERENCES owned_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_058 AFTER INSERT ON migrations WHEN NEW.version=58 BEGIN INSERT INTO owned_child VALUES('missing'); END`);
      const migration = failure === "sql" ? { ...hindsightTemplateOverlaysMigration058,
        sql: hindsightTemplateOverlaysMigration058.sql + "INSERT INTO owned_absent VALUES(1);" } : hindsightTemplateOverlaysMigration058;
      expect(() => runMigrations(db, [migration])).toThrow();
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(receipts);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'hindsight_template_%'").all()).toEqual([]);
      db.exec("CREATE TABLE after_failure_usable(id TEXT)");
    } finally { db.close(); }
  });
});
