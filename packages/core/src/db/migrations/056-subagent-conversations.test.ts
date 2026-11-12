import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { T4_HISTORICAL_MIGRATIONS as MIGRATIONS } from "./historical-t4.ts";
import { subagentConversationsMigration056 } from "./056-subagent-conversations.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });
function open(path: string, migrations: Migration[]) {
  const db = openDatabase({ path, migrations }); dbs.push(db); return db;
}
const families = ["subagent_conversations", "subagent_inputs", "run_messages", "subagent_executions"];

describe("subagent migration 056", () => {
  it("keeps the registry strictly ascending and creates all four families on a fresh install", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b));
    expect(versions).toContain(56);
    const db = open(":memory:", MIGRATIONS);
    for (const name of families) expect(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=:name").get({ name })?.name).toBe(name);
    expect(runMigrations(db, MIGRATIONS)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each(["current", "old-t4"])("upgrades populated %s lineage and reopens without changing old text or migration receipts", (lineage) => {
    const dir = mkdtempSync(join(tmpdir(), "taki-subagent-migration-")); dirs.push(dir);
    const path = join(dir, "state.db");
    const migrations = lineage === "current" ? MIGRATIONS.filter((migration) => migration.version <= 55)
      : [...MIGRATIONS.filter((migration) => migration.version <= 34), { version: 35, sql: "ALTER TABLE timeline_messages ADD COLUMN presentation TEXT;" }];
    const old = open(path, migrations);
    old.exec("INSERT INTO timeline_messages(id,character_id,role,content,created_at) VALUES ('old','taki','user','Original narrator: 我 lost my job','2026-10-21T00:00:00Z')");
    const text = old.prepare("SELECT * FROM timeline_messages WHERE id='old'").get();
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    old.close();
    const upgraded = open(path, MIGRATIONS);
    expect(upgraded.prepare("SELECT * FROM timeline_messages WHERE id='old'").get()).toEqual({ ...text, source_context_json: null, primary_source_id: null });
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=:version ORDER BY version").all({ version: lineage === "current" ? 55 : 35 })).toEqual(receipts);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    upgraded.close();
    const reopened = open(path, MIGRATIONS);
    expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
  });

  it("refuses a conflicting pre-existing table without leaving partial new schema or a receipt", () => {
    const db = open(":memory:", MIGRATIONS.filter((migration) => migration.version < 56));
    db.exec("CREATE TABLE subagent_inputs (wrong TEXT)");
    expect(() => runMigrations(db, [subagentConversationsMigration056])).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='subagent_conversations'").get()).toBeUndefined();
    expect(db.prepare("SELECT version FROM migrations WHERE version=56").get()).toBeUndefined();
    expect(db.prepare("PRAGMA table_info(subagent_inputs)").all().map((row) => row.name)).toEqual(["wrong"]);
  });
});
