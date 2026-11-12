/**
 * INPUT: exact stopped T4 schema and immutable current six-table declarations
 * OUTPUT: lossless source-phase CHECK repair with foreign-key enforcement retained
 * POS: core/db/migrations — frozen input only; runs before main adds further incoming references
 */
import { T4_SCHEMA } from "./073-convergence-schema.generated.ts";

const sourcePhase = "phase TEXT NOT NULL CHECK(phase IN ('snapshotted','normalized','staged','verified','failed'))";

/** Only the two declaration differences independently evidenced in the stopped backup. */
export const FROZEN_T4_SCHEMA = T4_SCHEMA.map((object) => ({ ...object, sql:
  object.name === "memory_migration_sources" ? object.sql.replace(sourcePhase, "phase TEXT NOT NULL")
    : object.name === "timeline_messages" ? object.sql.replace('"presentation" TEXT', "presentation TEXT") : object.sql,
}));

const columns = {
  memory_migration_sources: ["run_id", "source_id", "kind", "relative_path", "raw_sha256", "byte_length", "normalized_hash", "content_hash", "phase", "disposition", "canonical_source_id", "document_id", "operation_id", "result_count", "duplicate_source_id", "diagnostic_code", "updated_at"],
  memory_migration_attempts: ["run_id", "source_id", "attempt_no", "phase", "lease_fence", "started_at", "finished_at", "diagnostic_code", "diagnostic_detail"],
  memory_migration_results: ["run_id", "source_id", "result_ordinal", "memory_id", "revision", "result_payload_hash"],
  memory_migration_exclusions: ["run_id", "source_id", "snapshot_id", "raw_sha256", "relative_path", "reason", "operator_actor", "created_at"],
  hindsight_import_operations: ["run_id", "source_id", "bank_id", "document_id", "operation_identity", "remote_operation_id", "content_identity", "provider_content_hash", "lease_fence", "attempt_no", "status", "operation_result_hash", "derived_unit_count", "extraction_error_count", "mapping_complete", "zero_fact_allowed", "diagnostic_code", "updated_at"],
  hindsight_import_facts: ["run_id", "source_id", "fact_ordinal", "fact_id", "revision", "payload_hash"],
};

export const FROZEN_SOURCE_REPLACED_TABLES = Object.keys(columns);
export const FROZEN_SOURCE_BACKUP_NAMES = FROZEN_SOURCE_REPLACED_TABLES.map((table) => `convergence_073_backup_${table}`);

// Snapshot the full transitive incoming closure before dropping any cascade parent. Explicit rowids
// preserve durable identity even when historical allocation is sparse; no phase is mapped or cast.
export const FROZEN_SOURCE_REPAIR_SQL = [
  ...Object.entries(columns).map(([table, names]) => `CREATE TABLE convergence_073_backup_${table} AS
    SELECT rowid AS original_rowid, ${names.join(", ")} FROM ${table};`),
  ...[...FROZEN_SOURCE_REPLACED_TABLES].reverse().map((table) => `DROP TABLE ${table};`),
  ...Object.entries(columns).flatMap(([table, names]) => [
    `${T4_SCHEMA.find((object) => object.type === "table" && object.name === table)!.sql};`,
    `INSERT INTO ${table} (rowid, ${names.join(", ")})
      SELECT original_rowid, ${names.join(", ")} FROM convergence_073_backup_${table};`,
  ]),
  ...T4_SCHEMA.filter((object) => object.type === "index" && FROZEN_SOURCE_REPLACED_TABLES.includes(object.table)).map(({ sql }) => `${sql};`),
  ...FROZEN_SOURCE_BACKUP_NAMES.map((name) => `DROP TABLE ${name};`),
].join("\n");
