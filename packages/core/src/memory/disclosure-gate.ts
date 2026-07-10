/**
 * INPUT:  an entry's `disclosure` hint + the current query text
 * OUTPUT: disclosureMatches(disclosure, queryText) -> boolean
 * POS:    core/memory — the shared "when to recall" keyword gate (retriever + intention gate use ONE definition)
 */

// disclosure is free text ("约定,电影" / "周末 钓鱼"); split on whitespace, ASCII + CJK commas/semicolons.
const TOKEN_SPLIT_RE = /[\s,，、;；]+/;

/** Non-empty disclosure surfaces only when one of its keyword tokens is a case-insensitive substring of the query. */
export function disclosureMatches(disclosure: string, queryText: string): boolean {
  const tokens = disclosure.split(TOKEN_SPLIT_RE).filter((token) => token.length > 0);
  if (tokens.length === 0) return true; // no hint = always eligible
  const haystack = queryText.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}
