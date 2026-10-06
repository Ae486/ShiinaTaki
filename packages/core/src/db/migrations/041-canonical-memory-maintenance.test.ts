import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createCanonicalIngestionRepo } from "../canonical-ingestion-repo.ts";
import { createCanonicalMemoryRepo } from "../canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../canonical-memory-maintenance-repo.ts";
import { createCanonicalMaintenanceFixture } from "../canonical-memory-maintenance-fixtures.ts";
import { seedLocalB2CoverageFixture } from "../hindsight-local-coverage-fixtures.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { createTimelineRepo } from "../timeline-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../../memory/canonical-ingestion-source.ts";
import { canonicalMemoryMaintenanceMigration041 } from "./041-canonical-memory-maintenance.ts";
import { MIGRATIONS } from "./index-list.ts";

const databases: Database[] = []; const roots: string[] = [];
const through040 = MIGRATIONS.filter(({ version }) => version <= 40);
const addedTables = ["canonical_memory_retired_sources", "canonical_memory_ingestion_cursors",
  "canonical_memory_ingestion_spans", "canonical_memory_primary_commits"];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("taki-migration-041-")) throw new Error("unsafe fixture path");
    rmSync(absolute, { recursive: true, force: true });
  }
});
function path() {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-041-")); roots.push(root); return join(root, "fixture.db");
}
function open(file = ":memory:", migrations = MIGRATIONS, onMigrated?: (versions: number[]) => void) {
  const db = openDatabase({ path: file, migrations, onMigrated }); databases.push(db); return db;
}
function schema(db: Database) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
}
function historyBytes(db: Database) {
  return {
    snapshots: db.prepare(`SELECT authority_epoch_id,bank_id,memory_id,revision,hex(CAST(record_json AS BLOB)) AS bytes,
      created_at FROM canonical_memory_revision_snapshots ORDER BY authority_epoch_id,bank_id,memory_id,revision`).all(),
    receipts: db.prepare(`SELECT authority_epoch_id,request_id,operation,request_hash,
      hex(CAST(result_json AS BLOB)) AS bytes,created_at FROM canonical_memory_operation_receipts ORDER BY authority_epoch_id,request_id`).all(),
  };
}
function currentRows(db: Database) {
  const tables = ["canonical_memory_sources", "canonical_memory_units", "canonical_memory_policy", "canonical_memory_unit_sources",
    "canonical_memory_fts", "canonical_memory_authority_state", "canonical_memory_authority_epochs", "memory_authority_selection"];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function migrationReceipts(db: Database) { return db.prepare("SELECT * FROM migrations ORDER BY version").all(); }

describe("041 canonical maintenance history and ingestion schema", () => {
  it("applies a fresh ordered registry, enforces one pending span, and retains the exact eligibility baseline", () => {
    const applied: number[][] = []; const db = open(":memory:", MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([MIGRATIONS.map(({ version }) => version)]);
    expect(MIGRATIONS.at(-1)?.version).toBe(57);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name);
    expect(addedTables.every((table) => tables.includes(table))).toBe(true);
    const value = createCanonicalMaintenanceFixture(db); value.seed();
    db.prepare(`INSERT INTO canonical_memory_ingestion_cursors
      (authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at) VALUES (:epoch,'a',0,51,:now)`)
      .run({ epoch: value.epochId, now: "2026-09-10T00:00:00.000Z" });
    expect(db.prepare("SELECT through_seq,eligibility_start_seq FROM canonical_memory_ingestion_cursors").get())
      .toMatchObject({ through_seq: 0, eligibility_start_seq: 51 });
    const insert = db.prepare(`INSERT INTO canonical_memory_ingestion_spans
      (authority_epoch_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,state,revision,created_at,updated_at)
      VALUES (:epoch,'a',:id,50,51,'source-hash','{}','pending',1,:now,:now)`);
    insert.run({ epoch: value.epochId, id: "one", now: "2026-09-10T00:00:00.000Z" });
    expect(() => insert.run({ epoch: value.epochId, id: "two", now: "2026-09-10T00:00:00.000Z" })).toThrow();
    db.exec("UPDATE canonical_memory_ingestion_spans SET state='complete' WHERE span_id='one'");
    expect(() => insert.run({ epoch: value.epochId, id: "two", now: "2026-09-10T00:00:00.000Z" })).not.toThrow();
    expect(db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('canonical_memory_revision_snapshots')").all())
      .toEqual([{ table: "canonical_memory_banks" }, { table: "canonical_memory_banks" }]);
    expect(db.prepare("SELECT \"table\",on_delete FROM pragma_foreign_key_list('canonical_memory_primary_commits') WHERE \"from\"='timeline_seq'").get())
      .toMatchObject({ table: "timeline_messages", on_delete: "CASCADE" });
    expect(db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('canonical_memory_primary_commits') WHERE \"from\"='authority_epoch_id'").get())
      .toMatchObject({ table: "canonical_memory_authority_epochs" });
  });

  it("upgrades a real 040 Local/B2 history byte-for-byte, replays after deletion, and reopens without another migration", () => {
    const file = path(); const old = open(file, through040); const value = seedLocalB2CoverageFixture(old);
    old.prepare("UPDATE canonical_memory_sources SET metadata_json=:json WHERE document_id=:doc")
      .run({ doc: value.source.documentId, json: '{ "__proto__": {"source": true}, "constructor": "data", "n": 1 }\r\n' });
    old.prepare("UPDATE canonical_memory_units SET metadata_json=:json WHERE memory_id=:memory")
      .run({ memory: value.record.unit.memoryId, json: '{\n "__proto__":{"unit": true}, "number": 2, "text": "2", "empty": "" }\r\n' });
    const editInput = { epochId: value.epochId, bankId: value.bankId, memoryId: value.record.unit.memoryId,
      expectedRevision: value.record.unit.revision, requestId: "historical-edit", requestHash: "a".repeat(64),
      now: "2026-08-22T00:01:00.000Z", patch: { text: "A historical activity fact" }, searchTerms: "historical activity fact",
      policy: { layerId: "activity", visibility: "retrieved" as const, retention: { kind: "rolling-window" as const, days: 7 } } };
    const historical = createCanonicalMemoryRepo(old).edit(editInput);
    const before = { history: historyBytes(old), current: currentRows(old), receipts: migrationReceipts(old) }; old.close();
    const applied: number[][] = []; const upgraded = open(file, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([[41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57]]);
    expect(historyBytes(upgraded)).toEqual(before.history);
    expect(currentRows(upgraded)).toEqual({ ...before.current,
      memory_authority_selection: before.current.memory_authority_selection!.map((row) => ({ ...row, transition_receipt_id: null })) });
    expect(migrationReceipts(upgraded).filter((row) => Number(row.version) <= 40)).toEqual(before.receipts);
    const records = createCanonicalMemoryRepo(upgraded);
    expect(records.edit(editInput)).toEqual(historical);
    createCanonicalMemoryMaintenanceRepo(upgraded).hardDeleteRolling({ epochId: value.epochId, bankId: value.bankId,
      characterId: null, memoryId: value.record.unit.memoryId, expectedRevision: historical.record.unit.revision,
      requestId: "retention", now: "2026-09-10T00:00:00.000Z" });
    expect(records.record(value.epochId, value.bankId, value.record.unit.memoryId)).toBeUndefined();
    expect(records.edit(editInput)).toEqual(historical);
    const after = historyBytes(upgraded); upgraded.close();
    const reopened = open(file, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([[41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57], []]);
    expect(historyBytes(reopened)).toEqual(after);
    expect(createCanonicalMemoryRepo(reopened).edit(editInput)).toEqual(historical);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preserves completed, claimed and unclaimed primary witnesses with their epoch and completion boundary on reopen", () => {
    const file = path();
    const db = open(file);
    const fixture = createCanonicalMaintenanceFixture(db);
    const scope = { epochId: fixture.epochId, characterId: "a" };
    const now = "2026-09-11T00:00:00.000Z";
    const timeline = createTimelineRepo(db);
    const journal = createCanonicalIngestionRepo({ db, maintenance: fixture.maintenance });
    journal.initializeBaseline({ ...scope, throughSeq: 0, now });
    for (let index = 0; index < 3; index += 1) {
      const entries = [timeline.append({ characterId: "a", role: "user", content: `Primary source ${index}` }),
        timeline.append({ characterId: "a", role: "assistant", content: `Primary reply ${index}` })];
      journal.recordPrimaryCommitted({ characterId: "a", entries, runId: `primary-${index}` });
      if (index === 2) continue;
      const source = sanitizeCommittedPrimarySpan({ characterId: "a", fromSeq: entries[0]!.seq - 1,
        throughSeq: entries[1]!.seq, entries: journal.pendingEntries({ ...scope, throughSeq: entries[1]!.seq }) });
      let state = journal.start({ ...scope, source, now });
      if (index === 0) {
        state = journal.saveGate({ state, gate: { decision: "skip" }, now });
        journal.complete({ state, now });
      }
    }
    const witnesses = db.prepare("SELECT * FROM canonical_memory_primary_commits ORDER BY timeline_seq").all();
    const spans = db.prepare("SELECT * FROM canonical_memory_ingestion_spans ORDER BY from_seq").all();
    expect(witnesses.map((row) => row.committed_through_seq)).toEqual([2, 2, 4, 4, 6, 6]);
    expect(witnesses.map((row) => row.authority_epoch_id)).toEqual(Array(6).fill(fixture.epochId));
    db.close();
    const applied: number[][] = [];
    const reopened = open(file, MIGRATIONS, (versions) => applied.push(versions));
    const resumed = createCanonicalIngestionRepo({ db: reopened, maintenance: createCanonicalMemoryMaintenanceRepo(reopened) });
    expect(applied).toEqual([[]]);
    expect(reopened.prepare("SELECT * FROM canonical_memory_primary_commits ORDER BY timeline_seq").all()).toEqual(witnesses);
    expect(reopened.prepare("SELECT * FROM canonical_memory_ingestion_spans ORDER BY from_seq").all()).toEqual(spans);
    expect(resumed.cursor(scope)).toBe(2);
    expect(resumed.pending(scope)?.source.proofs.map((proof) => proof.seq)).toEqual([3, 4]);
    expect(resumed.pendingEntries({ ...scope, throughSeq: 6 }).map((proof) => proof.entry.seq)).toEqual([5, 6]);
    expect(resumed.unprocessedCount(scope)).toBe(2);
    expect(() => reopened.exec("UPDATE canonical_memory_primary_commits SET authority_epoch_id='unknown' WHERE timeline_seq=5")).toThrow();
    expect(() => reopened.exec("UPDATE canonical_memory_primary_commits SET committed_through_seq=4 WHERE timeline_seq=5")).toThrow();
    expect(reopened.prepare("SELECT * FROM canonical_memory_primary_commits ORDER BY timeline_seq").all()).toEqual(witnesses);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each([
    "CREATE INDEX unknown_history_index ON canonical_memory_revision_snapshots(created_at)",
    "CREATE TRIGGER unknown_history_trigger BEFORE UPDATE ON canonical_memory_operation_receipts BEGIN SELECT RAISE(ABORT,'immutable'); END",
    "CREATE TABLE incoming_history (epoch TEXT,bank TEXT,memory TEXT,revision INTEGER, FOREIGN KEY(epoch,bank,memory,revision) REFERENCES canonical_memory_revision_snapshots(authority_epoch_id,bank_id,memory_id,revision)) STRICT",
    "CREATE VIEW incoming_history_view AS SELECT request_id FROM canonical_memory_operation_receipts",
    "ALTER TABLE canonical_memory_operation_receipts ADD COLUMN unknown_contract TEXT",
  ])("refuses unknown attached or incoming schema contracts without losing their definitions", (sql) => {
    const db = open(":memory:", through040); seedLocalB2CoverageFixture(db); db.exec(sql);
    const before = { schema: schema(db), history: historyBytes(db), current: currentRows(db), receipts: migrationReceipts(db) };
    expect(() => runMigrations(db, [canonicalMemoryMaintenanceMigration041])).toThrow(/migration 41 failed/);
    expect(schema(db)).toEqual(before.schema);
    expect(historyBytes(db)).toEqual(before.history);
    expect(currentRows(db)).toEqual(before.current);
    expect(migrationReceipts(db)).toEqual(before.receipts);
  });

  it.each(["receipt", "commit"] as const)("rolls both rebuilt histories and all new tables back on %s failure", (failure) => {
    const db = open(":memory:", through040); seedLocalB2CoverageFixture(db);
    if (failure === "receipt") db.exec(`CREATE TRIGGER fail_migration_receipt BEFORE INSERT ON migrations
      WHEN NEW.version=41 BEGIN SELECT RAISE(ABORT,'receipt refused'); END`);
    const before = { schema: schema(db), history: historyBytes(db), current: currentRows(db), receipts: migrationReceipts(db) };
    const migration = failure === "receipt" ? canonicalMemoryMaintenanceMigration041 : {
      ...canonicalMemoryMaintenanceMigration041, sql: `${canonicalMemoryMaintenanceMigration041.sql}
        CREATE TABLE deferred_parent (id TEXT PRIMARY KEY) STRICT;
        CREATE TABLE deferred_child (id TEXT REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED) STRICT;
        INSERT INTO deferred_child VALUES ('missing');`,
    };
    expect(() => runMigrations(db, [migration])).toThrow(/migration 41 failed/);
    expect(schema(db)).toEqual(before.schema);
    expect(historyBytes(db)).toEqual(before.history);
    expect(currentRows(db)).toEqual(before.current);
    expect(migrationReceipts(db)).toEqual(before.receipts);
    if (failure === "receipt") db.exec("DROP TRIGGER fail_migration_receipt");
    expect(runMigrations(db, [canonicalMemoryMaintenanceMigration041])).toEqual([41]);
  });
});
