/**
 * INPUT:  the migration registry through version 032
 * OUTPUT: canonical incremental replica, FTS, current checkpoints, and Core-issued Bank leases
 * POS:    core/db/migrations — additive B5 storage; B4 activation receipts remain separate
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightReplicaSyncMigration033: Migration = {
  version: 33,
  sql: `
CREATE TABLE hindsight_replica_sync_records (
  bank_id TEXT NOT NULL CHECK(length(bank_id) BETWEEN 1 AND 256),
  object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
  object_id TEXT NOT NULL CHECK(length(object_id) BETWEEN 1 AND 256),
  object_revision INTEGER NOT NULL CHECK(object_revision >= 1),
  operation TEXT NOT NULL CHECK(operation IN ('upsert','tombstone')),
  record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
  record_hash TEXT NOT NULL CHECK(length(record_hash)=64 AND record_hash NOT GLOB '*[^0-9a-f]*'),
  source_cursor INTEGER CHECK(source_cursor IS NULL OR source_cursor >= 1),
  PRIMARY KEY(bank_id,object_kind,object_id)
) STRICT;
CREATE VIRTUAL TABLE hindsight_replica_sync_fts USING fts5(
  bank_id UNINDEXED, object_id UNINDEXED, text, context, disclosure, search_terms, tokenize='unicode61'
);
CREATE TABLE hindsight_replica_sync_checkpoints (
  bank_id TEXT PRIMARY KEY CHECK(length(bank_id) BETWEEN 1 AND 256),
  provider_lineage_id TEXT NOT NULL,
  bank_generation TEXT NOT NULL,
  authority_epoch_id TEXT NOT NULL CHECK(length(authority_epoch_id) BETWEEN 1 AND 256),
  replica_epoch_id TEXT NOT NULL,
  end_cursor INTEGER NOT NULL CHECK(end_cursor >= 0),
  snapshot_id TEXT NOT NULL,
  snapshot_cursor INTEGER NOT NULL CHECK(snapshot_cursor >= 0 AND snapshot_cursor <= end_cursor),
  snapshot_manifest_digest TEXT NOT NULL CHECK(length(snapshot_manifest_digest)=64 AND snapshot_manifest_digest NOT GLOB '*[^0-9a-f]*'),
  manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
  verified_at TEXT NOT NULL
) STRICT;
CREATE TABLE hindsight_replica_sync_leases (
  bank_id TEXT PRIMARY KEY CHECK(length(bank_id) BETWEEN 1 AND 256),
  run_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 256),
  fence INTEGER NOT NULL CHECK(fence >= 1),
  expires_at TEXT NOT NULL
) STRICT;
`,
};
