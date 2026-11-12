import { describe, expect, it } from "vitest";
import { createLiveSearchTokenizer } from "./live-search-tokenizer.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

describe("live search tokenizer readiness", () => {
  it("refuses unknown policy even with an injected tokenizer and forces first publication", async () => {
    const search = createLiveSearchTokenizer(null, createIntlSegmenterTokenizer({ stoplist: true }));
    expect(search.ready()).toBe(false);
    expect(search.appliedStoplist()).toBeNull();
    expect(() => search.tokenizer.tokenize("我 喜欢 拉面")).toThrow("MEMORY_SEARCH_INDEX_UNAVAILABLE");
    let rebuilds = 0;
    await search.reconfigure(true, async (candidate, publish) => {
      rebuilds += 1;
      expect(candidate.tokenize("我 喜欢 拉面")).not.toContain("我");
      expect(search.ready()).toBe(false);
      publish();
      return { indexed: 1 };
    });
    expect(rebuilds).toBe(1);
    expect(search.ready()).toBe(true);
    expect(search.appliedStoplist()).toBe(true);
    await search.reconfigure(true, async () => { throw new Error("must not rebuild a proven matching policy"); });
  });

  it("keeps the known pairing while preparation runs and refuses overlapping changes", async () => {
    const search = createLiveSearchTokenizer(true);
    let release!: () => void;
    const preparing = new Promise<void>((resolve) => { release = resolve; });
    const pending = search.reconfigure(false, async (_candidate, publish) => {
      await preparing;
      publish();
      return { indexed: 1 };
    });
    expect(search.tokenizer.tokenize("我 喜欢 拉面")).not.toContain("我");
    await expect(search.reconfigure(true, async () => ({ indexed: 0 }))).rejects.toThrow("MEMORY_OPERATION_BUSY");
    release(); await pending;
    expect(search.appliedStoplist()).toBe(false);
    expect(search.tokenizer.tokenize("我 喜欢 拉面")).toContain("我");
  });

  it("preserves both known and unknown states after failed preparation and permits retry", async () => {
    for (const applied of [null, true] as const) {
      const search = createLiveSearchTokenizer(applied);
      await expect(search.reconfigure(false, async () => { throw new Error("index failure"); })).rejects.toThrow("index failure");
      expect(search.appliedStoplist()).toBe(applied);
      expect(search.ready()).toBe(applied !== null);
      await search.reconfigure(false, async (_candidate, publish) => { publish(); return { indexed: 0 }; });
      expect(search.ready()).toBe(true);
      expect(search.appliedStoplist()).toBe(false);
    }
  });
});
