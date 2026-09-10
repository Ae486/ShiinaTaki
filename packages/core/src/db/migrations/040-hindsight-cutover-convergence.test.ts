import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { openDatabase, type Database, type SqlRow } from "../sqlite.ts";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { createLocalCoverageFixture, seedLocalB2CoverageFixture } from "../hindsight-local-coverage-fixtures.ts";
import { MIGRATIONS } from "./index-list.ts";
import { earlyHindsightMigration023 } from "./040-hindsight-cutover-convergence-fixtures.ts";
import { hindsightCutoverConvergenceMigration040 } from "./040-hindsight-cutover-convergence.ts";

const roots: string[] = [];
const dbs: Database[] = [];
const missingEarlyTables = [
  "hindsight_cutover_runs", "hindsight_replica_staging_runs", "hindsight_replica_staging_records",
  "hindsight_replica_records", "hindsight_replica_checkpoints", "hindsight_authority_activation_receipts",
  "hindsight_authority_bank_receipts",
];
const earlyThrough039 = MIGRATIONS.filter(({ version }) => version <= 39)
  .map((migration) => migration.version === 23 ? earlyHindsightMigration023 : migration);
const currentThrough039 = MIGRATIONS.filter(({ version }) => version <= 39);

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const resolved = resolve(root);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith("taki-migration-040-")) {
      throw new Error("unsafe migration fixture path");
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-040-"));
  roots.push(root);
  return join(root, "taki.db");
}

