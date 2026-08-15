/**
 * INPUT:  n/a (static DML over the legacy timeline rows)
 * OUTPUT: timelineInputScrubMigration016 — idempotent removal of persisted tool-call `input` from timeline parts
 * POS:    core/db/migrations — Batch E privacy disposition; raw capability input must not survive in SQLite history.
 *         Bounded to timeline_messages.parts tool-call parts; text/image/tool-result parts and content projections
 *         stay untouched (they never carry raw input). Downgrade-safe: only optional JSON fields are removed — an
 *         older binary keeps reading the rows (names-only replay was already the contract); the scrub is final by
 *         design, no rollback restores removed input. secure_delete zeroes the overwritten bytes during the update.
 */
import type { Migration } from "../migration-runner.ts";

export const timelineInputScrubMigration016: Migration = {
  version: 16,
  sql: `
    PRAGMA secure_delete = ON;
    UPDATE timeline_messages
    SET parts = (
      SELECT json_group_array(
        CASE WHEN json_type(value) = 'object' AND json_extract(value, '$.type') = 'tool-call'
          THEN json_remove(value, '$.input')
          ELSE value
        END
      )
      FROM json_each(timeline_messages.parts)
    )
    WHERE parts IS NOT NULL AND json_valid(parts);
    PRAGMA secure_delete = OFF;
  `,
};
