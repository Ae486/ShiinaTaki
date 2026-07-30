/**
 * INPUT:  a MemoryRepo + a SearchTokenizer + a MemoryStore (files-as-truth) or a single StoredEntry
 * OUTPUT: indexEntry(index, stored) · reconcile({repo, tokenizer, store}) -> ReconcileStats — sync the index to the files
 * POS:    core/memory — the indexer: the DB is rebuildable from markdown; startup reconciliation heals any drift.
 *         The INDEX half of the tokenizer seam (the query half is fts5-query.ts)
 */
import type { MemoryRepo, MemoryUpsert } from "../db/memory-repo.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";
import type { MemoryStore, StoredEntry } from "./store.ts";

/** What a write needs to reach the index: the rows' destination plus the segmentation that makes them findable. */
export interface IndexDeps {
  repo: MemoryRepo;
  tokenizer: SearchTokenizer;
}

export interface ReconcileStats {
  upserted: number;
  deleted: number;
  total: number;
  /** Files that failed to parse/validate — reported (logged at boot), never a crash; they stay unindexed. */
  invalid: string[];
}

/** Upsert one stored entry into the index (called right after a file write — the write path is file-then-index). */
export function indexEntry(deps: IndexDeps, stored: StoredEntry): void {
  deps.repo.upsert(toUpsert(deps.tokenizer, stored));
}

/**
 * Walk the files, compare content hashes with the index, and upsert changed/new entries + delete orphaned rows.
 * This is what makes "delete the DB -> boot -> identical retrieval" true (AC 2): the files are the only truth.
 * It is also how a tokenizer or schema migration refills `search_terms` — migration 008 blanks every hash.
 */
export function reconcile(deps: IndexDeps & { store: MemoryStore }): ReconcileStats {
  const { entries: onDisk, invalid } = deps.store.list();
  const indexed = new Map(deps.repo.listHashes().map((row) => [row.path, row.contentHash]));
  const seen = new Set<string>();

  let upserted = 0;
  for (const stored of onDisk) {
    seen.add(stored.filePath);
    if (indexed.get(stored.filePath) !== stored.contentHash) {
      indexEntry(deps, stored);
      upserted += 1;
    }
  }

  let deleted = 0;
  for (const path of indexed.keys()) {
    if (!seen.has(path)) {
      deps.repo.deleteByPath(path);
      deleted += 1;
    }
  }

  return { upserted, deleted, total: onDisk.length, invalid: invalid.map((file) => file.filePath) };
}

function toUpsert(tokenizer: SearchTokenizer, stored: StoredEntry): MemoryUpsert {
  const { entry } = stored;
  const disclosure = entry.disclosure ?? "";
  return {
    path: stored.filePath,
    id: entry.id,
    layer: entry.layer,
    characterId: stored.characterId,
    importance: entry.importance,
    status: entry.status,
    createdAt: entry.created,
    updatedAt: entry.updated ?? null,
    origin: entry.origin,
    expiresAt: entry.expires ?? null,
    contentHash: stored.contentHash,
    disclosure,
    content: stored.body,
    // One space-separated bag from BOTH fields: under unicode61 each raw column is a single token for CJK prose, so
    // this is the only column a 2-char word or a question's vocabulary can ever match (ra §A.0).
    searchTerms: tokenizer.tokenize(`${disclosure} ${stored.body}`).join(" "),
  };
}