function open(path: string, migrations = MIGRATIONS, onMigrated?: (versions: number[]) => void): Database {
  const db = openDatabase({ path, migrations, onMigrated });
  dbs.push(db);
  return db;
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function receipts(db: Database): SqlRow[] {
  return db.prepare("SELECT version,applied_at FROM migrations ORDER BY version").all();
}

function schema(db: Database): SqlRow[] {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
}

function dataBytes(db: Database, selectedTables?: string[]): Record<string, SqlRow[]> {
  const tableNames = selectedTables ?? db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name<>'migrations' ORDER BY name")
    .all().map(({ name }) => String(name));
  return Object.fromEntries(tableNames.map((table) => {
    // Type witnesses preserve NULL versus empty text; SQL hex captures bytes without JSON reserialization.
    // Only the newly nullable marker fields are compared separately from the original column set.
    const columns = db.prepare("SELECT name FROM pragma_table_xinfo(:table) WHERE hidden=0 ORDER BY cid").all({ table })
      .map(({ name }) => String(name)).filter((name) => table !== "memory_authority_selection" ||
        !["provider_lineage_id", "replica_checkpoint_digest"].includes(name));
    const selections = columns.flatMap((column) => [
      `typeof(${identifier(column)}) AS ${identifier(`${column}:type`)}`,
      `hex(CAST(${identifier(column)} AS BLOB)) AS ${identifier(`${column}:bytes`)}`,
    ]);
    const order = selections.map((_selection, index) => index + 1).join(",");
    return [table, db.prepare(`SELECT ${selections.join(",")} FROM ${identifier(table)} ORDER BY ${order}`).all()];
  }));
}

function b4Schema(db: Database): SqlRow[] {
  const tables = new Set(["memory_authority_selection", "hindsight_import_operations", "hindsight_import_facts", ...missingEarlyTables]);
  return schema(db).filter(({ tbl_name }) => typeof tbl_name === "string" && tables.has(tbl_name))
    .map((row) => ({ ...row, sql: typeof row.sql === "string" ? row.sql.replace(/\s+/g, " ").trim() : row.sql ?? null }));
}

function seedRawLocal(db: Database): ReturnType<typeof seedLocalB2CoverageFixture> {
  const fixture = seedLocalB2CoverageFixture(db);
  db.prepare("UPDATE canonical_memory_sources SET metadata_json=:json,retained_text=:text,context='' WHERE document_id=:id")
    .run({ id: fixture.source.documentId, json: '{ "n": 1, "s": "1", "null": null, "empty": "", "__proto__": { "k": true } }\r\n',
      text: "Original text: café 🐈\r\nSecond line.\u0000Tail" });
  db.prepare("UPDATE canonical_memory_units SET metadata_json=:json,context=NULL WHERE memory_id=:id")
    .run({ id: fixture.record.unit.memoryId, json: '{\n "number": 2, "text": "2", "array": [null, "", 1] }\r\n' });
  db.prepare("UPDATE memory_migration_sources SET diagnostic_code=:value WHERE run_id=:run AND source_id=:source")
    .run({ run: fixture.runId, source: fixture.sourceId, value: "historical-code\r\n" });
  db.exec("UPDATE migrations SET applied_at=printf('2026-08-21T15:26:%02d.434Z',version)");
  db.exec("UPDATE migrations SET applied_at='2026-08-21T15:26:11.434Z' WHERE version=23");
  return fixture;
}

function expectUnchanged(db: Database, before: { data: Record<string, SqlRow[]>; receipts: SqlRow[]; schema: SqlRow[] }): void {
  expect(dataBytes(db, Object.keys(before.data))).toEqual(before.data);
  expect(receipts(db)).toEqual(before.receipts);
  expect(schema(db)).toEqual(before.schema);
}

function snapshot(db: Database) {
  return { data: dataBytes(db), receipts: receipts(db), schema: schema(db) };
}

function expectRefusal(db: Database, cause: RegExp, migration: Migration = hindsightCutoverConvergenceMigration040): void {
  expect(() => runMigrations(db, [migration])).toThrowError(expect.objectContaining({
    message: "migration 40 failed", cause: expect.objectContaining({ message: expect.stringMatching(cause) }),
  }));
}

describe("040 early applied-023 convergence", () => {
  it.each([35, 39])("repairs early 023 at max %s with unchanged Local/B2 bytes and receipts, then reopens as a no-op", (version) => {
    const path = databasePath();
    const old = open(path, earlyThrough039.filter((migration) => migration.version <= version));
    seedRawLocal(old);
    expect(old.prepare("PRAGMA table_info(migrations)").all().map(({ name }) => name))
      .toEqual(["version", "applied_at"]);
    const before = snapshot(old);
    const tables = old.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(({ name }) => name);
    expect(missingEarlyTables.every((table) => !tables.includes(table))).toBe(true);
    expect(old.prepare("SELECT count(*) AS n FROM hindsight_import_operations").get()?.n).toBe(0);
    expect(old.prepare("SELECT count(*) AS n FROM hindsight_import_facts").get()?.n).toBe(0);
    old.close();

    const applied: number[][] = [];
    const upgraded = open(path, MIGRATIONS, (versions) => applied.push(versions));
    expect(() => upgraded.prepare("SELECT run_id FROM hindsight_cutover_runs").all()).not.toThrow();
    expect(applied).toEqual([version === 35 ? [36, 37, 38, 39, 40] : [40]]);
    expect(upgraded.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(40);
    expect(receipts(upgraded).filter((row) => Number(row.version) <= version)).toEqual(before.receipts);
    expect(dataBytes(upgraded, Object.keys(before.data))).toEqual(before.data);
    expect(upgraded.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
    expect(upgraded.prepare("SELECT provider_lineage_id,replica_checkpoint_digest FROM memory_authority_selection").get())
      .toEqual({ provider_lineage_id: null, replica_checkpoint_digest: null });
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(upgraded.prepare("PRAGMA quick_check").all()).toEqual([{ quick_check: "ok" }]);
    expect(b4Schema(upgraded)).toEqual(b4Schema(open(":memory:", currentThrough039)));
    const committed = snapshot(upgraded);
    upgraded.close();

    const reopenedApplied: number[][] = [];
    const reopened = open(path, MIGRATIONS, (versions) => reopenedApplied.push(versions));
    expect(reopenedApplied).toEqual([[]]);
    expectUnchanged(reopened, committed);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("converges an untouched legacy marker without fabricating an authority epoch", () => {
    const db = open(":memory:", earlyThrough039);
    const marker = db.prepare("SELECT * FROM memory_authority_selection").get();
    expect(runMigrations(db, MIGRATIONS)).toEqual([40]);
    expect(db.prepare("SELECT * FROM memory_authority_selection").get())
      .toEqual({ ...marker, provider_lineage_id: null, replica_checkpoint_digest: null });
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs").get()?.n).toBe(0);
  });

  it("uses the same exact B4 constraints for fresh installs and upgrades", () => {
    const fresh = open(":memory:");
    const upgraded = open(":memory:", earlyThrough039);
    runMigrations(upgraded, MIGRATIONS);
    expect(b4Schema(upgraded)).toEqual(b4Schema(fresh));
    expect(runMigrations(fresh, MIGRATIONS)).toEqual([]);
    expect(fresh.prepare("SELECT version FROM migrations ORDER BY version").all().map(({ version }) => version))
      .toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(fresh.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

function seedModernB4(db: Database) {
  const fixture = createLocalCoverageFixture(db);
  const hash = "a".repeat(64);
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
     lease_fence,status,operation_result_hash,derived_unit_count,extraction_error_count,mapping_complete,updated_at)
    VALUES (:run,:source,:bank,:document,'old-operation','old-remote',:identity,:hash,7,'mapped',:hash,1,0,1,'old-update')`)
    .run({ run: fixture.runId, source: fixture.sourceId, bank: fixture.bankId, document: fixture.source.documentId,
      identity: `sha256:${hash}`, hash });
  db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES (:run,:source,0,'old-fact',3,:hash)`).run({ run: fixture.runId, source: fixture.sourceId, hash });
  db.prepare(`INSERT INTO hindsight_replica_staging_runs
    (staging_id,run_id,replica_epoch_id,provider_lineage,bank_id,bank_generation,snapshot_id,end_cursor,manifest_digest,
     manifest_json,snapshot_expires_at,status,created_at,updated_at)
    VALUES ('old-stage',:run,'replica','lineage',:bank,'generation','snapshot',11,:hash,:json,'expiry','published','created','updated')`)
    .run({ run: fixture.runId, bank: fixture.bankId, hash, json: '{ "manifest": [1, "1", null] }\r\n' });
  db.prepare(`INSERT INTO hindsight_replica_staging_records
    (staging_id,page_number,record_ordinal,object_kind,object_id,object_revision,payload_hash,payload_json)
    VALUES ('old-stage',0,0,'memory_unit','old-fact',3,:hash,:json)`)
    .run({ hash, json: '{ "text": "café 🐈", "number": 1, "string": "1" }\r\n' });
  db.prepare(`INSERT INTO hindsight_replica_records
    (bank_id,replica_epoch_id,object_kind,object_id,object_revision,payload_hash,payload_json)
    SELECT :bank,'replica',object_kind,object_id,object_revision,payload_hash,payload_json
    FROM hindsight_replica_staging_records WHERE staging_id='old-stage'`).run({ bank: fixture.bankId });
  db.prepare(`INSERT INTO hindsight_replica_checkpoints
    (bank_id,replica_epoch_id,provider_lineage,bank_generation,snapshot_id,end_cursor,manifest_digest,captured_at,
     snapshot_expires_at,published_at,staging_id)
    VALUES (:bank,'replica','lineage','generation','snapshot',11,:hash,'captured','expiry','published','old-stage')`)
    .run({ bank: fixture.bankId, hash });
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at='closed' WHERE epoch_id=:epoch")
    .run({ epoch: fixture.epochId });
  db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,reason)
    VALUES ('old-hindsight-epoch','hindsight','lineage','active',:epoch,'started','planned-switch')`).run({ epoch: fixture.epochId });
  db.exec("UPDATE canonical_memory_authority_state SET active_epoch_id='old-hindsight-epoch'");
  db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='old-hindsight-epoch',
    verified_snapshot_id=NULL,activation_transaction_id='old-hindsight-tx',provider_lineage_id='lineage',replica_checkpoint_digest=:hash`)
    .run({ hash });
  db.prepare(`INSERT INTO hindsight_authority_activation_receipts
    (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,checkpoint_set_digest,
     bank_count,lease_fence,committed_at)
    VALUES ('old-hindsight-tx',:run,:epoch,'old-hindsight-epoch','lineage',:hash,:hash,1,7,'committed')`)
    .run({ run: fixture.runId, epoch: fixture.epochId, hash });
  db.prepare(`INSERT INTO hindsight_authority_bank_receipts
    (transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,end_cursor,manifest_digest,template_digest)
    VALUES ('old-hindsight-tx',:bank,'snapshot','generation','replica',11,:hash,:hash)`).run({ bank: fixture.bankId, hash });
  return fixture;
}

describe("040 modern applied-023 no-op", () => {
  it("preserves nonempty imports, raw replicas, checkpoints and an active Hindsight marker without rebuilding", () => {
    const path = databasePath();
    const old = open(path, currentThrough039);
    seedModernB4(old);
    const before = snapshot(old);
    const marker = old.prepare("SELECT * FROM memory_authority_selection").get();
    old.close();
    const applied: number[][] = [];
    const upgraded = open(path, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([[40]]);
    expect(schema(upgraded)).toEqual(before.schema);
    expect(dataBytes(upgraded)).toEqual(before.data);
    expect(receipts(upgraded).slice(0, -1)).toEqual(before.receipts);
    expect(upgraded.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const committed = snapshot(upgraded);
    upgraded.close();
    const reopenedApplied: number[][] = [];
    const reopened = open(path, MIGRATIONS, (versions) => reopenedApplied.push(versions));
    expect(reopenedApplied).toEqual([[]]);
    expectUnchanged(reopened, committed);
    expect(reopened.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
  });
});

describe("040 unsupported lineage refusal", () => {
  it.each([
    ["unexpected column", "ALTER TABLE hindsight_import_operations ADD COLUMN unknown TEXT"],
    ["missing old pair member", "DROP TABLE hindsight_import_facts"],
    ["partially added cutover table", "CREATE TABLE hindsight_cutover_runs (run_id TEXT PRIMARY KEY)"],
    ["missing old index", "DROP INDEX idx_hindsight_import_operations_status"],
    ["unknown marker index", "CREATE INDEX unknown_marker_index ON memory_authority_selection(mode)"],
    ["unknown marker trigger", "CREATE TRIGGER unknown_marker_trigger AFTER UPDATE ON memory_authority_selection BEGIN SELECT 1; END"],
    ["reserved temporary table", "CREATE TABLE memory_authority_selection_pre_040 (value TEXT)"],
  ])("refuses %s with identical rows, definitions and receipts", (_label, sql) => {
    const path = databasePath();
    const db = open(path, earlyThrough039);
    seedRawLocal(db);
    db.exec(sql);
    const before = snapshot(db);
    expectRefusal(db, /unsupported migration schema lineage/);
    expectUnchanged(db, before);
    db.close();
    expectUnchanged(open(path, []), before);
  });

  it.each([
    ["foreign key", "CREATE TABLE external_marker_reference (id INTEGER REFERENCES memory_authority_selection(singleton))"],
    ["view", "CREATE VIEW external_marker_view AS SELECT mode FROM memory_authority_selection"],
    ["external trigger", "CREATE TABLE external_marker_writer (id INTEGER); CREATE TRIGGER external_marker_trigger AFTER INSERT ON external_marker_writer BEGIN UPDATE memory_authority_selection SET updated_at='unexpected'; END"],
  ])("refuses an unknown incoming %s before any schema replacement", (_label, sql) => {
    const db = open(":memory:", earlyThrough039);
    seedRawLocal(db);
    db.exec(sql);
    const before = snapshot(db);
    expectRefusal(db, /unsupported incoming/);
    expectUnchanged(db, before);
  });

  it("refuses modern column-compatible tables with weakened CHECK semantics", () => {
    const db = open(":memory:", currentThrough039);
    db.exec("DROP TABLE hindsight_import_facts");
    db.exec(`CREATE TABLE hindsight_import_facts (
      run_id TEXT NOT NULL, source_id TEXT NOT NULL, fact_ordinal INTEGER NOT NULL CHECK(fact_ordinal>=0),
      fact_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
      payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), PRIMARY KEY(run_id,source_id,fact_ordinal),
      UNIQUE(run_id,fact_id), FOREIGN KEY(run_id,source_id) REFERENCES hindsight_import_operations(run_id,source_id) ON DELETE CASCADE
    ) STRICT; CREATE INDEX idx_hindsight_import_facts_source ON hindsight_import_facts(run_id,source_id,fact_ordinal);`);
    const before = snapshot(db);
    expectRefusal(db, /unsupported migration schema lineage/);
    expectUnchanged(db, before);
  });

  it.each([false, true])("refuses nonempty old imports (facts: %s) without inventing identities, hashes or a lease fence", (withFacts) => {
    const db = open(":memory:", earlyThrough039);
    const fixture = seedRawLocal(db);
    db.prepare(`INSERT INTO hindsight_import_operations
      (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_hash,status,operation_result_hash,updated_at)
      VALUES (:run,:source,:bank,:document,'identity','remote',:hash,'pending','unconstrained old result','updated')`)
      .run({ run: fixture.runId, source: fixture.sourceId, bank: fixture.bankId, document: fixture.source.documentId, hash: "z".repeat(64) });
    if (withFacts) db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
      VALUES (:run,:source,0,'old-fact',1,:hash)`).run({ run: fixture.runId, source: fixture.sourceId, hash: "z".repeat(64) });
    const before = snapshot(db);
    expectRefusal(db, /requires empty hindsight_import_operations: historical rows have no proven identity mapping/);
    expectUnchanged(db, before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses orphan historical facts even when the operations table is empty", () => {
    const db = open(":memory:", earlyThrough039);
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
      VALUES ('old-run','old-source',0,'old-fact',1,:hash)`).run({ hash: "z".repeat(64) });
    db.exec("PRAGMA foreign_keys=ON");
    const before = snapshot(db);
    expectRefusal(db, /requires empty hindsight_import_facts/);
    expectUnchanged(db, before);
  });
});

describe("040 atomic migration failure", () => {
  it.each(["SQL", "receipt", "COMMIT"])("rolls back replacements, new tables and old bytes after %s failure and survives reopen", (failure) => {
    const path = databasePath();
    const db = open(path, earlyThrough039);
    seedRawLocal(db);
    let migration = hindsightCutoverConvergenceMigration040;
    if (failure === "SQL") migration = { ...migration, sql: "NOT SQL;" };
    if (failure === "receipt") db.exec(`CREATE TRIGGER refuse_040_receipt BEFORE INSERT ON migrations WHEN NEW.version=40
      BEGIN SELECT RAISE(ABORT,'receipt refused'); END;`);
    if (failure === "COMMIT") {
      db.exec(`CREATE TABLE late_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE late_child (parent_id INTEGER REFERENCES late_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
      migration = { ...migration, sql: "INSERT INTO late_child (parent_id) VALUES (7)" };
    }
    const before = snapshot(db);
    expectRefusal(db, failure === "receipt" ? /receipt refused/ : failure === "COMMIT" ? /FOREIGN KEY constraint/ : /syntax error/, migration);
    expectUnchanged(db, before);
    db.close();
    const reopened = open(path, []);
    expectUnchanged(reopened, before);
    if (failure === "receipt") reopened.exec("DROP TRIGGER refuse_040_receipt");
    expect(runMigrations(reopened, [hindsightCutoverConvergenceMigration040])).toEqual([40]);
    expect(dataBytes(reopened, Object.keys(before.data))).toEqual(before.data);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rolls back every schema edit when an invalid historical marker cannot satisfy current constraints", () => {
    const db = open(":memory:", earlyThrough039);
    seedRawLocal(db);
    db.exec("PRAGMA ignore_check_constraints=ON");
    db.exec("UPDATE memory_authority_selection SET active_epoch_id=NULL");
    db.exec("PRAGMA ignore_check_constraints=OFF");
    const before = snapshot(db);
    expectRefusal(db, /CHECK constraint failed/);
    expectUnchanged(db, before);
  });
});
