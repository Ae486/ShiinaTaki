/**
 * INPUT:  any memory text or query text (CJK, ASCII, mixed, punctuation)
 * OUTPUT: SearchTokenizer interface + createIntlSegmenterTokenizer({stoplist}) + CJK_STOPWORDS
 * POS:    core/memory — THE swappable segmentation seam (D53). Nothing outside this file knows which tokenizer runs;
 *         the indexer and the query builder share ONE instance, which is what makes their terms agree
 */

/**
 * `unicode61` treats a CJK run as a single token, so a 2-char word like 拉面 can never MATCH stored prose (ra §A.0).
 * The index therefore carries an app-segmented `search_terms` column — and the SAME tokenizer must segment the query,
 * because a term only lands when both sides produce it identically (ra §B.2).
 */
export interface SearchTokenizer {
  /** Segmented, case-folded, stoplist-filtered, deduped terms. Order is first-appearance; callers must not rely on it. */
  tokenize(text: string): string[];
}

/**
 * Function words only. They appear in nearly every entry, so they widen every result set and cost index space without
 * changing rank — ra §B.2 measured the set for 我对什么过敏 shrinking 4 -> 1 with rank@1 unchanged. Content words are
 * deliberately absent: dropping one would make its memories unreachable, which no result-set size is worth.
 */
export const CJK_STOPWORDS: readonly string[] = [
  "的", "了", "是", "在", "有", "和", "与", "就", "都", "也",
  "很", "会", "着", "这", "那", "个", "一个", "不", "我", "你",
  "他", "她", "它", "们", "什么", "怎么", "自己", "吗", "呢", "吧",
  "啊",
];

/**
 * v1 impl: ICU's `CjkBreakEngine` (dictionary + Viterbi) through `Intl.Segmenter`, zero dependencies. The locale is
 * "zh" but ICU's CJK dictionary is unified, so zh/zh-Hans/ja segment identically (ra §B.2). Mixed CJK+ASCII tokens
 * (VSCode, TakiAgent, pleia) survive intact — the case a naive per-character split destroys.
 */
export function createIntlSegmenterTokenizer(opts: { stoplist: boolean }): SearchTokenizer {
  // Built once: segmentation runs on every write and every search.
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  const stopwords = opts.stoplist ? new Set(CJK_STOPWORDS) : undefined;

  return {
    tokenize(text) {
      const terms = new Set<string>();
      for (const segment of segmenter.segment(text)) {
        // isWordLike drops whitespace and punctuation, which would otherwise become quoted FTS5 literals.
        if (!segment.isWordLike) continue;
        // Folded here rather than left to unicode61 so the dedupe treats VSCode/vscode as one term on both sides.
        const term = segment.segment.toLowerCase();
        if (stopwords?.has(term)) continue;
        terms.add(term);
      }
      return [...terms];
    },
  };
}
