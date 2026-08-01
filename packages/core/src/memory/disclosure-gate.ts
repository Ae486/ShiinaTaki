/**
 * INPUT:  an entry's `disclosure` hint + the text to match it against (the current message)
 * OUTPUT: disclosureMatches(disclosure, text) -> boolean
 * POS:    core/memory — the "when to recall" keyword gate; the assembler's intention gate is its only consumer
 *         (the retriever's AND post-filter was removed in T5 Q2)
 */

// disclosure is free text ("约定,电影" / "周末 钓鱼"); split on whitespace, ASCII + CJK commas/semicolons.
const TOKEN_SPLIT_RE = /[\s,，、;；]+/;

/** Non-empty disclosure surfaces only when one of its keyword tokens is a case-insensitive substring of the text. */
export function disclosureMatches(disclosure: string, text: string): boolean {
  const tokens = disclosure.split(TOKEN_SPLIT_RE).filter((token) => token.length > 0);
  if (tokens.length === 0) return true; // no hint = always eligible
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}
