import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { openDatabase, type Database, type SqlRow } from "../sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { MIGRATIONS, CONVERGENCE_MIGRATIONS } from "./index-list.ts";
import { MAIN_HISTORICAL_MIGRATIONS } from "./historical-main.ts";
import { T4_HISTORICAL_MIGRATIONS } from "./historical-t4.ts";
import { FROZEN_T4_SCHEMA, FROZEN_SOURCE_REPLACED_TABLES, FROZEN_SOURCE_BACKUP_NAMES } from "./073-frozen-source-phase.ts";
import { T4_SCHEMA } from "./073-convergence-schema.generated.ts";
import { timelinePresentationMigration035 } from "./035-timeline-presentation.ts";

const sourcePhase = "phase TEXT NOT NULL CHECK(phase IN ('snapshotted','normalized','staged','verified','failed'))";
// Only the stopped historical 021 declaration differs; historical 035 remains its actual unquoted ALTER.
const frozenHistory = T4_HISTORICAL_MIGRATIONS.map((migration) => migration.version === 21
  ? { ...migration, sql: migration.sql.replace(sourcePhase, "phase TEXT NOT NULL") }
  : migration.version === 35 ? timelinePresentationMigration035 : migration);
const phases = ["snapshotted", "normalized", "staged", "verified", "failed"];
const tables = [...FROZEN_SOURCE_REPLACED_TABLES, "memory_migration_runs", "timeline_messages", "sqlite_sequence"];
const dbs: Database[] = [];
const roots: string[] = [];
afterEach(() => { for (const db of dbs) db.close(); dbs.length = 0;
  for (const root of roots) rmTempDir(root); roots.length = 0; });
