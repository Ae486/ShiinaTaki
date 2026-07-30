/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: memoryFtsUnicode61Migration008 — {version:8, sql} retokenizing memory_fts and forcing a full reindex
 * POS:    core/db/migrations — migration 8 (T5 batch 3 retrieval migration); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// FTS5 virtual tables cannot be ALTERed, and the tokenizer is fixed at creation — so the table is dropped and rebuilt.
// That is safe here precisely because the index is DERIVED: blanking content_hash makes the next boot reconcile
// re-read every markdown file (which is truth) and refill the table, including the new app-segmented `search_terms`.
// Why retokenize at all: under `trigram` a 2-char CJK word (拉面/电影) produces no trigram and can never MATCH, and a
// natural-language question's 3-char windows do not align with the stored prose's — the exact class T5-R12's
// one-shot search depends on (ra §A.0/§A.1 measured rank@1 17/25 -> 24/25 with a SMALLER index).
export const memoryFtsUnicode61Migration008: Migration = {
  version: 8,
  sql: `
    DROP TABLE memory_fts;
    CREATE VIRTUAL TABLE memory_fts USING fts5(path UNINDEXED, disclosure, content, search_terms, tokenize='unicode61');
    UPDATE memory_entries SET content_hash = '';
  `,
};
