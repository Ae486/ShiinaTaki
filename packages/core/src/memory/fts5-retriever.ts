/**
 * INPUT:  a MemoryRepo + RetrieveParams (query text, character scope, optional layers, limit)
 * OUTPUT: createFts5Retriever(repo) -> Retriever — FTS5/bm25 recall with the disclosure keyword gate
 * POS:    core/memory — the v1 Retriever impl behind retriever.ts; owns query sanitization + post-filters
 */
import type { MemoryEntryRow, MemoryRepo } from "../db/memory-repo.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { buildFtsQuery } from "./fts5-query.ts";
import type { RankedEntry, Retriever } from "./retriever.ts";

// Over-fetch bm25 candidates, then apply the layer + disclosure post-filters and trim to the caller's limit.
const CANDIDATE_CAP = 50;

export function createFts5Retriever(repo: MemoryRepo): Retriever {
  return {
    retrieve({ text, characterId, layers, limit }) {
      const query = buildFtsQuery(text);
      if (query.kind === "empty") return [];

      const rows = repo.search({
        match: query.kind === "match" ? query.match : undefined,
        like: query.kind === "like" ? query.like : undefined,
        characterId,
        now: new Date().toISOString(),
        limit: CANDIDATE_CAP,
      });

      const layerSet = layers ? new Set(layers) : undefined;
      const results: RankedEntry[] = [];
      for (const row of rows) {
        if (layerSet && !layerSet.has(row.layer)) continue;
        if (!disclosureMatches(row.disclosure, text)) continue;
        results.push(toRanked(row));
        if (results.length >= limit) break;
      }
      return results;
    },
  };
}

function toRanked(row: MemoryEntryRow): RankedEntry {
  return {
    id: row.id,
    layer: row.layer,
    characterId: row.characterId,
    importance: row.importance,
    created: row.createdAt,
    disclosure: row.disclosure,
    content: row.content,
  };
}
