/**
 * INPUT:  a MemoryRepo + a MemoryStore (files-as-truth) or a single StoredEntry
 * OUTPUT: indexEntry(repo, stored) · reconcile({repo, store}) -> ReconcileStats — sync the derived index to the files
 * POS:    core/memory — the indexer: the DB is rebuildable from markdown; startup reconciliation heals any drift
 */
import type { MemoryRepo, MemoryUpsert } from "../db/memory-repo.ts";
import type { MemoryStore, StoredEntry } from "./store.ts";

export interface ReconcileStats {
  upserted: number;
  deleted: number;
  total: number;
  /** Files that failed to parse/validate — reported (logged at boot), never a crash; they stay unindexed. */
  invalid: string[];
}

/** Upsert one stored entry into the index (called right after a file write — the write path is file-then-index). */
export function indexEntry(repo: MemoryRepo, stored: StoredEntry): void {
  repo.upsert(toUpsert(stored));
}

/**
 * Walk the files, compare content hashes with the index, and upsert changed/new entries + delete orphaned rows.
 * This is what makes "delete the DB -> boot -> identical retrieval" true (AC 2): the files are the only truth.
 */
export function reconcile(deps: { repo: MemoryRepo; store: MemoryStore }): ReconcileStats {
  const { entries: onDisk, invalid } = deps.store.list();
  const indexed = new Map(deps.repo.listHashes().map((row) => [row.path, row.contentHash]));
  const seen = new Set<string>();

  let upserted = 0;
  for (const stored of onDisk) {
    seen.add(stored.filePath);
    if (indexed.get(stored.filePath) !== stored.contentHash) {
      indexEntry(deps.repo, stored);
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

function toUpsert(stored: StoredEntry): MemoryUpsert {
  const { entry } = stored;
  return {
    path: stored.filePath,
    id: entry.id,
    layer: entry.layer,
    characterId: stored.characterId,
    importance: entry.importance,
    status: entry.status,
    createdAt: entry.created,
    expiresAt: entry.expires ?? null,
    contentHash: stored.contentHash,
    disclosure: entry.disclosure ?? "",
    content: stored.body,
  };
}
