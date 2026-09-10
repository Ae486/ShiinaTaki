/**
 * INPUT:  recognized early/current 023 SQLite definitions, without application rows
 * OUTPUT: explicit immutable schema signatures and current durable B4 DDL for migration 040
 * POS:    core/db/migrations — append-only convergence definitions; never replays or changes migrations 001-039
 */
import type { MigrationSchemaObject } from "../migration-runner.ts";

const importIndexes: readonly MigrationSchemaObject[] = [
  { type: "index", name: "idx_hindsight_import_operations_status", sql: `CREATE INDEX idx_hindsight_import_operations_status
 ON hindsight_import_operations(run_id,status);` },
  { type: "index", name: "idx_hindsight_import_facts_source", sql: `CREATE INDEX idx_hindsight_import_facts_source
 ON hindsight_import_facts(run_id,source_id,fact_ordinal);` },
];

// These are full declarations, rather than column-name probes: older CHECK, FK and uniqueness semantics
// matter just as much as the missing columns. Unrecognized near-matches require a separately proven migration.
export const earlyHindsightCutoverSchema040: readonly MigrationSchemaObject[] = [
  { type: "table", name: "memory_authority_selection", sql: `CREATE TABLE memory_authority_selection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 mode TEXT NOT NULL CHECK(mode IN ('legacy-markdown','canonical-local')), active_epoch_id TEXT,
 verified_snapshot_id TEXT, activation_transaction_id TEXT, updated_at TEXT NOT NULL,
 CHECK((mode='legacy-markdown' AND active_epoch_id IS NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NULL)
    OR (mode='canonical-local' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NOT NULL AND activation_transaction_id IS NOT NULL))
) STRICT;` },
  { type: "table", name: "hindsight_import_operations", sql: `CREATE TABLE hindsight_import_operations (
 run_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 bank_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 operation_identity TEXT NOT NULL,
 remote_operation_id TEXT NOT NULL,
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 attempt_no INTEGER NOT NULL DEFAULT 0 CHECK(attempt_no>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','submitted','processing','completed','mapped','failed','cancelled','conflict','excluded')),
 operation_result_hash TEXT,
 derived_unit_count INTEGER CHECK(derived_unit_count IS NULL OR derived_unit_count>=0),
 extraction_error_count INTEGER CHECK(extraction_error_count IS NULL OR extraction_error_count>=0),
 mapping_complete INTEGER NOT NULL DEFAULT 0 CHECK(mapping_complete IN (0,1)),
 zero_fact_allowed INTEGER NOT NULL DEFAULT 0 CHECK(zero_fact_allowed IN (0,1)),
 diagnostic_code TEXT CHECK(diagnostic_code IS NULL OR length(diagnostic_code)<=64),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE,
 UNIQUE(run_id,operation_identity),
 UNIQUE(run_id,remote_operation_id)
) STRICT;` },
  { type: "table", name: "hindsight_import_facts", sql: `CREATE TABLE hindsight_import_facts (
 run_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 fact_ordinal INTEGER NOT NULL CHECK(fact_ordinal>=0),
 fact_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 PRIMARY KEY(run_id,source_id,fact_ordinal),
 UNIQUE(run_id,fact_id),
 FOREIGN KEY(run_id,source_id) REFERENCES hindsight_import_operations(run_id,source_id) ON DELETE CASCADE
) STRICT;` },
  ...importIndexes,
];

