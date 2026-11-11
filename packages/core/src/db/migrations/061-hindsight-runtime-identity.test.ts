import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";

// Failure modes: an unregistered/partial upgrade, changed old receipts, missing DML coverage,
// and a rollback that reuses a change stamp for different data.
const dependencies = ["hindsight_bank_setup", "hindsight_template_enrollments", "hindsight_template_bases",
  "hindsight_template_users", "hindsight_template_selections", "hindsight_template_applied",
  "hindsight_template_defaults", "hindsight_template_default_history", "memory_authority_selection",
  "canonical_memory_authority_state", "canonical_memory_authority_epochs",
  "hindsight_application_replica_checkpoints", "hindsight_replica_sync_checkpoints"];
const stamp = (db: ReturnType<typeof openDatabase>) => db.prepare("SELECT hex(stamp) AS stamp FROM hindsight_runtime_identity_clock").get()?.stamp;

describe("061 runtime identity invalidation", () => {
  it("upgrades 060 without changing old rows/receipts and reopens without changing the stamp", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-061-")); const path = join(directory, "core.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((item) => item.version <= 60) });
    try {
      const selection = db.prepare("SELECT * FROM memory_authority_selection").all();
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(MIGRATIONS.at(-1)?.version);
      expect(db.prepare("SELECT * FROM memory_authority_selection").all()).toEqual(selection);
      expect(db.prepare("SELECT * FROM migrations WHERE version<=60 ORDER BY version").all()).toEqual(receipts);
      const original = stamp(db); expect(original).toMatch(/^[A-F0-9]{32}$/);
      const triggers = db.prepare("SELECT tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND name LIKE '%_runtime_identity_%'").all();
      expect(triggers).toHaveLength(dependencies.length * 3);
      for (const table of dependencies) for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
        expect(triggers.some((row) => row.tbl_name === table && String(row.sql).includes(`AFTER ${operation} ON ${table}`))).toBe(true);
      }
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(stamp(db)).toBe(original);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok");
    } finally { db.close(); rmTempDir(directory); }
  });

  it.each(["rollback", "savepoint"])("does not reuse a stamp after %s and a different direct SQL write", (kind) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const before = stamp(db);
      db.exec(kind === "rollback" ? "BEGIN" : "BEGIN; SAVEPOINT nested");
      db.exec("UPDATE memory_authority_selection SET updated_at='first'");
      const abandoned = stamp(db); expect(abandoned).not.toBe(before);
      db.exec(kind === "rollback" ? "ROLLBACK" : "ROLLBACK TO nested; RELEASE nested");
      expect(stamp(db)).toBe(before);
      db.exec("UPDATE memory_authority_selection SET updated_at='different'");
      expect(stamp(db)).not.toBe(abandoned); expect(stamp(db)).not.toBe(before);
      if (kind === "savepoint") db.exec("COMMIT");
    } finally { db.close(); }
  });

  it("rolls the clock and every invalidation trigger back when the migration receipt fails", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((item) => item.version <= 60) });
    try {
      const migration = MIGRATIONS.find((item) => item.version === 61); expect(migration).toBeDefined();
      db.exec("CREATE TRIGGER fail_061 BEFORE INSERT ON migrations WHEN NEW.version=61 BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
      expect(() => runMigrations(db, [migration!])).toThrow("migration 61 failed");
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='hindsight_runtime_identity_clock' OR name LIKE '%_runtime_identity_%'").all()).toEqual([]);
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(60);
      db.exec("UPDATE memory_authority_selection SET updated_at='still usable'");
    } finally { db.close(); }
  });
});
