import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { primaryEntryDigest } from "../../memory/canonical-ingestion-source.ts";
import { createCanonicalMemoryAuthorityRepo } from "../canonical-memory-authority-repo.ts";
import { createTimelineRepo } from "../timeline-repo.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";
import { primaryConversationSourcesMigration064 } from "./064-primary-conversation-sources.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const before64 = MIGRATIONS.filter(({ version }) => version < 64);
function open(path: string, migrations = MIGRATIONS) {
  const db = openDatabase({ path, migrations }); cleanup.push(() => db.close()); return db;
}
const tables = ["canonical_memory_primary_commits", "hindsight_ingestion_primary_commits",
  "canonical_memory_ingestion_spans", "hindsight_ingestion_spans", "canonical_memory_operation_receipts"];
function history(db: Database) { return tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()); }
function seedHistory(db: Database) {
  const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority();
  const timeline = createTimelineRepo(db); const at = "2026-10-01T00:00:00.000Z";
  const raw = '{ "historical": "unaltered", "empty": [], "nested": {"n":1} }\r\n';
  for (const [index, table] of ["canonical_memory_primary_commits", "hindsight_ingestion_primary_commits"].entries()) {
    const entry = timeline.append({ characterId: "taki", role: "user", content: `Original ${index}` });
    db.prepare(`INSERT INTO ${table}
      (timeline_seq,character_id,entry_id,entry_digest,run_id,committed_at,committed_through_seq,authority_epoch_id)
      VALUES (:seq,'taki',:id,:digest,'historical-run',:at,:seq,:epoch)`)
      .run({ seq: entry.seq, id: entry.id, digest: primaryEntryDigest(entry), at, epoch: epoch.epochId });
  }
  db.prepare(`INSERT INTO canonical_memory_ingestion_spans
    (authority_epoch_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,gate_json,
     extraction_json,bank_receipts_json,state,revision,created_at,updated_at)
    VALUES (:epoch,'taki','local',0,1,:hash,:raw,:raw,:raw,:raw,'complete',1,:at,:at)`)
    .run({ epoch: epoch.epochId, hash: "a".repeat(64), raw, at });
  db.prepare(`INSERT INTO hindsight_ingestion_spans
    (authority_epoch_id,provider_lineage_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,
     gate_json,batches_json,receipts_json,state,revision,created_at,updated_at)
    VALUES (:epoch,:lineage,'taki','hindsight',1,2,:hash,:raw,:raw,:array,:array,'complete',1,:at,:at)`)
    .run({ epoch: epoch.epochId, lineage: epoch.providerLineageId, hash: "b".repeat(64), raw, array: `[ ${raw} ]`, at });
  db.prepare(`INSERT INTO canonical_memory_operation_receipts
    (authority_epoch_id,request_id,operation,request_hash,result_json,created_at)
    VALUES (:epoch,'old-request','retain',:hash,:raw,:at)`)
    .run({ epoch: epoch.epochId, hash: "c".repeat(64), raw, at });
  timeline.append({ characterId: "taki", role: "user", content: "Old unknown provenance stays unknown" });
}

it("reopens the 063 history without modifying old Local/Hindsight proof, receipt, or Timeline bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-064-")); cleanup.push(() => rmTempDir(root));
  const path = join(root, "state.db"); const before = open(path, before64); seedHistory(before);
  const originalHistory = history(before); const originalRows = before.prepare("SELECT * FROM timeline_messages").all();
  const receipts = before.prepare("SELECT * FROM migrations ORDER BY version").all(); before.close();
  const upgraded = open(path);
  expect(history(upgraded)).toEqual(originalHistory);
  expect(upgraded.prepare("SELECT * FROM migrations WHERE version<64 ORDER BY version").all()).toEqual(receipts);
  const oldColumns = Object.keys(originalRows[0]!).join(",");
  expect(upgraded.prepare(`SELECT ${oldColumns} FROM timeline_messages`).all()).toEqual(originalRows);
  expect(upgraded.prepare("SELECT primary_source_id FROM timeline_messages").all()).toEqual(originalRows.map(() => ({ primary_source_id: null })));
  expect(upgraded.prepare("SELECT * FROM primary_conversation_sources").all()).toEqual([]);
  expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]); upgraded.close();
  const reopened = open(path); expect(history(reopened)).toEqual(originalHistory);
  expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
});

it("rolls back the source table, membership column, triggers and migration receipt together", () => {
  const db = open(":memory:", before64);
  expect(() => runMigrations(db, [{ ...primaryConversationSourcesMigration064,
    sql: `${primaryConversationSourcesMigration064.sql}\nINSERT INTO deliberate_missing_table VALUES (1);` }])).toThrow();
  expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'timeline_primary_source_%' OR name LIKE 'primary_conversation_%'").all()).toEqual([]);
  expect(db.prepare("SELECT name FROM pragma_table_info('timeline_messages') WHERE name='primary_source_id'").all()).toEqual([]);
  expect(db.prepare("SELECT * FROM migrations WHERE version=64").all()).toEqual([]);
  expect(runMigrations(db, [primaryConversationSourcesMigration064])).toEqual([64]);
});
