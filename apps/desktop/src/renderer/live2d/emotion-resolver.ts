/**
 * INPUT:  an abstract emotion tag (e.g. "angry", "shy") + the model's actual motion/expression names.
 * OUTPUT: resolveByTag(tag, names) -> the best-matching real name, or null when nothing fits.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). Pure, unit-tested. Resolving against the LIVE
 *         model's names (not a per-model config) lets the tsundere preset survive costume/soul swaps (clean-room §4).
 */

// Synonym expansion so an abstract tag maps onto a costume's actual vocabulary: taki's arbeit has pui/shame/serious,
// live_01 has bsmile/amazed, etc. Tried in order; the first candidate that resolves wins.
const SYNONYMS: Record<string, string[]> = {
  angry: ["angry", "pui", "serious"],
  shy: ["shame", "shy", "bsmile"],
  smile: ["smile", "bsmile"],
  sad: ["sad", "cry"],
  surprised: ["surprised", "amazed"],
  serious: ["serious", "kime"],
  think: ["thinking", "think", "question"],
  pui: ["pui", "angry"],
  sigh: ["sigh", "serious"],
};

export function resolveByTag(tag: string, names: string[]): string | null {
  for (const candidate of [tag, ...(SYNONYMS[tag] ?? [])]) {
    const hit = matchName(candidate, names);
    if (hit !== null) return hit;
  }
  return null;
}

// Precedence: exact -> prefix -> boundary regex `(^|[_-])tag($|[_-]|digit)` so `smile` finds `smile01`, `exp_smile05`,
// or `mtn_smile01_C` but not `smileX`. Escapes the tag before building the pattern.
function matchName(tag: string, names: string[]): string | null {
  const exact = names.find((name) => name === tag);
  if (exact !== undefined) return exact;
  const prefixed = names.find((name) => name.startsWith(tag));
  if (prefixed !== undefined) return prefixed;
  const boundary = new RegExp(`(^|[_-])${escapeRegExp(tag)}($|[_-]|\\d)`);
  return names.find((name) => boundary.test(name)) ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
