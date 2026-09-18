import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createIntlSegmenterTokenizer } from "../../memory/search-tokenizer.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE } from "../../testing/hindsight-application-fixtures.ts";
import { createReplicaRecordStore } from "../hindsight-replica-record-store.ts";
import { publishReplicaCheckpoint } from "../hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaLeaseRepo } from "../hindsight-replica-lease-repo.ts";
import { createStructuredMemoryBlockRepo } from "../structured-memory-block-repo.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightApplicationStateMigration042 } from "./042-hindsight-application-state.ts";

const through42 = MIGRATIONS.filter(({ version }) => version <= 42);
const before42 = through42.filter(({ version }) => version < 42);
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

describe("migration 042 application replica state", () => {
  it("creates independent evidence/checkpoint/projection storage and reopens without reapplying", () => {
    const file = tempPath(); let applied: number[] = [];
    const first = open(file, through42, (versions) => { applied = versions; });
    expect(applied).toEqual(through42.map(({ version }) => version));
    expect(names(first.db)).toEqual([
      "hindsight_application_replica_artifacts", "hindsight_application_replica_block_restores", "hindsight_application_replica_bodies",
      "hindsight_application_replica_checkpoints", "hindsight_application_replica_heads", "hindsight_application_replica_projections",
      "hindsight_application_replica_publication_pages", "hindsight_application_replica_publications", "hindsight_application_replica_work",
    ]);
    expect(first.db.prepare("SELECT type FROM pragma_table_info('hindsight_application_replica_projections') WHERE name='record_bytes'")
      .get()?.type).toBe("BLOB");
    expect(first.db.prepare("SELECT on_delete FROM pragma_foreign_key_list('hindsight_application_replica_artifacts')")
      .all().every((row) => row.on_delete === "NO ACTION")).toBe(true);
    first.close(); applied = [42];
    const second = open(file, through42, (versions) => { applied = versions; });
    expect(applied).toEqual([]); expect(names(second.db)).toHaveLength(9);
    expect(second.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preserves prior B5 rows, native checkpoints, leases, Blocks and migration receipt bytes", () => {
    const file = tempPath(); const old = open(file); const db = old.db;
    const { bankId, namespace } = APPLICATION_TEST_SCOPE; const at = APPLICATION_TEST_AT;
    const records = createReplicaRecordStore(db, createIntlSegmenterTokenizer({ stoplist: true }));
    records.write({ bankId, objectKind: "bank", objectId: bankId, objectRevision: 1, operation: "upsert", payload: { kind: "bank", value: {
      authorityEpochId: "historical-epoch", bankId, scope: { kind: "global", characterId: null }, name: "Historical Bank",
      disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: { literal: "{\"value\":false}", empty: [], nullable: null },
      revision: 1, createdAt: at, updatedAt: at,
    } } }, 2);
    db.exec("UPDATE hindsight_replica_sync_records SET record_json=record_json||char(13)||char(10)||' '");
    publishReplicaCheckpoint(db, { previous: null, next: { bankId, providerLineageId: namespace.provider_lineage,
      bankGeneration: namespace.bank_generation, authorityEpochId: "historical-epoch", replicaEpochId: namespace.bank_generation,
      snapshotId: namespace.provider_lineage, snapshotCursor: 2, endCursor: 2, snapshotManifestDigest: "a".repeat(64),
      manifestDigest: records.digest(bankId), verifiedAt: at } });
    createHindsightReplicaLeaseRepo(db, () => at).acquire({ bankId, ownerId: "historical-owner", durationMs: 60_000 });
    createStructuredMemoryBlockRepo(db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
      actor: "user", content: "Existing owner card", now: at });
    const tables = ["hindsight_replica_sync_records", "hindsight_replica_sync_checkpoints", "hindsight_replica_sync_leases", "taki_memory_blocks"];
    const rows = tableRows(db, tables); const history = db.prepare("SELECT * FROM migrations ORDER BY version").all();
    old.close(); let applied: number[] = [];
    const upgraded = open(file, through42, (versions) => { applied = versions; });
    expect(applied).toEqual([42]); expect(tableRows(upgraded.db, tables)).toEqual(rows);
    expect(upgraded.db.prepare("SELECT * FROM migrations WHERE version<42 ORDER BY version").all()).toEqual(history);
    expect(createReplicaRecordStore(upgraded.db, createIntlSegmenterTokenizer({ stoplist: true }))
      .get({ bankId, objectKind: "bank", objectId: bankId })?.payload?.kind).toBe("bank");
  });

  it.each(["ddl", "receipt", "commit"] as const)("rolls back every new object and its receipt on %s failure", (failure) => {
    const { db } = open(":memory:");
    if (failure === "receipt") db.exec(`CREATE TRIGGER fail_application_migration BEFORE INSERT ON migrations
      WHEN NEW.version=42 BEGIN SELECT RAISE(ABORT,'injected migration receipt failure'); END;`);
    const suffix = failure === "ddl" ? "INSERT INTO absent_application_table VALUES (1);" : failure === "commit" ? `
      CREATE TABLE application_deferred_parent(id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE application_deferred_child(id TEXT REFERENCES application_deferred_parent(id) DEFERRABLE INITIALLY DEFERRED) STRICT;
      INSERT INTO application_deferred_child VALUES ('absent');` : "";
    expect(() => runMigrations(db, [{ ...hindsightApplicationStateMigration042,
      sql: `${hindsightApplicationStateMigration042.sql}\n${suffix}` }])).toThrow(/migration 42 failed/);
    expect(names(db)).toEqual([]);
    expect(db.prepare("SELECT * FROM migrations WHERE version=42").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'application_deferred_%'").all()).toEqual([]);
    if (failure === "receipt") db.exec("DROP TRIGGER fail_application_migration");
    expect(runMigrations(db, [hindsightApplicationStateMigration042])).toEqual([42]);
    expect(names(db)).toHaveLength(9);
  });
});

function names(db: Database) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'hindsight_application_replica_%' ORDER BY name").all().map((row) => row.name);
}
function tableRows(db: Database, tables: string[]) {
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function tempPath() {
  const root = mkdtempSync(join(tmpdir(), "taki-application-migration-"));
  cleanup.push(() => {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("taki-application-migration-")) throw new Error("unsafe fixture path");
    rmTempDir(target);
  });
  return join(root, "memory.sqlite");
}
function open(path: string, migrations = before42, onMigrated?: (versions: number[]) => void) {
  const db = openDatabase({ path, migrations, onMigrated }); let closed = false;
  const close = () => { if (!closed) { closed = true; db.close(); } }; cleanup.push(close);
  return { db, close };
}
