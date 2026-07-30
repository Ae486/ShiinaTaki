/**
 * INPUT:  a SearchTokenizer + raw user/recall query text (may contain FTS5 syntax chars, CJK, pure function words)
 * OUTPUT: buildFtsQuery(tokenizer, text) -> {kind:'match', match} | {kind:'like', like} | {kind:'empty'}
 * POS:    core/memory — FTS5 query hygiene: the QUERY half of the tokenizer seam (the index half is indexer.ts);
 *         both sides must run the SAME tokenizer or a term never lands
 */
import type { SearchTokenizer } from "./search-tokenizer.ts";

export type FtsQuery = { kind: "match"; match: string } | { kind: "like"; like: string } | { kind: "empty" };

/**
 * Segment the query, quote each term as a literal, OR them — bm25 then ranks rows sharing more terms first. Quoting
 * is a CORRECTNESS requirement, not hygiene: raw text is FTS5 syntax and THROWS on `?`/`(`/`"` unquoted. Text that
 * yields no usable term (pure function words, punctuation, an emoji) falls back to an escaped LIKE so a degenerate
 * query still returns its substring matches instead of nothing.
 */
export function buildFtsQuery(tokenizer: SearchTokenizer, text: string): FtsQuery {
  const terms = tokenizer.tokenize(text);
  if (terms.length > 0) return { kind: "match", match: terms.map(quoteToken).join(" OR ") };
  const trimmed = text.trim();
  return trimmed.length === 0 ? { kind: "empty" } : { kind: "like", like: `%${escapeLike(trimmed)}%` };
}

// A double-quoted FTS5 string is a literal (verified safe for `?`, punctuation, CJK); double internal quotes.
function quoteToken(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

// Escape LIKE wildcards for the `ESCAPE '\'` clause the repo uses.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