export const currentHindsightCutoverSchema040: readonly MigrationSchemaObject[] = [
  { type: "table", name: "memory_authority_selection", sql: `CREATE TABLE memory_authority_selection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 mode TEXT NOT NULL CHECK(mode IN ('legacy-markdown','canonical-local','hindsight')),
 active_epoch_id TEXT,
 verified_snapshot_id TEXT,
 activation_transaction_id TEXT,
 provider_lineage_id TEXT,
 replica_checkpoint_digest TEXT CHECK(replica_checkpoint_digest IS NULL OR (length(replica_checkpoint_digest)=64 AND replica_checkpoint_digest NOT GLOB '*[^a-f0-9]*')),
 updated_at TEXT NOT NULL,
 CHECK((mode='legacy-markdown' AND active_epoch_id IS NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NULL AND provider_lineage_id IS NULL AND replica_checkpoint_digest IS NULL)
    OR (mode='canonical-local' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NOT NULL AND activation_transaction_id IS NOT NULL AND provider_lineage_id IS NULL AND replica_checkpoint_digest IS NULL)
    OR (mode='hindsight' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NOT NULL AND provider_lineage_id IS NOT NULL AND replica_checkpoint_digest IS NOT NULL))
) STRICT;` },
  { type: "table", name: "hindsight_cutover_runs", sql: `CREATE TABLE hindsight_cutover_runs (
 run_id TEXT PRIMARY KEY REFERENCES memory_migration_runs(run_id),
 expected_predecessor_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 phase TEXT NOT NULL CHECK(phase IN ('importing','replica-verified','ready','activated','failed')),
 status TEXT NOT NULL CHECK(status IN ('running','ready','completed','failed')),
 config_fingerprint TEXT CHECK(config_fingerprint IS NULL OR (length(config_fingerprint)=64 AND config_fingerprint NOT GLOB '*[^a-f0-9]*')),
 checkpoint_set_digest TEXT CHECK(checkpoint_set_digest IS NULL OR (length(checkpoint_set_digest)=64 AND checkpoint_set_digest NOT GLOB '*[^a-f0-9]*')),
 lease_owner TEXT,
 lease_fence INTEGER NOT NULL DEFAULT 0 CHECK(lease_fence>=0),
 lease_expires_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((phase='importing' AND status='running' AND config_fingerprint IS NULL AND checkpoint_set_digest IS NULL)
    OR (phase='replica-verified' AND status='running' AND config_fingerprint IS NULL AND checkpoint_set_digest IS NULL)
    OR (phase='ready' AND status='ready' AND config_fingerprint IS NOT NULL AND checkpoint_set_digest IS NOT NULL)
    OR (phase='activated' AND status='completed' AND config_fingerprint IS NOT NULL AND checkpoint_set_digest IS NOT NULL)
    OR (phase='failed' AND status='failed'))
) STRICT;` },
  { type: "table", name: "hindsight_import_operations", sql: `CREATE TABLE hindsight_import_operations (
 run_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 bank_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 operation_identity TEXT NOT NULL,
 remote_operation_id TEXT NOT NULL,
 content_identity TEXT NOT NULL CHECK(length(content_identity)=71 AND substr(content_identity,1,7)='sha256:' AND substr(content_identity,8) NOT GLOB '*[^a-f0-9]*'),
 provider_content_hash TEXT NOT NULL CHECK(length(provider_content_hash)=64 AND provider_content_hash NOT GLOB '*[^a-f0-9]*'),
 lease_fence INTEGER NOT NULL CHECK(lease_fence>=1),
 attempt_no INTEGER NOT NULL DEFAULT 0 CHECK(attempt_no>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','submitted','processing','completed','mapped','failed','cancelled','conflict','excluded')),
 operation_result_hash TEXT CHECK(operation_result_hash IS NULL OR (length(operation_result_hash)=64 AND operation_result_hash NOT GLOB '*[^a-f0-9]*')),
 derived_unit_count INTEGER CHECK(derived_unit_count IS NULL OR derived_unit_count>=0),
 extraction_error_count INTEGER CHECK(extraction_error_count IS NULL OR extraction_error_count>=0),
 mapping_complete INTEGER NOT NULL DEFAULT 0 CHECK(mapping_complete IN (0,1)),
 zero_fact_allowed INTEGER NOT NULL DEFAULT 0 CHECK(zero_fact_allowed IN (0,1)),
 diagnostic_code TEXT CHECK(diagnostic_code IS NULL OR length(diagnostic_code)<=64),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE,
 UNIQUE(run_id,operation_identity),
 UNIQUE(run_id,remote_operation_id)
) STRICT;` },
  { type: "table", name: "hindsight_import_facts", sql: `CREATE TABLE hindsight_import_facts (
 run_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 fact_ordinal INTEGER NOT NULL CHECK(fact_ordinal>=0),
 fact_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
 PRIMARY KEY(run_id,source_id,fact_ordinal),
 UNIQUE(run_id,fact_id),
 FOREIGN KEY(run_id,source_id) REFERENCES hindsight_import_operations(run_id,source_id) ON DELETE CASCADE
) STRICT;` },
  ...importIndexes,
  { type: "table", name: "hindsight_replica_staging_runs", sql: `CREATE TABLE hindsight_replica_staging_runs (
 staging_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES memory_migration_runs(run_id) ON DELETE CASCADE,
 replica_epoch_id TEXT NOT NULL,
 provider_lineage TEXT NOT NULL,
 bank_id TEXT NOT NULL,
 bank_generation TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 end_cursor INTEGER NOT NULL CHECK(end_cursor>=0),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^a-f0-9]*'),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND json_type(manifest_json)='object'),
 snapshot_expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('building','verified','published','failed')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(run_id,bank_id,snapshot_id),
 UNIQUE(replica_epoch_id,bank_id)
) STRICT;` },
  { type: "table", name: "hindsight_replica_staging_records", sql: `CREATE TABLE hindsight_replica_staging_records (
 staging_id TEXT NOT NULL REFERENCES hindsight_replica_staging_runs(staging_id) ON DELETE CASCADE,
 page_number INTEGER NOT NULL CHECK(page_number>=0),
 record_ordinal INTEGER NOT NULL CHECK(record_ordinal>=0),
 object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
 object_id TEXT NOT NULL,
 object_revision INTEGER NOT NULL CHECK(object_revision>=1),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'),
 PRIMARY KEY(staging_id,page_number,record_ordinal),
 UNIQUE(staging_id,object_kind,object_id)
) STRICT;` },
  { type: "index", name: "idx_hindsight_replica_staging_kind", sql: `CREATE INDEX idx_hindsight_replica_staging_kind
 ON hindsight_replica_staging_records(staging_id,object_kind,object_id);` },
  { type: "table", name: "hindsight_replica_records", sql: `CREATE TABLE hindsight_replica_records (
 bank_id TEXT NOT NULL,
 replica_epoch_id TEXT NOT NULL,
 object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
 object_id TEXT NOT NULL,
 object_revision INTEGER NOT NULL CHECK(object_revision>=1),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'),
 PRIMARY KEY(bank_id,object_kind,object_id)
) STRICT;` },
  { type: "index", name: "idx_hindsight_replica_records_epoch", sql: `CREATE INDEX idx_hindsight_replica_records_epoch
 ON hindsight_replica_records(bank_id,replica_epoch_id,object_kind,object_id);` },
  { type: "table", name: "hindsight_replica_checkpoints", sql: `CREATE TABLE hindsight_replica_checkpoints (
 bank_id TEXT PRIMARY KEY,
 replica_epoch_id TEXT NOT NULL,
 provider_lineage TEXT NOT NULL,
 bank_generation TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 end_cursor INTEGER NOT NULL CHECK(end_cursor>=0),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^a-f0-9]*'),
 captured_at TEXT NOT NULL,
 snapshot_expires_at TEXT NOT NULL,
 published_at TEXT NOT NULL,
 staging_id TEXT NOT NULL UNIQUE REFERENCES hindsight_replica_staging_runs(staging_id)
) STRICT;` },
  { type: "table", name: "hindsight_authority_activation_receipts", sql: `CREATE TABLE hindsight_authority_activation_receipts (
 transaction_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL UNIQUE REFERENCES memory_migration_runs(run_id),
 predecessor_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 hindsight_epoch_id TEXT NOT NULL UNIQUE REFERENCES canonical_memory_authority_epochs(epoch_id),
 provider_lineage TEXT NOT NULL,
 config_fingerprint TEXT NOT NULL CHECK(length(config_fingerprint)=64 AND config_fingerprint NOT GLOB '*[^a-f0-9]*'),
 checkpoint_set_digest TEXT NOT NULL CHECK(length(checkpoint_set_digest)=64 AND checkpoint_set_digest NOT GLOB '*[^a-f0-9]*'),
 bank_count INTEGER NOT NULL CHECK(bank_count>=1),
 lease_fence INTEGER NOT NULL CHECK(lease_fence>=1),
 committed_at TEXT NOT NULL
) STRICT;` },
  { type: "table", name: "hindsight_authority_bank_receipts", sql: `CREATE TABLE hindsight_authority_bank_receipts (
 transaction_id TEXT NOT NULL REFERENCES hindsight_authority_activation_receipts(transaction_id) ON DELETE CASCADE,
 bank_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 bank_generation TEXT NOT NULL,
 replica_epoch_id TEXT NOT NULL,
 end_cursor INTEGER NOT NULL CHECK(end_cursor>=0),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^a-f0-9]*'),
 template_digest TEXT NOT NULL CHECK(length(template_digest)=64 AND template_digest NOT GLOB '*[^a-f0-9]*'),
 PRIMARY KEY(transaction_id,bank_id)
) STRICT;` },
];
