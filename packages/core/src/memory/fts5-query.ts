/**
 * INPUT:  raw user/recall query text (may contain FTS5 syntax chars, CJK, short tokens)
 * OUTPUT: buildFtsQuery(text) -> {kind:'match', match} | {kind:'like', like} | {kind:'empty'}
 * POS:    core/memory — FTS5 query hygiene (research/fts5-trigram-cjk.md §3): quoting is a CORRECTNESS requirement
 */

// A quoted string matches only rows CONTAINING it as a substring. A recall query is the user's whole sentence —
// a superset of any stored memory text, so quoted whole it matches nothing; decomposing it into its own overlapping
// trigrams and OR-ing them recovers substring recall, with bm25 ranking rows that share more trigrams first.
const TRIGRAM = 3;

export type FtsQuery = { kind: "match"; match: string } | { kind: "like"; like: string } | { kind: "empty" };

/**
 * Split on whitespace, expand every >= 3-char token into its overlapping trigrams (quoted literals, internal `"`
 * doubled), OR them. Raw text is FTS5 syntax and THROWS on `?`/`(`/`"` unless quoted; when no token reaches 3 chars
 * (common 2-char CJK words like 拉面/电影) fall back to an escaped LIKE.
 */
export function buildFtsQuery(text: string): FtsQuery {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return { kind: "empty" };

  const trigrams = new Set<string>();
  for (const token of tokens) {
    const chars = [...token];
    for (let i = 0; i + TRIGRAM <= chars.length; i += 1) {
      trigrams.add(chars.slice(i, i + TRIGRAM).join(""));
    }
  }
  if (trigrams.size > 0) {
    return { kind: "match", match: [...trigrams].map(quoteToken).join(" OR ") };
  }
  return { kind: "like", like: `%${escapeLike(text.trim())}%` };
}

// A double-quoted FTS5 string is a literal substring (verified safe for `?`, punctuation, CJK); double internal quotes.
function quoteToken(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

// Escape LIKE wildcards for the `ESCAPE '\'` clause the repo uses.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
