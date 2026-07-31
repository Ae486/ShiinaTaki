import { describe, expect, it } from "vitest";
import {
  DEFAULT_BM25_WEIGHTS,
  DEFAULT_INTENTIONS_DAYS,
  DEFAULT_PINNED_BUDGET,
  DEFAULT_TIDY_MAX_STEPS,
  DEFAULT_TIDY_REPORT_CAP,
  DEFAULT_TIDY_STALE_DAYS,
  DEFAULT_TIDY_WRITE_THRESHOLD,
  loadMemoryConfig,
} from "./memory-config.ts";

const DEFAULTS = {
  pinnedBudget: DEFAULT_PINNED_BUDGET,
  bm25Weights: DEFAULT_BM25_WEIGHTS,
  stoplist: true,
  intentionsDefaultDays: DEFAULT_INTENTIONS_DAYS,
  tidyWriteThreshold: DEFAULT_TIDY_WRITE_THRESHOLD,
  tidyMaxSteps: DEFAULT_TIDY_MAX_STEPS,
  tidyStaleDays: DEFAULT_TIDY_STALE_DAYS,
  reportClassCap: DEFAULT_TIDY_REPORT_CAP,
};

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

  it("takes the intentions retention window and fails the boot on a garbage one", () => {
    expect(DEFAULT_INTENTIONS_DAYS).toBe(30);
    expect(loadMemoryConfig({ TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: "7" })).toMatchObject({
      intentionsDefaultDays: 7,
    });
    for (const value of ["abc", "0", "-1", "1.5", ""]) {
      expect(() => loadMemoryConfig({ TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: value }), value).toThrow();
    }
  });

  it("ships the tidy numbers with their fail-closed defaults (batch 4b)", () => {
    expect(DEFAULT_TIDY_WRITE_THRESHOLD).toBe(40);
    expect(DEFAULT_TIDY_MAX_STEPS).toBe(12);
    expect(DEFAULT_TIDY_STALE_DAYS).toBe(45);
    expect(DEFAULT_TIDY_REPORT_CAP).toBe(10);
  });

  it("takes each tidy override and fails the boot on a garbage one", () => {
    expect(
      loadMemoryConfig({
        TAKI_MEMORY_TIDY_WRITE_THRESHOLD: "5",
        TAKI_MEMORY_TIDY_MAX_STEPS: "3",
        TAKI_MEMORY_TIDY_STALE_DAYS: "90",
        TAKI_MEMORY_TIDY_REPORT_CAP: "2",
      }),
    ).toMatchObject({ tidyWriteThreshold: 5, tidyMaxSteps: 3, tidyStaleDays: 90, reportClassCap: 2 });
    for (const name of [
      "TAKI_MEMORY_TIDY_WRITE_THRESHOLD",
      "TAKI_MEMORY_TIDY_MAX_STEPS",
      "TAKI_MEMORY_TIDY_STALE_DAYS",
      "TAKI_MEMORY_TIDY_REPORT_CAP",
    ]) {
      for (const value of ["abc", "0", "-1", "1.5", ""]) {
        expect(() => loadMemoryConfig({ [name]: value }), `${name}=${value}`).toThrow();
      }
    }
  });
});
