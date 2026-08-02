/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: conversationSummaryMigration012 — {version:12, sql} creating conversation_summary (R3 rolling summary)
 * POS:    core/db/migrations — migration 12 (T5 batch 7 compaction); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// One overwritable row per character (T5-R3): the rolling summary text + the seq range it covers
// ([beginning .. through_seq]). NEVER a timeline row — the replay view substitutes it as a head message;
// the stored conversation and the user's scroll-back stay untouched (ADR 0005/0008).
export const conversationSummaryMigration012: Migration = {
  version: 12,
  sql: `
    CREATE TABLE conversation_summary (
      character_id  TEXT PRIMARY KEY,
      through_seq   INTEGER NOT NULL,
      text          TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    ) STRICT;
  `,
};
