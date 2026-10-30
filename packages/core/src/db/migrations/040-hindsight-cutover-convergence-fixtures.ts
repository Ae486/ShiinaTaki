/**
 * INPUT:  schema-only evidence from the early applied 023 lineage, after migrations 001-022
 * OUTPUT: historical migration fixture with no cutover tables or Hindsight authority columns
 * POS:    core/db/migrations — test support only; contains no user rows or runtime wiring
 */
import type { Migration } from "../migration-runner.ts";

// This observed 023 created only the import pair. The unchanged 021 marker still allowed Local/legacy
// modes only. Keep this independent of 040 so future edits cannot silently modernize the reproduction.
export const earlyHindsightMigration023: Migration = {
  version: 23,
  sql: `
CREATE TABLE hindsight_import_operations (
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
) STRICT;
CREATE INDEX idx_hindsight_import_operations_status
 ON hindsight_import_operations(run_id,status);
CREATE TABLE hindsight_import_facts (
 run_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 fact_ordinal INTEGER NOT NULL CHECK(fact_ordinal>=0),
 fact_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 PRIMARY KEY(run_id,source_id,fact_ordinal),
 UNIQUE(run_id,fact_id),
 FOREIGN KEY(run_id,source_id) REFERENCES hindsight_import_operations(run_id,source_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_hindsight_import_facts_source
 ON hindsight_import_facts(run_id,source_id,fact_ordinal);
`,
};
