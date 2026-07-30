/**
 * INPUT:  a MemoryRepo + a SearchTokenizer + RetrieveParams (query text, character scope, optional layers, limit)
 * OUTPUT: createFts5Retriever({repo, tokenizer}) -> Retriever — FTS5/bm25 recall, ranked, layer-scoped
 * POS:    core/memory — the v1 Retriever impl behind retriever.ts; owns query sanitization + the layer post-filter
 */
import type { MemoryEntryRow, MemoryRepo } from "../db/memory-repo.ts";
import { buildFtsQuery } from "./fts5-query.ts";
import type { RankedEntry, Retriever } from "./retriever.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";

// Over-fetch bm25 candidates, then apply the layer post-filter and trim to the caller's limit.
const CANDIDATE_CAP = 50;

/**
 * There is no disclosure post-filter (T5 Q2). The old AND gate required a disclosure token to be a literal substring
 * of the query, which inverted the field's purpose: a natural-language trigger ("用户问自己叫什么") is one token that
 * near-never appears verbatim, so WRITING a trigger made an entry harder to retrieve than leaving it blank. Disclosure
 * now earns recall through bm25 weighting instead — its own column plus its terms in `search_terms` (Nocturne's
 * shipped shape). `disclosureMatches` survives for the assembler's intention gate, which is a different question.
 */
export function createFts5Retriever(deps: { repo: MemoryRepo; tokenizer: SearchTokenizer }): Retriever {
  return {
    retrieve({ text, characterId, layers, limit }) {
      const query = buildFtsQuery(deps.tokenizer, text);
      if (query.kind === "empty") return [];

      const rows = deps.repo.search({
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
    origin: row.origin,
    content: row.content,
  };
}
