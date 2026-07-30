import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "./fts5-query.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
const noStoplist = createIntlSegmenterTokenizer({ stoplist: false });

describe("FTS5 query hygiene (T5 batch 3 — tokenizer-driven)", () => {
  it("segments a CJK phrase into words and ORs them — a 2-char word is a real token now, not a dead end", () => {
    // Under trigram this same input took the unranked LIKE path; it is a MATCH term after the migration.
    expect(buildFtsQuery(tokenizer, "拉面")).toEqual({ kind: "match", match: '"拉面"' });
    expect(buildFtsQuery(tokenizer, "豚骨拉面")).toEqual({ kind: "match", match: '"豚" OR "骨" OR "拉面"' });
  });

  it("keeps a mixed CJK+ASCII token intact and folds its case", () => {
    expect(buildFtsQuery(tokenizer, "今天用VSCode")).toEqual({ kind: "match", match: '"今天" OR "用" OR "vscode"' });
  });

  it("drops function words so the query carries only what discriminates", () => {
    expect(buildFtsQuery(tokenizer, "我对什么过敏")).toEqual({ kind: "match", match: '"对" OR "过敏"' });
    // Same text, stoplist off: every segment survives. The toggle is the only difference.
    expect(buildFtsQuery(noStoplist, "我对什么过敏")).toEqual({
      kind: "match",
      match: '"我" OR "对" OR "什么" OR "过敏"',
    });
  });

  it("deduplicates repeated terms (one quoted literal each)", () => {
    expect(buildFtsQuery(tokenizer, "拉面 拉面 电影")).toEqual({ kind: "match", match: '"拉面" OR "电影"' });
  });

  it("quotes every term so raw FTS5 syntax is a literal, never a syntax error", () => {
    // Unquoted, `?` throws an fts5 syntax error; here the segmenter drops it as non-word-like and quoting covers
    // whatever else arrives. The doubling branch still guards a quote that survives segmentation.
    expect(buildFtsQuery(tokenizer, "拉面?")).toEqual({ kind: "match", match: '"拉面"' });
    expect(buildFtsQuery(noStoplist, '他"说')).toEqual({ kind: "match", match: '"他" OR "说"' });
  });

  it("falls back to an escaped LIKE when nothing usable survives segmentation", () => {
    // Pure function words: the stoplist empties the term list, and a substring match beats returning nothing.
    expect(buildFtsQuery(tokenizer, "的了是")).toEqual({ kind: "like", like: "%的了是%" });
    // Punctuation is never word-like, so this degenerates with the stoplist off too.
    expect(buildFtsQuery(noStoplist, "???")).toEqual({ kind: "like", like: "%???%" });
    // LIKE wildcards inside degenerate input are escaped for the repo's ESCAPE '\' clause.
    expect(buildFtsQuery(tokenizer, "%_")).toEqual({ kind: "like", like: "%\\%\\_%" });
  });

  it("treats blank input as empty", () => {
    expect(buildFtsQuery(tokenizer, "")).toEqual({ kind: "empty" });
    expect(buildFtsQuery(tokenizer, "   ")).toEqual({ kind: "empty" });
  });
});
