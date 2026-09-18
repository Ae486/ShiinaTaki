import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { createCanonicalMemoryAuthorityRepo } from "../canonical-memory-authority-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightPolicyWorkMigration045 } from "./045-hindsight-policy-work.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const before = MIGRATIONS.filter((migration) => migration.version < 45);
const through = [...before, hindsightPolicyWorkMigration045];
function path() { const root = mkdtempSync(join(tmpdir(), "taki-policy-work-migration-")); cleanup.push(() => rmTempDir(root)); return join(root, "memory.sqlite"); }
function open(file: string, migrations = through, onMigrated?: (versions: number[]) => void) {
  const db = openDatabase({ path: file, migrations, onMigrated }); cleanup.push(() => db.close()); return db;
}
function names(db: Database) { return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'hindsight_policy_work%' ORDER BY name").all().map((row) => row.name); }

describe("migration 045 durable Hindsight policy work", () => {
  it("creates the BLOB journal and due-work index on a fresh database and reopens without replay", () => {
    const file = path(); let applied: number[] = [];
    const first = open(file, through, (versions) => { applied = versions; }); expect(applied).toContain(45);
    expect(names(first)).toEqual(["hindsight_policy_work", "hindsight_policy_work_due"]);
    expect(first.prepare("SELECT name,type FROM pragma_table_info('hindsight_policy_work') WHERE name IN ('target_bytes','result_bytes') ORDER BY name").all())
      .toEqual([{ name: "result_bytes", type: "BLOB" }, { name: "target_bytes", type: "BLOB" }]);
    first.close(); applied = [45]; open(file, through, (versions) => { applied = versions; }); expect(applied).toEqual([]);
  });

  it("preserves every existing schema object and raw Pending/G1 evidence while adding the independent curator journal", () => {
    const file = path(); const first = open(file, before);
    const epoch = createCanonicalMemoryAuthorityRepo(first).initializeLocalAuthority("2026-09-11T00:00:00.000Z");
    const evidence = '{ "dispatch": {"protocol":"tracked_native_v1"}, "receipt": [1,"1",null,{"typed":true}] }';
    first.prepare(`INSERT INTO pending_memory(authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
      VALUES (:epoch,'bank','historical-g1','retain',:hash,'outcome_unknown',3,:bytes)`)
      .run({ epoch: epoch.epochId, hash: "a".repeat(64), bytes: evidence });
    const rows = first.prepare("SELECT * FROM pending_memory").all();
    const schema = first.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    first.close(); const upgraded = open(file);
    expect(upgraded.prepare("SELECT * FROM pending_memory").all()).toEqual(rows);
    expect(upgraded.prepare("SELECT state_json FROM pending_memory").get()?.state_json).toBe(evidence);
    expect(upgraded.prepare(`SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'hindsight_policy_work%' ORDER BY type,name`).all()).toEqual(schema);
  });

  it("rolls back the journal, index and migration receipt together when migration application fails", () => {
    const db = open(":memory:", before);
    expect(() => runMigrations(db, [{ ...hindsightPolicyWorkMigration045,
      sql: `${hindsightPolicyWorkMigration045.sql}\nINSERT INTO absent_policy_work_table VALUES (1);` }])).toThrow();
    expect(names(db)).toEqual([]); expect(db.prepare("SELECT version FROM migrations WHERE version=45").get()).toBeUndefined();
    expect(runMigrations(db, [hindsightPolicyWorkMigration045])).toEqual([45]); expect(names(db)).toHaveLength(2);
  });
});
