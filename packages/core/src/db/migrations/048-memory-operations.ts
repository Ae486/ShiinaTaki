/**
 * INPUT:  Core-minted durable memory operation rows (setup validate/apply, replica sync) and their producer refs
 * OUTPUT: single-flight per family via a partial unique index, restart reconciliation by owner boot identity
 * POS:    core/db/migrations — additive operator-facing operation ledger; no authority, setup or replica semantics change
 */
import type { Migration } from "../migration-runner.ts";

export const memoryOperationsMigration048: Migration = {
  version: 48,
  sql: `
CREATE TABLE memory_operations (
 operation_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 family TEXT NOT NULL,
 state TEXT NOT NULL,
 reason TEXT,
 authority_epoch_id TEXT,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 producer_json TEXT CHECK(producer_json IS NULL OR json_valid(producer_json)),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 error_code TEXT,
 owner_boot_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 terminal_at TEXT
) STRICT;
CREATE UNIQUE INDEX memory_operations_active_family ON memory_operations(family) WHERE terminal_at IS NULL;
CREATE INDEX memory_operations_recent ON memory_operations(terminal_at DESC);
`,
};
