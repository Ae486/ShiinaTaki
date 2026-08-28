/**
 * INPUT:  schema version 030 database with aggregate model usage columns
 * OUTPUT: additive provider-neutral cache, uncached-input, text-output, and reasoning token columns
 * POS:    core/db/migrations — preserves AI SDK v7 usage detail without changing existing usage identity
 */
import type { Migration } from "../migration-runner.ts";

export const runUsageDetailsMigration031: Migration = {
  version: 31,
  sql: `
    ALTER TABLE run_usage ADD COLUMN input_no_cache_tokens INTEGER;
    ALTER TABLE run_usage ADD COLUMN cache_read_tokens INTEGER;
    ALTER TABLE run_usage ADD COLUMN cache_write_tokens INTEGER;
    ALTER TABLE run_usage ADD COLUMN output_text_tokens INTEGER;
    ALTER TABLE run_usage ADD COLUMN reasoning_tokens INTEGER;
  `,
};
