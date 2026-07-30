/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryEventsCountMigration009 — {version:9, sql} adding the nullable count column to memory_events
 * POS:    core/db/migrations — migration 9 (T5 batch 3 search events, 其四); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// A `search` event's one measurable fact is how many memories came back — the observable T5-R12 left open ("what would
// tell us the pull-only bet went wrong"). Nullable because the batch-1 kinds have no count: a skip counts nothing and
// a reinforce points at one entry. Still ids/counts only; the query text never reaches the row.
export const memoryEventsCountMigration009: Migration = {
  version: 9,
  sql: `
    ALTER TABLE memory_events ADD COLUMN count INTEGER;
  `,
};
