import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { createCanonicalMemoryAuthorityRepo } from "../canonical-memory-authority-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightIngestionMigration043 } from "./043-hindsight-ingestion.ts";

const cleanup: Array<() => void> = [];
const through43 = MIGRATIONS.filter((migration) => migration.version <= 43);
const before43 = through43.filter((migration) => migration.version < 43);
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function path() {
  const root = mkdtempSync(join(tmpdir(), "taki-hindsight-ingestion-migration-"));
  cleanup.push(() => rmTempDir(root)); return join(root, "memory.sqlite");
}
function open(file: string, migrations = before43, onMigrated?: (versions: number[]) => void) {
  const db = openDatabase({ path: file, migrations, onMigrated }); cleanup.push(() => db.close()); return db;
}
function names(db: Database) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'hindsight_ingestion_%' ORDER BY name").all().map((row) => row.name);
}

describe("migration 043 Hindsight ingestion", () => {
  it("creates independent source/coverage tables on a fresh database and reopens without reapplying", () => {
    const file = path(); let applied: number[] = [];
    const first = open(file, through43, (versions) => { applied = versions; });
    expect(applied).toContain(43);
    expect(names(first)).toEqual(["hindsight_ingestion_cursors", "hindsight_ingestion_one_pending",
      "hindsight_ingestion_primary_character", "hindsight_ingestion_primary_commits", "hindsight_ingestion_spans"]);
    first.close(); applied = [43];
    const second = open(file, through43, (versions) => { applied = versions; });
    expect(applied).toEqual([]); expect(second.prepare("SELECT COUNT(*) AS n FROM hindsight_ingestion_spans").get()?.n).toBe(0);
  });

  it("preserves existing Local ingestion schema and stored JSON bytes across the additive upgrade", () => {
    const file = path(); const first = open(file); const epoch = createCanonicalMemoryAuthorityRepo(first).initializeLocalAuthority("2026-09-11T00:00:00.000Z");
    const historical = '{ "original": null, "empty": [], "text": "{\\"typed\\":false}" }';
    first.prepare(`INSERT INTO canonical_memory_ingestion_spans
      (authority_epoch_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,gate_json,extraction_json,
       bank_receipts_json,state,revision,created_at,updated_at)
      VALUES (:epoch,'taki','historical',0,2,:hash,:source,NULL,NULL,'[]','pending',1,:at,:at)`)
      .run({ epoch: epoch.epochId, hash: "a".repeat(64), source: historical, at: "2026-09-11T00:00:00.000Z" });
    const rows = first.prepare("SELECT * FROM canonical_memory_ingestion_spans").all();
    const schema = first.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'canonical_memory_ingestion_%' ORDER BY name").all();
    first.close(); const second = open(file, through43);
    expect(second.prepare("SELECT * FROM canonical_memory_ingestion_spans").all()).toEqual(rows);
    expect(second.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'canonical_memory_ingestion_%' ORDER BY name").all()).toEqual(schema);
    expect(second.prepare("SELECT source_json FROM canonical_memory_ingestion_spans").get()?.source_json).toBe(historical);
  });

  it("rolls back every new table and the version receipt when the migration transaction fails", () => {
    const db = open(":memory:");
    expect(() => runMigrations(db, [{ ...hindsightIngestionMigration043,
      sql: `${hindsightIngestionMigration043.sql}\nINSERT INTO deliberately_absent_ingestion_table VALUES (1);` }])).toThrow();
    expect(names(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM migrations WHERE version=43").get()).toBeUndefined();
    expect(runMigrations(db, [hindsightIngestionMigration043])).toEqual([43]);
    expect(names(db)).toHaveLength(5);
  });
});
