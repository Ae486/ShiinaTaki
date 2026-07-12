/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: timelinePartsMigration004 — {version:4, sql} rebuilding timeline_messages with a 'tool' role + parts column
 * POS:    core/db/migrations — migration 4 (D1 turn fidelity); table rebuild because SQLite cannot ALTER a CHECK
 */
import type { Migration } from "../migration-runner.ts";

// parts is a nullable JSON column: null = legacy text-only row; JSON = structured TimelinePart[] (@taki/shared).
// The INSERT..SELECT keeps seq values; sqlite updates sqlite_sequence on the rename, so appends continue correctly.
export const timelinePartsMigration004: Migration = {
  version: 4,
  sql: `
    CREATE TABLE timeline_messages_v4 (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,
      id           TEXT NOT NULL UNIQUE,
      character_id TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
      content      TEXT NOT NULL,
      parts        TEXT,
      created_at   TEXT NOT NULL
    );
    INSERT INTO timeline_messages_v4 (seq, id, character_id, role, content, created_at)
      SELECT seq, id, character_id, role, content, created_at FROM timeline_messages;
    DROP TABLE timeline_messages;
    ALTER TABLE timeline_messages_v4 RENAME TO timeline_messages;
    CREATE INDEX idx_timeline_character_seq ON timeline_messages (character_id, seq DESC);
  `,
};
