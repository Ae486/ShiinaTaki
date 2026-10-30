/**
 * INPUT:  existing Timeline, authority epochs and the durable B5 Pending outbox
 * OUTPUT: independent Hindsight source witnesses, ingestion plans and source-coverage receipts
 * POS:    core/db/migrations — additive version 43; no Local history or Pending wire changes
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightIngestionMigration043: Migration = {
  version: 43,
  sql: `
CREATE TABLE hindsight_ingestion_cursors (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 character_id TEXT NOT NULL, through_seq INTEGER NOT NULL CHECK(through_seq>=0),
 eligibility_start_seq INTEGER NOT NULL CHECK(eligibility_start_seq>=1), updated_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id)
) STRICT;
CREATE TABLE hindsight_ingestion_spans (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 provider_lineage_id TEXT NOT NULL, character_id TEXT NOT NULL, span_id TEXT NOT NULL,
 from_seq INTEGER NOT NULL CHECK(from_seq>=0), through_seq INTEGER NOT NULL CHECK(through_seq>from_seq),
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64), source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 gate_json TEXT CHECK(gate_json IS NULL OR json_valid(gate_json)),
 batches_json TEXT NOT NULL CHECK(json_valid(batches_json) AND json_type(batches_json)='array'),
 receipts_json TEXT NOT NULL CHECK(json_valid(receipts_json) AND json_type(receipts_json)='array'),
 state TEXT NOT NULL CHECK(state IN ('pending','complete')), revision INTEGER NOT NULL CHECK(revision>=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id,span_id)
) STRICT;
CREATE UNIQUE INDEX hindsight_ingestion_one_pending
 ON hindsight_ingestion_spans(authority_epoch_id,character_id) WHERE state='pending';
CREATE TABLE hindsight_ingestion_primary_commits (
 timeline_seq INTEGER PRIMARY KEY REFERENCES timeline_messages(seq) ON DELETE CASCADE,
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 character_id TEXT NOT NULL, entry_id TEXT NOT NULL UNIQUE, entry_digest TEXT NOT NULL CHECK(length(entry_digest)=64),
 committed_through_seq INTEGER NOT NULL CHECK(committed_through_seq>=timeline_seq),
 ingestion_span_id TEXT, run_id TEXT, committed_at TEXT NOT NULL,
 FOREIGN KEY(authority_epoch_id,character_id,ingestion_span_id)
  REFERENCES hindsight_ingestion_spans(authority_epoch_id,character_id,span_id)
) STRICT;
CREATE INDEX hindsight_ingestion_primary_character
 ON hindsight_ingestion_primary_commits(authority_epoch_id,character_id,timeline_seq);
`,
};
