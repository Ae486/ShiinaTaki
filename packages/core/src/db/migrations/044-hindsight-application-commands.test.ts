import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { createCanonicalMemoryAuthorityRepo } from "../canonical-memory-authority-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightApplicationCommandsMigration044 } from "./044-hindsight-application-commands.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const before = MIGRATIONS.filter((migration) => migration.version < 44);
const through = [...before, hindsightApplicationCommandsMigration044];
function path() { const root = mkdtempSync(join(tmpdir(), "taki-application-command-migration-")); cleanup.push(() => rmTempDir(root)); return join(root, "memory.sqlite"); }
function open(file: string, migrations = through, onMigrated?: (versions: number[]) => void) {
  const db = openDatabase({ path: file, migrations, onMigrated }); cleanup.push(() => db.close()); return db;
}
function names(db: Database) { return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'hindsight_application_command_%' ORDER BY name").all().map((row) => row.name); }

describe("migration 044 application command outbox", () => {
  it("creates new BLOB-backed preparation tables once and reopens without reapplying", () => {
    const file = path(); let applied: number[] = [];
    const first = open(file, through, (versions) => { applied = versions; }); expect(applied).toContain(44);
    expect(names(first)).toEqual(["hindsight_application_command_bodies", "hindsight_application_command_jobs", "hindsight_application_command_pending"]);
    expect(first.prepare("SELECT type FROM pragma_table_info('hindsight_application_command_jobs') WHERE name='intent_bytes'").get()?.type).toBe("BLOB");
    first.close(); applied = [44]; open(file, through, (versions) => { applied = versions; }); expect(applied).toEqual([]);
  });

  it("preserves every previous schema object and raw Pending/G1 evidence byte while adding 044", () => {
    const file = path(); const first = open(file, before); const epoch = createCanonicalMemoryAuthorityRepo(first).initializeLocalAuthority("2026-09-11T00:00:00.000Z");
    const historical = '{ "dispatch": { "protocol": "tracked_native_v1", "native_request": {"omitted":null,"value":"{\\"typed\\":false}"} }, "receipt": [true, 1, "1"] }';
    first.prepare(`INSERT INTO pending_memory(authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
      VALUES (:epoch,'bank','existing-g1','retain',:hash,'outcome_unknown',3,:bytes)`)
      .run({ epoch: epoch.epochId, hash: "a".repeat(64), bytes: historical });
    const rows = first.prepare("SELECT * FROM pending_memory").all();
    const oldSchema = first.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    first.close(); const upgraded = open(file);
    expect(upgraded.prepare("SELECT * FROM pending_memory").all()).toEqual(rows);
    expect(upgraded.prepare("SELECT state_json FROM pending_memory").get()?.state_json).toBe(historical);
    expect(upgraded.prepare(`SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'hindsight_application_command_%' ORDER BY type,name`).all()).toEqual(oldSchema);
  });

  it("rolls back tables and migration receipt together on a failed migration transaction", () => {
    const db = open(":memory:", before);
    expect(() => runMigrations(db, [{ ...hindsightApplicationCommandsMigration044,
      sql: `${hindsightApplicationCommandsMigration044.sql}\nINSERT INTO absent_command_table VALUES (1);` }])).toThrow();
    expect(names(db)).toEqual([]); expect(db.prepare("SELECT version FROM migrations WHERE version=44").get()).toBeUndefined();
    expect(runMigrations(db, [hindsightApplicationCommandsMigration044])).toEqual([44]); expect(names(db)).toHaveLength(3);
  });
});