function path(): string {
  const root = mkdtempSync("G:/taki-convergence-gate-"); roots.push(root); return join(root, "taki.db");
}
function open(file: string, migrations: Migration[]): Database {
  const db = openDatabase({ path: file, migrations }); dbs.push(db); return db;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function normalized(sql: string): string {
  const tokens = sql.match(/--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"]|"")*"|'(?:[^']|'')*'|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_\u0080-\u{10FFFF}][\w$\u0080-\u{10FFFF}]*|[^\s]/gu) ?? [];
  const significant = tokens.filter((token) => !token.startsWith("--") && !token.startsWith("/*"))
    .map((token) => /^[A-Za-z_]/.test(token) ? token.toLowerCase() : token);
  if (significant.at(-1) === ";") significant.pop(); return JSON.stringify(significant);
}
function schema(db: Database): SqlRow[] {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all();
}
function receipts(db: Database): SqlRow[] {
  return db.prepare("SELECT version,applied_at FROM migrations ORDER BY version").all();
}
function rows(db: Database): Record<string, SqlRow[]> {
  const names = new Set(schema(db).map((object) => object.name)); names.add("sqlite_sequence");
  return Object.fromEntries(tables.map((table) => [table, !names.has(table) ? [] : db.prepare(table === "timeline_messages"
    ? "SELECT seq,id,character_id,role,content,parts,created_at,presentation FROM timeline_messages ORDER BY seq"
    : table === "sqlite_sequence" ? "SELECT rowid AS original_rowid,* FROM sqlite_sequence ORDER BY rowid"
      : `SELECT rowid AS original_rowid,* FROM ${table} ORDER BY rowid`).all()]));
}
function expectPreservedRows(db: Database, before: Record<string, SqlRow[]>): void {
  const current = rows(db);
  for (const table of tables.filter((name) => name !== "sqlite_sequence")) {
    expect(digest(current[table]), table).toBe(digest(before[table]));
  }
  const oldNames = new Set(before.sqlite_sequence!.map((row) => row.name));
  // Empty T4 delegation backfills initialize these new counters at zero. Every
  // existing counter, including a deleted high-water mark and its rowid, is immutable.
  expect(current.sqlite_sequence!.filter((row) => oldNames.has(row.name))).toEqual(before.sqlite_sequence);
  const schemaNames = new Set(schema(db).map((object) => object.name));
  const addedNames = ["run_messages", "subagent_events", "subagent_conversation_order"]
    .filter((name) => !oldNames.has(name) && schemaNames.has(name));
  expect(current.sqlite_sequence!.filter((row) => !oldNames.has(row.name))
    .map(({ name, seq }) => ({ name, seq }))).toEqual(addedNames.map((name) => ({ name, seq: 0 })));
}
function snapshot(db: Database): string { return digest({ schema: schema(db), rows: rows(db), receipts: receipts(db) }); }
function seed(db: Database): void {
  const hash = "a".repeat(64); const stamp = "2026-11-10T03:04:05.123Z\r\n";
  db.prepare(`INSERT INTO memory_migration_runs(run_id,snapshot_id,phase,status,requested_at,updated_at)
    VALUES ('run','snapshot','verified','ready',:stamp,:stamp)`).run({ stamp });
  for (const [i, phase] of phases.entries()) {
    db.prepare(`INSERT INTO memory_migration_sources(rowid,run_id,source_id,kind,relative_path,raw_sha256,byte_length,
      normalized_hash,content_hash,phase,disposition,document_id,result_count,updated_at)
      VALUES (:rowid,'run',:source,'entry',:relative,:hash,123,:hash,:hash,:phase,'verified',:document,1,:stamp)`)
      .run({ rowid: 11 + i * 19, source: `source-${i}`, relative: `历史/entry-${i}.md\r\n`, hash, phase, document: `document-${i}`, stamp });
  }
  db.prepare(`INSERT INTO memory_migration_attempts(rowid,run_id,source_id,attempt_no,phase,lease_fence,started_at,finished_at,diagnostic_detail)
    VALUES (49,'run','source-0',3,'unchanged-attempt-phase',7,:stamp,:stamp,:detail)`)
    .run({ stamp, detail: '{ "value": "猫", "nil": null }\r\n' });
  db.prepare(`INSERT INTO memory_migration_results(rowid,run_id,source_id,result_ordinal,memory_id,revision,result_payload_hash)
    VALUES (83,'run','source-0',4,'memory-0',7,:hash)`).run({ hash });
  db.prepare(`INSERT INTO memory_migration_exclusions(rowid,run_id,source_id,snapshot_id,raw_sha256,relative_path,reason,operator_actor,created_at)
    VALUES (127,'run','source-0','snapshot',:hash,'历史/entry-0.md',:reason,'owner',:stamp)`)
    .run({ hash, reason: "preserve exclusion\r\n猫", stamp });
  db.prepare(`INSERT INTO hindsight_import_operations(rowid,run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,
    content_identity,provider_content_hash,lease_fence,attempt_no,status,operation_result_hash,derived_unit_count,extraction_error_count,mapping_complete,updated_at)
    VALUES (191,'run','source-0','bank','document-0','operation','remote-operation',:content,:hash,7,3,'mapped',:hash,1,0,1,:stamp)`)
    .run({ content: `sha256:${hash}`, hash, stamp });
  db.prepare(`INSERT INTO hindsight_import_facts(rowid,run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES (251,'run','source-0',5,'fact-0',9,:hash)`).run({ hash });
  db.prepare(`INSERT INTO timeline_messages(seq,id,character_id,role,content,parts,created_at,presentation)
    VALUES (31,'message','taki','assistant',:content,:parts,:stamp,:presentation),
      (149,'deleted','taki','user','deleted',NULL,:stamp,NULL)`)
    .run({ stamp, content: "original\r\n猫", parts: '{ "raw": "bytes" }\r\n', presentation: '{ "kind": "avatar" }\r\n' });
  db.exec("DELETE FROM timeline_messages WHERE seq=149");
}
function expectFrozenShape(db: Database): void {
  const actual = schema(db).map((object) => [object.type, object.name, normalized(String(object.sql))]);
  const expected = [...FROZEN_T4_SCHEMA].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((object) => [object.type, object.name, normalized(object.sql)]);
  // A bounded digest avoids printing the whole generated schema on a failure.
  expect(actual.filter((object, index) => digest(object) !== digest(expected[index])).map((object) => object[1])).toEqual([]);
  expect(digest(actual)).toBe(digest(expected));
}
function expectCheckedClosure(db: Database): void {
  for (const table of FROZEN_SOURCE_REPLACED_TABLES) {
    const expected = T4_SCHEMA.filter((object) => object.name === table || object.table === table)
      .map((object) => [object.type, object.name, normalized(object.sql)]).sort((a, b) => String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : 0);
    const actual = schema(db).filter((object) => object.name === table || object.tbl_name === table)
      .map((object) => [object.type, object.name, normalized(String(object.sql))]);
    expect(digest(actual), table).toBe(digest(expected));
    expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, table).toBeGreaterThan(0);
  }
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(schema(db).filter((object) => FROZEN_SOURCE_BACKUP_NAMES.includes(String(object.name)))).toEqual([]);
  expect(db.prepare("SELECT phase FROM memory_migration_sources ORDER BY rowid").all().map((row) => row.phase)).toEqual(phases);
  for (const phase of ["activated", "unknown", "Verified", "VERIFIED"]) {
    expect(() => db.prepare("UPDATE memory_migration_sources SET phase=:phase WHERE source_id='source-0'").run({ phase })).toThrow();
  }
}
function expectOldReceipts(db: Database, old: SqlRow[]): void {
  expect(receipts(db).filter((row) => Number(row.version) <= 72)).toEqual(old);
  expect(receipts(db).filter((row) => Number(row.version) > 72).map((row) => row.version)).toEqual([73, 74, 75, 76, 77]);
}

