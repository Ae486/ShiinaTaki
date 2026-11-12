/**
 * INPUT: proven applied tokenizer policy (null when unknown) and authority-owned index rebuild producer
 * OUTPUT: one stable tokenizer identity and atomic candidate publication
 * POS: core/memory — retained tools borrow the current same-authority search projection per synchronous call
 */
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "./search-tokenizer.ts";

export function createLiveSearchTokenizer(stoplist: boolean | null, initial?: SearchTokenizer) {
  let current = stoplist === null ? undefined : initial ?? createIntlSegmenterTokenizer({ stoplist });
  let applied = stoplist;
  let pending = false;
  const tokenizer: SearchTokenizer = { tokenize: (text) => {
    if (!current) throw new Error("MEMORY_SEARCH_INDEX_UNAVAILABLE");
    return current.tokenize(text);
  } };
  return {
    tokenizer,
    ready: () => current !== undefined,
    appliedStoplist: () => applied,
    async reconfigure(next: boolean, rebuild: (candidate: SearchTokenizer, publish: () => void) => Promise<{ indexed: number }>) {
      if (pending) throw new Error("MEMORY_OPERATION_BUSY");
      if (next === applied) return { indexed: 0 };
      const candidate = createIntlSegmenterTokenizer({ stoplist: next });
      pending = true;
      try { return await rebuild(candidate, () => { current = candidate; applied = next; }); }
      finally { pending = false; }
    },
  };
}
