/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: privacyPauseMigration005 — {version:5, sql} creating privacy_pause_state (the persisted Privacy Pause)
 * POS:    core/db/migrations — migration 5; registered in index-list.ts, applied once at startup and tracked
 */
import type { Migration } from "../migration-runner.ts";

// A pause is a withdrawal of consent to be observed: it must survive a crash/upgrade/reboot, or a restart silently
// resumes observation. One row (id = 1) — the pause is global, not per character; `until` is an absolute epoch-ms
// deadline (NULL = paused until manually resumed) so a lapsed pause settles on read with no "was it yesterday" logic.
export const privacyPauseMigration005: Migration = {
  version: 5,
  sql: `
    CREATE TABLE privacy_pause_state (
      id     INTEGER PRIMARY KEY CHECK (id = 1),
      paused INTEGER NOT NULL,
      until  INTEGER
    ) STRICT;
  `,
};
