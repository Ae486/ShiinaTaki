/**
 * INPUT: authoritative Legacy entry files, existing metadata repository and active tokenizer
 * OUTPUT: streaming sparse rebuild source with Core-write reconciliation
 * POS: core/memory — Legacy-only projection maintenance; malformed files refuse publication instead of disappearing
 */
import type { Database } from "../db/sqlite.ts";
import type { MemoryRepo } from "../db/memory-repo.ts";
import { indexEntry } from "./indexer.ts";
import { scanMemoryEntries, type MemoryStore, type StoredEntry } from "./store.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";
import type { SearchProjectionRow, SearchProjectionSource } from "./search-projection-rebuild.ts";

export function legacySearchProjection(input: {
  db: Database; store: MemoryStore; repo: MemoryRepo; tokenizer: SearchTokenizer;
}): SearchProjectionSource {
  return { table: "memory_fts", columns: ["path", "disclosure", "content", "search_terms"], identities: ["path"],
    tracked: [{ table: "memory_entries", columns: ["path"] }],
    async *scan() {
      const existing = new Map(input.repo.listHashes().map((row) => [row.path, row.contentHash]));
      for await (const scanned of scanMemoryEntries(input.store.root)) {
        // Async iterator delivery can resume after a Core writer changed the scanned file.
        const stored = readCurrent(input.store, scanned.filePath);
        const previous = existing.get(scanned.filePath);
        existing.delete(scanned.filePath);
        if (!stored) { input.repo.deleteByPath(scanned.filePath); continue; }
        // Reconcile newly discovered/manual edits using the current generation until candidate publication.
        if (previous !== stored.contentHash) indexEntry(input, stored);
        yield project(stored);
      }
      for (const [path, previous] of existing) {
        const stored = readCurrent(input.store, path);
        if (!stored) { input.repo.deleteByPath(path); continue; }
        if (previous !== stored.contentHash) indexEntry(input, stored);
        yield project(stored);
      }
    },
    read(key) {
      const [path] = JSON.parse(key) as string[];
      const stored = readCurrent(input.store, path!);
      return stored ? project(stored) : undefined;
    },
  };
}

function readCurrent(store: MemoryStore, path: string): StoredEntry | undefined {
  try { return store.readAtPath(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

function project(stored: StoredEntry): SearchProjectionRow {
  const disclosure = stored.entry.disclosure ?? "";
  return { key: JSON.stringify([stored.filePath]), values: { path: stored.filePath, disclosure, content: stored.body },
    text: `${disclosure} ${stored.body}` };
}
