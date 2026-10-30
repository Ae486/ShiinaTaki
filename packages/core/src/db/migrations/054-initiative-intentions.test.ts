import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { initiativeIntentionsMigration054 } from "./054-initiative-intentions.ts";

const databases: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-intention-054-")) throw new Error("unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
function open(path: string, migrated = true) {
  const migrations = MIGRATIONS.filter((migration) => migration.version < 54);
  if (migrated) migrations.push(initiativeIntentionsMigration054);
  const db = openDatabase({ path, migrations }); databases.push(db); return db;
}

describe("finite Intention migration 054", () => {
  it("adds only Intention storage to recorded 053 and preserves receipts and Timeline on actual reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-intention-054-")); roots.push(root);
    const path = join(root, "intentions.db"); const old = open(path, false);
    old.exec(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
      VALUES('reported-matter','taki','user','My interview outcome is still unknown.','2026-09-28T10:00:00.000Z')`);
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    const timeline = old.prepare("SELECT * FROM timeline_messages").all();
    const priorSchema = old.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    old.close();
    const upgraded = open(path);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<54 ORDER BY version").all()).toEqual(receipts);
    const upgradedSchema = upgraded.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    for (const entry of priorSchema) expect(upgradedSchema).toContainEqual(entry);
    expect(upgraded.prepare("SELECT * FROM timeline_messages").all()).toEqual(timeline);
    upgraded.close();
    const reopened = open(path);
    expect(reopened.prepare("SELECT count(*) AS n FROM migrations WHERE version=54").get()?.n).toBe(1);
    expect(reopened.prepare("SELECT * FROM timeline_messages").all()).toEqual(timeline);
    expect(reopened.prepare("SELECT * FROM initiative_intentions").all()).toEqual([]);
    expect(runMigrations(reopened, [initiativeIntentionsMigration054])).toEqual([]);
  });

  it("rolls back table, indexes and triggers if its immutable receipt cannot commit", () => {
    const old = open(":memory:", false);
    old.exec("CREATE TRIGGER reject_054 BEFORE INSERT ON migrations WHEN NEW.version=54 BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
    expect(() => runMigrations(old, [initiativeIntentionsMigration054])).toThrow("migration 54 failed");
    expect(old.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'initiative_intention%'").all()).toEqual([]);
    expect(old.prepare("SELECT * FROM migrations WHERE version=54").all()).toEqual([]);
  });
});
