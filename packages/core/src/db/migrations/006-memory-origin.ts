/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryOriginMigration006 — {version:6, sql} adding origin + updated_at to memory_entries and forcing a reindex
 * POS:    core/db/migrations — migration 6 (T5 Q8/R9 entry schema); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// `origin` marks content sensed from the outside world (Q8/D47) so render sites can fence it; `updated_at` carries an
// R9 reinforcement's refreshed recency. Both are DERIVED from the markdown frontmatter, so blanking content_hash makes
// the next boot reconcile re-read every file and backfill them — cheaper and safer than a SQL guess.
export const memoryOriginMigration006: Migration = {
  version: 6,
  sql: `
    ALTER TABLE memory_entries ADD COLUMN origin TEXT NOT NULL DEFAULT 'self';
    ALTER TABLE memory_entries ADD COLUMN updated_at TEXT;
    UPDATE memory_entries SET content_hash = '';
  `,
};
