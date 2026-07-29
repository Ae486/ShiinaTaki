/**
 * INPUT:  free text (slug), a candidate id (schema), or path segments (containment)
 * OUTPUT: slugify() · IdSchema · isSafeSegment()/assertSafeSegment() · resolveWithin(root, ...segs) — the memory
 *         naming/pathing rules
 * POS:    core/memory — pure naming + path-containment helpers (research/frontmatter-and-budget.md §3); no fs here
 */
import { resolve, sep } from "node:path";
import { z } from "zod";

const SLUG_MAX = 40;
// Kept characters: CJK scripts + ASCII alphanumerics; every other run collapses to a single '-'.
const SLUG_DROP_RE = /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+/gu;

/** Readable CJK-preserving slug; no transliteration. Always returns a non-empty, path-safe token. */
export function slugify(source: string): string {
  const collapsed = source.normalize("NFC").replace(SLUG_DROP_RE, "-").replace(/^-|-$/g, "").toLowerCase();
  const capped = [...collapsed].slice(0, SLUG_MAX).join("").replace(/^-|-$/g, "");
  return capped.length > 0 ? capped : "entry";
}

// id = NNNN-slug (>=4 digits, root-wide counter). No dot/slit/separator -> `..` is unexpressible (defense in depth).
export const IdSchema = z
  .string()
  .regex(/^\d{4,}-[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z0-9-]{1,60}$/u, "invalid memory id");

// Path segments (characterId, layer) must never carry separators or traversal.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** Predicate form, for callers to which an unsafe segment is untrusted DATA to skip rather than a wiring bug. */
export function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT_RE.test(value);
}

export function assertSafeSegment(value: string, label: string): void {
  if (!isSafeSegment(value)) throw new Error(`${label} is not a safe path segment: ${value}`);
}

/**
 * Resolve `segments` under `root`, throwing if the result escapes it. The standard containment check
 * (resolve then startsWith(root + sep)); belt-and-braces given IdSchema/assertSafeSegment already ban traversal.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const base = resolve(root);
  const resolved = resolve(base, ...segments);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`path escapes the memory root: ${resolved}`);
  }
  return resolved;
}
