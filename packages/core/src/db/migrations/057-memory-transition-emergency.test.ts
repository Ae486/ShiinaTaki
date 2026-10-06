import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { seedTransition, startTransition } from "../memory-transition-fixtures.ts";
import { MIGRATIONS } from "./index-list.ts";
import { memoryTransitionEmergencyMigration057 } from "./057-memory-transition-emergency.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

describe("057 emergency lineage", () => {
  it("preserves historical ownership and migration bytes across the upgrade and second reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-057-")); const path = join(dir, "taki.db");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((row) => row.version <= 56) });
    try {
      const intent = seedTransition(db); startTransition(db, intent);
      const attempts = db.prepare("SELECT * FROM memory_transition_attempts").all();
      const intents = db.prepare("SELECT * FROM memory_transition_intents").all();
      const operations = db.prepare("SELECT * FROM memory_operations").all();
      const history = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      for (let reopen = 0; reopen < 2; reopen++) {
        expect(db.prepare("SELECT * FROM memory_transition_attempts").all()).toEqual(attempts);
        expect(db.prepare("SELECT * FROM memory_transition_intents").all()).toEqual(intents);
        expect(db.prepare("SELECT * FROM memory_operations").all()).toEqual(operations);
        expect(db.prepare("SELECT * FROM migrations WHERE version<=56 ORDER BY version").all()).toEqual(history);
        expect(db.prepare("SELECT * FROM memory_transition_incidents").all()).toEqual([]);
        expect(db.prepare("SELECT * FROM memory_transition_emergency_quarantine").all()).toEqual([]);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      }
    } finally { db.close(); rmTempDir(dir); }
  });
  it.each(["sql", "receipt", "commit"])("rolls back %s failure including replaced admission triggers", (fault) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((row) => row.version <= 56) });
    try {
      const intent = seedTransition(db); startTransition(db, intent);
      const triggers = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
      const history = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      if (fault === "receipt") db.exec("CREATE TRIGGER owned_failure BEFORE INSERT ON migrations WHEN NEW.version=57 BEGIN SELECT RAISE(ABORT,'owned'); END");
      if (fault === "commit") db.exec(`CREATE TABLE owned_parent(id TEXT PRIMARY KEY);
        CREATE TABLE owned_child(id TEXT REFERENCES owned_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER owned_failure AFTER INSERT ON migrations WHEN NEW.version=57 BEGIN INSERT INTO owned_child VALUES('missing'); END`);
      const migration = fault === "sql" ? { ...memoryTransitionEmergencyMigration057,
        sql: memoryTransitionEmergencyMigration057.sql + "INSERT INTO owned_missing_table VALUES(1);" } : memoryTransitionEmergencyMigration057;
      expect(() => runMigrations(db, [migration])).toThrow();
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(history);
      expect(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name<>'owned_failure' ORDER BY name").all()).toEqual(triggers);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='memory_transition_incidents'").get()).toBeUndefined();
    } finally { db.close(); }
  });
});
