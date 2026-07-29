/**
 * INPUT:  incoming memory content + the active rows of the same layer/character scope
 * OUTPUT: normalizeForDedupe(text) + findDuplicate(rows, content) -> the existing row a write should reinforce
 * POS:    core/memory — T5-R9 write-time dedupe. LEXICAL ONLY, never a model call on the write path (mem0 built an
 *         LLM diff classifier and removed it); a duplicate write is evidence recall FAILED, so the hit is reinforced.
 */
import type { MemoryEntryRow } from "../db/memory-repo.ts";

// Punctuation/symbol classes are stripped so 「他喜欢拉面。」 and 「他喜欢拉面」 collapse to the same key.
const PUNCTUATION_RE = /[\p{P}\p{S}]+/gu;
const WHITESPACE_RE = /\s+/gu;

/** NFC + ASCII casefold + whitespace collapse + punctuation strip — the comparison key, never stored. */
export function normalizeForDedupe(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(PUNCTUATION_RE, "").replace(WHITESPACE_RE, " ").trim();
}

/** The first active row whose normalized content matches; undefined means this is genuinely new. */
export function findDuplicate(rows: MemoryEntryRow[], content: string): MemoryEntryRow | undefined {
  const key = normalizeForDedupe(content);
  if (key.length === 0) return undefined;
  return rows.find((row) => normalizeForDedupe(row.content) === key);
}
