/**
 * INPUT: canonical Runs, Timeline and qualified C2 feedback dispositions
 * OUTPUT: additive reset fences and nullable original admission timezone metadata
 * POS: core/db/migrations — no second Run, feedback or quota ledger
 */
import type { Migration } from "../migration-runner.ts";

export const initiativeBackoffMigration055: Migration = {
  version: 55,
  ensureNullableTextColumns: [{ table: "runs", column: "initiative_timezone" }],
  sql: `
CREATE TABLE initiative_backoff_resets (
 character_id TEXT PRIMARY KEY CHECK(length(character_id) BETWEEN 1 AND 200),
 timeline_seq INTEGER NOT NULL CHECK(timeline_seq>=0),
 reset_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('user-engagement','operator'))
) STRICT;
CREATE INDEX initiative_backoff_admissions ON runs(character_id,delivery_class,queued_at);
CREATE INDEX initiative_backoff_qualified ON initiative_feedback(character_id,settled_at,timeline_seq)
 WHERE disposition='weak_non_engagement';
`,
};
