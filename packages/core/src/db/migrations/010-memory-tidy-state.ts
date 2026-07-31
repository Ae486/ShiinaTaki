/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryTidyStateMigration010 — {version:10, sql} adding last_tidy_at to memory_auto_state
 * POS:    core/db/migrations — migration 10 (T5 batch 4 tidy watermark); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// The tidy pass's per-character high-water mark (Letta's last_processed_message_id analogue): NULL = never tidied,
// which is why the column is nullable rather than defaulted to a date — a fabricated "tidied at boot" timestamp would
// hide every write made before the first pass. Writes-since-mark is COUNTED from it, so no counter column is needed.
export const memoryTidyStateMigration010: Migration = {
  version: 10,
  sql: `
    ALTER TABLE memory_auto_state ADD COLUMN last_tidy_at TEXT;
  `,
};
