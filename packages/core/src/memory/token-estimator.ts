/**
 * INPUT:  text (estimate) or ordered items + a token budget (fit)
 * OUTPUT: estimateTokens(text) -> number; fitToBudget(items, budget, textOf) -> kept items
 * POS:    core/memory — soft token budgeting (research/frontmatter-and-budget.md §2); constants live here for calibration
 */

// CJK (kana, ext-A, unified, compat, halfwidth kana) count ~1 token/char; other text ~1 token / 4 chars.
// Keep the two regime constants in ONE place so calibration against real provider `usage` is a two-line tweak.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/gu;

export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/**
 * Take items in order until the budget is reached (soft: the first item is always kept, even if oversized).
 * erring slightly high truncates a touch early — the safe direction for a context budget.
 */
export function fitToBudget<T>(items: T[], budget: number, textOf: (item: T) => string): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(textOf(item));
    if (used + cost > budget && kept.length > 0) break;
    kept.push(item);
    used += cost;
  }
  return kept;
}
