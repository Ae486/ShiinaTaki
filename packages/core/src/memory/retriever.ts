/**
 * INPUT:  a recall query text + character scope + optional layer filter + limit
 * OUTPUT: Retriever interface + RankedEntry — the recall seam; retrieve() returns ranked in-scope entries
 * POS:    core/memory — the retrieval seam (AC 6). v1 impl = FTS5 (fts5-retriever.ts); call sites depend on THIS interface
 *
 * v2 (#30) adds an embedding retriever behind this same interface: hybrid weighted union (~0.7 vector / 0.3 bm25,
 * OpenClaw-style) over the user's /v1/embeddings + sqlite-vec, degrading to FTS5 when the embedding call fails.
 * Lexical search cannot do paraphrase association ("那家我们去过的拉面店" -> "吃了豚骨拉面"); that is why v2 is committed.
 */
export interface RankedEntry {
  id: string;
  layer: string;
  characterId: string | null;
  importance: number;
  created: string;
  disclosure: string;
  /** "self" | "observed" — render sites fence observed content (Q8/D47); kept as a string so the seam stays db-shaped. */
  origin: string;
  content: string;
}

export interface RetrieveParams {
  text: string;
  characterId: string;
  /** Restrict to these layers (registry-derived); omitted = every layer the character can see. */
  layers?: string[];
  limit: number;
}

export interface Retriever {
  retrieve(params: RetrieveParams): RankedEntry[];
}
