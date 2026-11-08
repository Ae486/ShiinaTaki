import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConfigRepo } from "../config-repo.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, openReadonlyDatabase } from "../sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { hindsightCandidatesMigration060 } from "./060-hindsight-candidates.ts";
import { MIGRATIONS } from "./index-list.ts";

const tables = ["records", "requests", "dispatches", "facts", "observations"];

describe("060 controlling-Core candidate lineage", () => {
  it("preserves a sealed 059 reader and upgrades only the writable controlling Core", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-060-"));
    const path = join(dir, "core.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((item) => item.version <= 59) });
    try {
      createConfigRepo(db).upsert("candidate_migration_fixture", JSON.stringify({ text: "retained source", values: [1, 2, 3] }));
      const config = db.prepare("SELECT * FROM config ORDER BY key").all();
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.close();
      const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
      const before = digest();
      const archived = openReadonlyDatabase(path);
      try {
        expect(archived.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(59);
        expect(archived.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'hindsight_candidate_%'").all()).toEqual([]);
      } finally { archived.close(); }
      expect(digest()).toBe(before);
      db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT * FROM config ORDER BY key").all()).toEqual(config);
      expect(db.prepare("SELECT * FROM migrations WHERE version<=59 ORDER BY version").all()).toEqual(receipts);
      for (const table of tables) expect(db.prepare(`SELECT * FROM hindsight_candidate_${table}`).all()).toEqual([]);
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(60);
      const upgraded = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.close();
      db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(upgraded);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok");
    } finally { db.close(); rmTempDir(dir); }
  });

  it("rolls candidate DDL back when its migration receipt cannot commit", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 59) });
    try {
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.exec("CREATE TRIGGER fail_060 BEFORE INSERT ON migrations WHEN NEW.version=60 BEGIN SELECT RAISE(ABORT,'candidate receipt fixture'); END");
      let failure: unknown;
      try { runMigrations(db, [hindsightCandidatesMigration060]); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ message: "migration 60 failed", cause: { message: "candidate receipt fixture" } });
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'hindsight_candidate_%'").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(receipts);
      createConfigRepo(db).upsert("still_usable_after_candidate_failure", true);
    } finally { db.close(); }
  });
});
