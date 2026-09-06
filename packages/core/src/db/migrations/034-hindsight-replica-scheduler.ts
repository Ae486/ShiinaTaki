/**
 * INPUT: migration 033's per-Bank replica checkpoint/lease tables
 * OUTPUT: durable scheduling/run state and the current verified one-record snapshot cache
 * POS:    core/db/migrations — additive Wave 2 state; no authority or Pending Memory rows
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightReplicaSchedulerMigration034: Migration = {
  version: 34,
  sql: `
CREATE TABLE hindsight_replica_sync_schedule (
  bank_id TEXT PRIMARY KEY CHECK(length(bank_id) BETWEEN 1 AND 256),
  version INTEGER NOT NULL CHECK(version >= 1),
  state_json TEXT NOT NULL CHECK(json_valid(state_json) AND json_type(state_json)='object' AND length(state_json) <= 16384)
) STRICT;
CREATE TABLE hindsight_replica_sync_snapshot_cache (
  bank_id TEXT NOT NULL CHECK(length(bank_id) BETWEEN 1 AND 256),
  provider_lineage_id TEXT NOT NULL,
  bank_generation TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
  object_id TEXT NOT NULL CHECK(length(object_id) BETWEEN 1 AND 256),
  page_hash TEXT NOT NULL CHECK(length(page_hash)=64 AND page_hash NOT GLOB '*[^0-9a-f]*'),
  record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'),
  record_hash TEXT NOT NULL CHECK(length(record_hash)=64 AND record_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY(bank_id,provider_lineage_id,bank_generation,page_hash)
) STRICT;
CREATE INDEX hindsight_replica_sync_snapshot_cache_objects
  ON hindsight_replica_sync_snapshot_cache(bank_id,object_kind,object_id);
`,
};
