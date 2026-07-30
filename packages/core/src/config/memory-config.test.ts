import { describe, expect, it } from "vitest";
import { DEFAULT_BM25_WEIGHTS, DEFAULT_PINNED_BUDGET, loadMemoryConfig } from "./memory-config.ts";

const DEFAULTS = { pinnedBudget: DEFAULT_PINNED_BUDGET, bm25Weights: DEFAULT_BM25_WEIGHTS, stoplist: true };

describe("memory config (T5-R13: every number is configured, with a fail-closed default)", () => {
  it("falls back to the defaults when nothing is set", () => {
    expect(loadMemoryConfig({})).toEqual(DEFAULTS);
    expect(DEFAULT_PINNED_BUDGET).toBe(800);
  });

  it("takes the operator's pinned-budget override", () => {
    expect(loadMemoryConfig({ TAKI_MEMORY_PINNED_BUDGET: "1200" })).toMatchObject({ pinnedBudget: 1200 });
  });

  it("fails the boot on a garbage budget rather than guessing one", () => {
    for (const value of ["abc", "0", "-1", "3.5", ""]) {
      expect(() => loadMemoryConfig({ TAKI_MEMORY_PINNED_BUDGET: value })).toThrow();
    }
  });

  it("keeps the ruled weight direction in its default: disclosure and search_terms above content", () => {
    // Under unicode61 the raw content column is nearly dead for CJK, so carrying its old top weight would rank an
    // incidental mention above a written recall trigger (see the ranking test in memory/fts5-search.test.ts).
    expect(DEFAULT_BM25_WEIGHTS.disclosure).toBeGreaterThan(DEFAULT_BM25_WEIGHTS.content);
    expect(DEFAULT_BM25_WEIGHTS.searchTerms).toBeGreaterThan(DEFAULT_BM25_WEIGHTS.content);
  });

  it("parses the bm25 weight CSV in disclosure,content,searchTerms order", () => {
    expect(loadMemoryConfig({ TAKI_MEMORY_BM25_WEIGHTS: "3, 0.5 ,1.5" })).toMatchObject({
      bm25Weights: { disclosure: 3, content: 0.5, searchTerms: 1.5 },
    });
  });

  it("fails the boot on a malformed weight CSV — a mistyped ranking knob must not silently re-rank her memory", () => {
    for (const value of ["", "2,1", "2,1,2,4", "2,x,2", "2,0,2", "2,-1,2"]) {
      expect(() => loadMemoryConfig({ TAKI_MEMORY_BM25_WEIGHTS: value }), value).toThrow();
    }
  });

  it("takes the stoplist toggle as on/off only", () => {
    expect(loadMemoryConfig({ TAKI_MEMORY_STOPLIST: "off" })).toMatchObject({ stoplist: false });
    expect(loadMemoryConfig({ TAKI_MEMORY_STOPLIST: "on" })).toMatchObject({ stoplist: true });
    // An unrecognized value is fatal in EITHER direction: a typo that quietly means on is a lie, and one that
    // quietly means off silently widens every result set.
    for (const value of ["true", "1", "yes", ""]) {
      expect(() => loadMemoryConfig({ TAKI_MEMORY_STOPLIST: value }), value).toThrow();
    }
  });
});
