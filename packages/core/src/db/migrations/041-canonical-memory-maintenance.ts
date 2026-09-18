/**
 * INPUT:  existing canonical histories and Core-owned Local maintenance
 * OUTPUT: deletion-independent revision history and one shared request-identity namespace
 * POS:    core/db/migrations — forward-only schema change; prior receipt bytes remain unchanged
 */
import type { Migration, MigrationSchemaObject } from "../migration-runner.ts";

const historicalSchema: readonly MigrationSchemaObject[] = [
  { type: "table", name: "canonical_memory_revision_snapshots", sql: `CREATE TABLE canonical_memory_revision_snapshots (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
 record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'), created_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id,revision),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT` },
  { type: "table", name: "canonical_memory_operation_receipts", sql: `CREATE TABLE canonical_memory_operation_receipts (
 authority_epoch_id TEXT NOT NULL, request_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('retain','edit','invalidate','restore')), request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object'), created_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,request_id), FOREIGN KEY(authority_epoch_id) REFERENCES canonical_memory_authority_epochs(epoch_id), CHECK(length(request_id)>0 AND length(request_hash)=64)
) STRICT` },
];

export const canonicalMemoryMaintenanceMigration041: Migration = {
  version: 41,
  schemaBranches: [{ name: "canonical-017-history", schema: historicalSchema,
    replacedTables: historicalSchema.map(({ name }) => name),
    absentObjects: ["canonical_memory_revision_snapshots_041", "canonical_memory_operation_receipts_041",
      "canonical_memory_retired_sources", "canonical_memory_ingestion_cursors", "canonical_memory_ingestion_spans",
      "canonical_memory_ingestion_one_pending", "canonical_memory_primary_commits", "canonical_memory_primary_commits_character"],
    sql: "SELECT 1;" }],
  sql: `
CREATE TABLE canonical_memory_revision_snapshots_041 (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
 created_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,bank_id,memory_id,revision),
 FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id)
) STRICT;
INSERT INTO canonical_memory_revision_snapshots_041
 (authority_epoch_id,bank_id,memory_id,revision,record_json,created_at)
 SELECT authority_epoch_id,bank_id,memory_id,revision,record_json,created_at
 FROM canonical_memory_revision_snapshots;
DROP TABLE canonical_memory_revision_snapshots;
ALTER TABLE canonical_memory_revision_snapshots_041 RENAME TO canonical_memory_revision_snapshots;

CREATE TABLE canonical_memory_operation_receipts_041 (
 authority_epoch_id TEXT NOT NULL, request_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('retain','edit','invalidate','restore','maintenance')),
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object'),
 created_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,request_id),
 FOREIGN KEY(authority_epoch_id) REFERENCES canonical_memory_authority_epochs(epoch_id),
 CHECK(length(request_id)>0 AND length(request_hash)=64)
) STRICT;
INSERT INTO canonical_memory_operation_receipts_041
 (authority_epoch_id,request_id,operation,request_hash,result_json,created_at)
 SELECT authority_epoch_id,request_id,operation,request_hash,result_json,created_at
 FROM canonical_memory_operation_receipts;
DROP TABLE canonical_memory_operation_receipts;
ALTER TABLE canonical_memory_operation_receipts_041 RENAME TO canonical_memory_operation_receipts;

CREATE TABLE canonical_memory_retired_sources (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, document_id TEXT NOT NULL,
 last_revision INTEGER NOT NULL CHECK(last_revision>=1), deleted_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,document_id),
 FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id)
) STRICT;

CREATE TABLE canonical_memory_ingestion_cursors (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 character_id TEXT NOT NULL, through_seq INTEGER NOT NULL CHECK(through_seq>=0),
 eligibility_start_seq INTEGER NOT NULL CHECK(eligibility_start_seq>=1), updated_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id)
) STRICT;
CREATE TABLE canonical_memory_ingestion_spans (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 character_id TEXT NOT NULL, span_id TEXT NOT NULL, from_seq INTEGER NOT NULL CHECK(from_seq>=0),
 through_seq INTEGER NOT NULL CHECK(through_seq>from_seq), source_hash TEXT NOT NULL,
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 gate_json TEXT CHECK(gate_json IS NULL OR json_valid(gate_json)),
 extraction_json TEXT CHECK(extraction_json IS NULL OR json_valid(extraction_json)),
 bank_receipts_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(bank_receipts_json)),
 state TEXT NOT NULL CHECK(state IN ('pending','complete')), revision INTEGER NOT NULL CHECK(revision>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id,span_id)
) STRICT;
CREATE UNIQUE INDEX canonical_memory_ingestion_one_pending
 ON canonical_memory_ingestion_spans(authority_epoch_id,character_id) WHERE state='pending';
CREATE TABLE canonical_memory_primary_commits (
 timeline_seq INTEGER PRIMARY KEY REFERENCES timeline_messages(seq) ON DELETE CASCADE,
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 character_id TEXT NOT NULL, entry_id TEXT NOT NULL UNIQUE, entry_digest TEXT NOT NULL,
 committed_through_seq INTEGER NOT NULL CHECK(committed_through_seq>=timeline_seq),
 ingestion_span_id TEXT, run_id TEXT, committed_at TEXT NOT NULL
) STRICT;
CREATE INDEX canonical_memory_primary_commits_character
 ON canonical_memory_primary_commits(character_id,timeline_seq);
`,
};
