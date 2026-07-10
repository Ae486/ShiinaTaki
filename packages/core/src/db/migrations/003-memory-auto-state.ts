/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryAutoStateMigration003 — {version:3, sql} creating memory_auto_state (auto-write watermarks)
 * POS:    core/db/migrations — migration 3; registered in index-list.ts, applied once at startup and tracked
 */
import type { Migration } from "../migration-runner.ts";

// Per-character watermarks for the two automatic write paths (#7). Seq values reference timeline_messages;
// the watermark IS the double-fire guard — advancing it only after a successful write gives natural retry.
export const memoryAutoStateMigration003: Migration = {
  version: 3,
  sql: `
    CREATE TABLE memory_auto_state (
      character_id       TEXT PRIMARY KEY,
      last_episodic_seq  INTEGER NOT NULL DEFAULT 0,
      last_flush_seq     INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `,
};
