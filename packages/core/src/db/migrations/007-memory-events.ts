/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryEventsMigration007 — {version:7, sql} creating memory_events
 * POS:    core/db/migrations — migration 7 (T5 events substrate); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// The memory system's own decision log: skips (the R15 gate wrote nothing) and reinforcements (R9) now, searches in
// batch 3. It lives in the DB rather than in pino because diagnosis is a SQL join by turn — and because a log line
// carrying memory content would violate the logging guidelines. Rows hold ids/counts/ranges ONLY.
export const memoryEventsMigration007: Migration = {
  version: 7,
  sql: `
    CREATE TABLE memory_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,
      character_id TEXT NOT NULL,
      turn_seq     INTEGER,
      entry_id     TEXT,
      created_at   TEXT NOT NULL
    ) STRICT;
    CREATE INDEX idx_memory_events_character ON memory_events (character_id, id);
  `,
};
