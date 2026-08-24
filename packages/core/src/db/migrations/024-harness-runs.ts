/**
 * INPUT: schema version 023 database
 * OUTPUT: additive Run/Attempt/Snapshot/Receipt current-state tables for Slice 1 Harness admission
 * POS:    core/db/migrations — strictly ordered, forward-only lifecycle foundation
 */
import type { Migration } from "../migration-runner.ts";

export const harnessRunsMigration024: Migration = {
  version: 24,
  sql: `
    CREATE TABLE IF NOT EXISTS run_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      schema_version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      trigger_request_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      initiator TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      task_id TEXT,
      parent_run_id TEXT,
      delivery_class TEXT NOT NULL,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 0,
      snapshot_id TEXT NOT NULL REFERENCES run_snapshots(snapshot_id),
      active_attempt_id TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      deadline_at TEXT,
      terminal_at TEXT,
      cancel_requested_at TEXT,
      cancel_reason TEXT,
      outcome TEXT,
      retryability TEXT,
      receipt_id TEXT,
      operation_phase TEXT NOT NULL DEFAULT 'admitted',
      operation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS runs_character_state_idx ON runs(character_id, state, queued_at);
    CREATE TABLE IF NOT EXISTS run_attempts (
      attempt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      ordinal INTEGER NOT NULL,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL REFERENCES run_snapshots(snapshot_id),
      retry_reason TEXT,
      started_at TEXT,
      deadline_at TEXT,
      settled_at TEXT,
      outcome TEXT,
      retryability TEXT,
      result_summary TEXT,
      error_code TEXT,
      UNIQUE(run_id, ordinal)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS run_attempts_run_idx ON run_attempts(run_id, ordinal);
    CREATE TABLE IF NOT EXISTS run_receipts (
      receipt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
      state TEXT NOT NULL,
      outcome TEXT,
      retryability TEXT,
      reason TEXT,
      action TEXT,
      attempt_count INTEGER NOT NULL,
      snapshot_id TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
};
