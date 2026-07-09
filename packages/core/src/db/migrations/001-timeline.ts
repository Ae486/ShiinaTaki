/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: timelineMigration001 — {version:1, sql} creating timeline_messages + its (character_id, seq) index
 * POS:    core/db/migrations — migration 1; registered in index-list.ts, applied once at startup and tracked
 */
import type { Migration } from "../migration-runner.ts";

export const timelineMigration001: Migration = {
  version: 1,
  sql: `
    CREATE TABLE timeline_messages (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,
      id           TEXT NOT NULL UNIQUE,
      character_id TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content      TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_timeline_character_seq ON timeline_messages (character_id, seq DESC);
  `,
};
