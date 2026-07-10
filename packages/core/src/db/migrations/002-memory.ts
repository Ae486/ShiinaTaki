/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryMigration002 — {version:2, sql} creating memory_entries + the memory_fts trigram virtual table
 * POS:    core/db/migrations — migration 2 (rebuildable derived index; files are truth); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// memory_entries = metadata (path is the file identity + PK). memory_fts = trigram index over disclosure + content.
// Both are DERIVED from the markdown files and fully rebuilt by the indexer, so schema churn can never lose a memory.
export const memoryMigration002: Migration = {
  version: 2,
  sql: `
    CREATE TABLE memory_entries (
      path         TEXT PRIMARY KEY,
      id           TEXT NOT NULL,
      layer        TEXT NOT NULL,
      character_id TEXT,
      importance   INTEGER NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      expires_at   TEXT,
      content_hash TEXT NOT NULL
    ) STRICT;
    CREATE INDEX idx_memory_layer_status ON memory_entries (layer, status);
    CREATE VIRTUAL TABLE memory_fts USING fts5(path UNINDEXED, disclosure, content, tokenize='trigram');
  `,
};
