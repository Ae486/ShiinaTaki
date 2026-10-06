import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { memoryTransitionPublicationMigration054 } from "./054-memory-transition-publication.ts";

function markerBytes(db: Database) {
  return db.prepare(`SELECT singleton,mode,hex(CAST(active_epoch_id AS BLOB)) AS epoch,
    hex(CAST(verified_snapshot_id AS BLOB)) AS snapshot,hex(CAST(activation_transaction_id AS BLOB)) AS activation,
    hex(CAST(provider_lineage_id AS BLOB)) AS lineage,hex(CAST(replica_checkpoint_digest AS BLOB)) AS digest,
    hex(CAST(updated_at AS BLOB)) AS updated FROM memory_authority_selection`).all();
}

function seed(db: Database, mode: "legacy-markdown" | "canonical-local" | "hindsight") {
  const at = "2026-08-23T00:00:00.000Z";
  db.exec(`INSERT INTO canonical_memory_authority_epochs VALUES
    ('local-epoch','local','local-lineage','closed',NULL,'${at}','${at}','initial-local'),
    ('native-epoch','hindsight','native-lineage','active','local-epoch','${at}',NULL,'planned-switch');
    INSERT INTO memory_migration_runs(run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('historical-run','sha256:snapshot','activated','completed','${at}','${at}',1);
    INSERT INTO memory_migration_activation_receipts VALUES
      ('historical-run','historical-b2','sha256:snapshot','${"a".repeat(64)}','${"b".repeat(64)}','local-epoch',1,'${at}','canonical-local');
    INSERT INTO hindsight_authority_activation_receipts VALUES
      ('historical-b4','historical-run','local-epoch','native-epoch','native-lineage','${"a".repeat(64)}','${"b".repeat(64)}',1,1,'${at}');`);
  db.prepare(`UPDATE memory_authority_selection SET mode=:mode,active_epoch_id=:epoch,verified_snapshot_id=:snapshot,
    activation_transaction_id=:activation,provider_lineage_id=:lineage,replica_checkpoint_digest=:digest,updated_at=:at`)
    .run({ mode, epoch: mode === "legacy-markdown" ? null : mode === "canonical-local" ? "local-epoch" : "native-epoch",
      snapshot: mode === "canonical-local" ? "sha256:original 🐈\r\n" : null,
      activation: mode === "legacy-markdown" ? null : mode === "canonical-local" ? "historical-b2" : "historical-b4",
      lineage: mode === "hindsight" ? "native-lineage" : null, digest: mode === "hindsight" ? "b".repeat(64) : null, at });
}

function history(db: Database) {
  return ["memory_migration_activation_receipts", "hindsight_authority_activation_receipts", "canonical_memory_authority_epochs"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}

describe("054 explicit transition publication lineage", () => {
  it.each(["legacy-markdown", "canonical-local", "hindsight"] as const)("preserves %s marker bytes and both old receipt histories through upgrade/reopen", (mode) => {
    const path = join(mkdtempSync(join(tmpdir(), "taki-w4-migration-")), "database.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= 53) });
    seed(db, mode); const marker = markerBytes(db); const old = history(db);
    const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all(); db.close();
    const applied: number[][] = [];
    db = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) });
    expect(applied).toEqual([[54, 55, 56, 57]]); expect(markerBytes(db)).toEqual(marker); expect(history(db)).toEqual(old);
    expect(db.prepare("SELECT transition_receipt_id FROM memory_authority_selection").get()?.transition_receipt_id).toBeNull();
    expect(db.prepare("SELECT * FROM migrations WHERE version<=53 ORDER BY version").all()).toEqual(receipts);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]); db.close();
    db = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) });
    try { expect(applied).toEqual([[54, 55, 56, 57], []]); expect(markerBytes(db)).toEqual(marker); expect(history(db)).toEqual(old); }
    finally { db.close(); }
  });

  it.each(["unknown-schema", "sql-failure", "receipt-failure", "commit-failure"])("refuses %s atomically without rewriting the old marker", (failure) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((migration) => migration.version <= 53) });
    try {
      seed(db, "hindsight"); const marker = markerBytes(db); const old = history(db);
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      if (failure === "unknown-schema") db.exec("CREATE INDEX unknown_marker_owner ON memory_authority_selection(mode)");
      if (failure === "receipt-failure") db.exec("CREATE TRIGGER fail_054 BEFORE INSERT ON migrations WHEN NEW.version=54 BEGIN SELECT RAISE(ABORT,'owned failure'); END");
      if (failure === "commit-failure") db.exec(`CREATE TABLE w4_parent(id TEXT PRIMARY KEY);
        CREATE TABLE w4_child(id TEXT REFERENCES w4_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_054 AFTER INSERT ON migrations WHEN NEW.version=54 BEGIN INSERT INTO w4_child VALUES('missing'); END`);
      const migration = failure === "sql-failure" ? { ...memoryTransitionPublicationMigration054,
        sql: memoryTransitionPublicationMigration054.sql + "INSERT INTO missing_w4_table VALUES(1);" } : memoryTransitionPublicationMigration054;
      expect(() => runMigrations(db, [migration])).toThrow();
      expect(markerBytes(db)).toEqual(marker); expect(history(db)).toEqual(old);
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(receipts);
      expect(db.prepare("PRAGMA table_info(memory_authority_selection)").all().map((row) => row.name)).not.toContain("transition_receipt_id");
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('memory_authority_selection_pre_054','memory_transition_publications')").all()).toEqual([]);
    } finally { db.close(); }
  });
});