describe("073..077 full convergence contract", () => {
  it.each(["fresh", "main", "t4", "frozen", "mixed"])("preserves nonempty closure and reopens %s through 077", (lineage) => {
    const file = path();
    const history = lineage === "fresh" ? MIGRATIONS : lineage === "main" ? MAIN_HISTORICAL_MIGRATIONS
      : lineage === "frozen" ? frozenHistory : T4_HISTORICAL_MIGRATIONS;
    let db = open(file, history); if (lineage === "frozen") expectFrozenShape(db);
    seed(db); const beforeRows = rows(db); const old = receipts(db).filter((row) => Number(row.version) <= 72);
    if (lineage === "mixed") expect(runMigrations(db, CONVERGENCE_MIGRATIONS.slice(0, 1))).toEqual([73]);
    for (const migration of CONVERGENCE_MIGRATIONS) {
      runMigrations(db, [migration]);
      expectPreservedRows(db, beforeRows);
      if (lineage === "frozen") expectCheckedClosure(db);
      db.close(); db = open(file, MIGRATIONS.filter((item) => item.version <= migration.version));
      expectPreservedRows(db, beforeRows);
    }
    expectCheckedClosure(db); expectOldReceipts(db, old); db.close();
    const reopened = open(file, MIGRATIONS); expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
    expectPreservedRows(reopened, beforeRows); expectOldReceipts(reopened, old);
  });

  it.each(["sql", "receipt", "commit"])("restores unchecked SQL, all bytes and receipts after %s failure", (failure) => {
    const file = path(); const db = open(file, frozenHistory); expectFrozenShape(db); seed(db);
    if (failure === "commit") db.exec("CREATE TABLE failure_parent(id INTEGER PRIMARY KEY); CREATE TABLE failure_child(id INTEGER REFERENCES failure_parent(id) DEFERRABLE INITIALLY DEFERRED)");
    const before = snapshot(db); let callbackReturned = false; let checkedBeforeFailure = false;
    const original = CONVERGENCE_MIGRATIONS[0]!;
    const migration = failure === "sql" ? { ...original, sql: "SELECT convergence_missing_sql" } : original;
    const guarded: Database = { ...db, get isTransaction() { return db.isTransaction; },
      prepare(sql) { const statement = db.prepare(sql);
        return failure === "receipt" && sql.startsWith("INSERT INTO migrations") ? { ...statement,
          run() { checkedBeforeFailure = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_migration_sources'").get()?.sql).includes(sourcePhase); throw new Error("receipt refused"); } } : statement; },
      transaction(fn) { db.transaction(() => { fn(); callbackReturned = true;
        if (failure === "commit") db.exec("INSERT INTO failure_child(id) VALUES(99)"); }); },
    };
    expect(() => runMigrations(guarded, [migration])).toThrow(/migration 73 failed/);
    if (failure === "receipt") expect(checkedBeforeFailure).toBe(true);
    if (failure === "commit") expect(callbackReturned).toBe(true);
    expect(snapshot(db)).toBe(before); expect(db.isTransaction).toBe(false);
    expect(String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='memory_migration_sources'").get()?.sql)).not.toContain(sourcePhase);
    db.exec("CREATE TABLE usable_after_failure(id INTEGER); DROP TABLE usable_after_failure"); db.close();
    const reopened = open(file, []); expect(snapshot(reopened)).toBe(before);
    expect(reopened.prepare("SELECT version FROM migrations WHERE version=73").get()).toBeUndefined();
  });

  it.each(FROZEN_SOURCE_REPLACED_TABLES.flatMap((table) => ["foreign key", "view", "trigger", "index"].map((kind) => [table, kind])))("refuses unknown %s %s contracts before rebuild", (table, kind) => {
      const db = open(":memory:", frozenHistory); seed(db);
      if (kind === "foreign key") db.exec(`CREATE TABLE incoming_contract(id INTEGER REFERENCES ${table}(rowid))`);
      if (kind === "view") db.exec(`CREATE VIEW incoming_contract AS SELECT * FROM ${table}`);
      if (kind === "trigger") db.exec(`CREATE TABLE trigger_anchor(id INTEGER); CREATE TRIGGER incoming_contract AFTER INSERT ON trigger_anchor BEGIN SELECT * FROM ${table}; END`);
      if (kind === "index") db.exec(`CREATE INDEX incoming_contract ON ${table}(source_id)`);
      const before = snapshot(db); expect(() => runMigrations(db, CONVERGENCE_MIGRATIONS)).toThrow(/migration 73 failed/);
      expect(snapshot(db)).toBe(before);
    });

  it.each(["activated", "unknown", "Verified"])("refuses unmapped historical phase %s without loss", (phase) => {
    const db = open(":memory:", frozenHistory); seed(db);
    db.prepare("UPDATE memory_migration_sources SET phase=:phase WHERE source_id='source-0'").run({ phase });
    const before = snapshot(db); expect(() => runMigrations(db, CONVERGENCE_MIGRATIONS)).toThrow(/migration 73 failed/);
    expect(snapshot(db)).toBe(before);
  });

  it.each(["phase default", "phase check", "child constraint", "child foreign key", "missing index", "partial group", "backup"])("refuses altered %s declaration without mutation", (change) => {
      const altered = frozenHistory.map((migration) => migration.version !== 21 ? migration : { ...migration,
        sql: change === "phase default" ? migration.sql.replace("phase TEXT NOT NULL,\n disposition", "phase TEXT NOT NULL DEFAULT 'staged',\n disposition")
          : change === "phase check" ? migration.sql.replace("phase TEXT NOT NULL,\n disposition", "phase TEXT NOT NULL CHECK(phase <> 'activated'),\n disposition")
          : change === "child constraint" ? migration.sql.replace("attempt_no>=1", "attempt_no>=0")
          : change === "child foreign key" ? migration.sql.replace("FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE",
            "FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE RESTRICT") : migration.sql });
      if (["phase default", "phase check", "child constraint", "child foreign key"].includes(change)) {
        expect(altered.find((migration) => migration.version === 21)?.sql).not.toBe(frozenHistory.find((migration) => migration.version === 21)?.sql);
      }
      const db = open(":memory:", altered); seed(db);
      if (change === "backup") db.exec(`CREATE TABLE ${FROZEN_SOURCE_BACKUP_NAMES[0]}(id INTEGER)`);
      else if (change === "partial group") db.exec("DROP TABLE hindsight_import_facts");
      else if (change === "missing index") {
        const index = T4_SCHEMA.find((object) => object.type === "index" && FROZEN_SOURCE_REPLACED_TABLES.includes(object.table));
        expect(index).toBeDefined(); db.exec(`DROP INDEX ${index!.name}`);
      }
      const before = snapshot(db); expect(() => runMigrations(db, CONVERGENCE_MIGRATIONS)).toThrow(/migration 73 failed/);
      expect(snapshot(db)).toBe(before);
    });

  const frozenFile = "G:/taki-t4-freeze-20261110/data/core-profile/taki.db";
  it.runIf(existsSync(frozenFile))("replays an isolated copy of the actual stopped freeze and preserves original hash", () => {
    const hash = () => createHash("sha256").update(readFileSync(frozenFile)).digest("hex");
    const originalHash = "973f100874a9f80716d71be96e2b8064e0aa7bf6c40d2e60ec02ff5a6304c023";
    expect(hash()).toBe(originalHash); const file = path(); copyFileSync(frozenFile, file);
    const beforeDb = open(file, []); expectFrozenShape(beforeDb); const before = digest(rows(beforeDb)); const old = receipts(beforeDb); beforeDb.close();
    const upgraded = open(file, MIGRATIONS); expect(digest(rows(upgraded))).toBe(before); expectOldReceipts(upgraded, old);
    expect(upgraded.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]); upgraded.close();
    const reopened = open(file, MIGRATIONS); expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
    expect(digest(rows(reopened))).toBe(before); expectOldReceipts(reopened, old); expect(hash()).toBe(originalHash);
  });
});
