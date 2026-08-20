/**
 * INPUT:  Core startup migration runner after canonical-memory and parallel-foundation convergence
 * OUTPUT: durable legacy migration ledger, fenced lease state, exclusions, results, and authority selection
 * POS:    core/db/migrations — additive Batch 2 state; original Markdown and canonical rows are untouched
 */
import type { Migration } from "../migration-runner.ts";

export const memoryLegacyMigration021: Migration = {
  version: 21,
  sql: `
CREATE TABLE IF NOT EXISTS memory_migration_runs (
 run_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, epoch_id TEXT,
 phase TEXT NOT NULL CHECK(phase IN ('snapshotted','normalized','staged','verified','activated','failed')),
 status TEXT NOT NULL CHECK(status IN ('running','ready','completed','failed')),
 requested_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_owner TEXT,
 lease_fence INTEGER NOT NULL DEFAULT 0 CHECK(lease_fence>=0), lease_expires_at TEXT,
 verified_manifest_digest TEXT, readiness_digest TEXT, activation_transaction_id TEXT,
 CHECK(length(run_id)>0 AND length(snapshot_id)>0),
 CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_migration_one_live_run
 ON memory_migration_runs((1)) WHERE status IN ('running','ready');
CREATE TABLE IF NOT EXISTS memory_migration_sources (
 run_id TEXT NOT NULL REFERENCES memory_migration_runs(run_id) ON DELETE CASCADE,
 source_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('entry','block')), relative_path TEXT NOT NULL,
 raw_sha256 TEXT NOT NULL CHECK(length(raw_sha256)=64), byte_length INTEGER NOT NULL CHECK(byte_length>=0),
 normalized_hash TEXT, content_hash TEXT, phase TEXT NOT NULL CHECK(phase IN ('snapshotted','normalized','staged','verified','failed')),
 disposition TEXT NOT NULL CHECK(disposition IN ('pending','normalized','staged','verified','converted-zero','converted-one','converted-many','excluded','failed')),
 canonical_source_id TEXT, document_id TEXT, operation_id TEXT, result_count INTEGER NOT NULL DEFAULT 0 CHECK(result_count>=0),
 duplicate_source_id TEXT, diagnostic_code TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id), UNIQUE(run_id,relative_path,raw_sha256)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_migration_attempts (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, attempt_no INTEGER NOT NULL CHECK(attempt_no>=1), phase TEXT NOT NULL,
 lease_fence INTEGER NOT NULL CHECK(lease_fence>=1), started_at TEXT NOT NULL, finished_at TEXT,
 diagnostic_code TEXT, diagnostic_detail TEXT CHECK(diagnostic_detail IS NULL OR length(diagnostic_detail)<=512),
 PRIMARY KEY(run_id,source_id,attempt_no),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS memory_migration_results (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, result_ordinal INTEGER NOT NULL CHECK(result_ordinal>=0),
 memory_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), result_payload_hash TEXT NOT NULL CHECK(length(result_payload_hash)=64),
 PRIMARY KEY(run_id,source_id,result_ordinal), UNIQUE(run_id,memory_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS memory_migration_exclusions (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, raw_sha256 TEXT NOT NULL,
 relative_path TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 512), operator_actor TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(run_id,source_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS memory_authority_selection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 mode TEXT NOT NULL CHECK(mode IN ('legacy-markdown','canonical-local')), active_epoch_id TEXT,
 verified_snapshot_id TEXT, activation_transaction_id TEXT, updated_at TEXT NOT NULL,
 CHECK((mode='legacy-markdown' AND active_epoch_id IS NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NULL)
    OR (mode='canonical-local' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NOT NULL AND activation_transaction_id IS NOT NULL))
) STRICT;
INSERT OR IGNORE INTO memory_authority_selection
 (singleton,mode,active_epoch_id,verified_snapshot_id,activation_transaction_id,updated_at)
  VALUES (1,'legacy-markdown',NULL,NULL,NULL,'1970-01-01T00:00:00.000Z');
CREATE TABLE IF NOT EXISTS memory_migration_activation_receipts (
 run_id TEXT PRIMARY KEY REFERENCES memory_migration_runs(run_id), transaction_id TEXT NOT NULL UNIQUE,
 snapshot_id TEXT NOT NULL, manifest_digest TEXT NOT NULL, readiness_digest TEXT NOT NULL, epoch_id TEXT NOT NULL,
 lease_fence INTEGER NOT NULL CHECK(lease_fence>=1), committed_at TEXT NOT NULL,
 marker_mode TEXT NOT NULL CHECK(marker_mode='canonical-local')
) STRICT;
`,
};
