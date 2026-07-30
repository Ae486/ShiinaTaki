import { describe, expect, it } from "vitest";
import { CJK_STOPWORDS, createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

const on = createIntlSegmenterTokenizer({ stoplist: true });
const off = createIntlSegmenterTokenizer({ stoplist: false });

describe("search tokenizer (the D53 seam, Intl.Segmenter v1)", () => {
  it("segments CJK prose into dictionary words rather than characters", () => {
    // Character-splitting would make every 2-char word a pair of near-useless single-char terms.
    expect(on.tokenize("吃了豚骨拉面")).toContain("拉面");
    expect(on.tokenize("答应周五一起看电影")).toEqual(expect.arrayContaining(["答应", "周五", "一起", "电影"]));
  });

  it("keeps mixed CJK+ASCII identifiers intact (the case a per-character split destroys)", () => {
    expect(on.tokenize("今天用VSCode写了TypeScript代码")).toEqual(
      expect.arrayContaining(["今天", "vscode", "typescript", "代码"]),
    );
    expect(on.tokenize("用户正在开发一个叫TakiAgent的桌面宠物项目")).toContain("takiagent");
  });

  it("folds case so the index and a differently-cased query agree", () => {
    expect(on.tokenize("VSCode")).toEqual(["vscode"]);
    expect(on.tokenize("vscode")).toEqual(["vscode"]);
  });

  it("deduplicates repeats — the column stores a term set, not a term count", () => {
    expect(on.tokenize("拉面拉面拉面")).toEqual(["拉面"]);
  });

  it("drops punctuation and whitespace (they would become quoted FTS5 literals)", () => {
    expect(on.tokenize("记住：用户对香菜过敏！")).toEqual(["记住", "用户", "对", "香菜", "过敏"]);
    expect(on.tokenize("？？？ ，，")).toEqual([]);
  });

  it("applies the stoplist only when asked, and never drops a content word", () => {
    expect(on.tokenize("我对什么过敏")).toEqual(["对", "过敏"]);
    expect(off.tokenize("我对什么过敏")).toEqual(["我", "对", "什么", "过敏"]);
    // Every stopword is a function word: none of them can be the only handle on a memory.
    expect(CJK_STOPWORDS).not.toContain("拉面");
    expect(new Set(CJK_STOPWORDS).size).toBe(CJK_STOPWORDS.length);
  });

  it("returns an empty list for text with nothing word-like (the caller's LIKE-fallback trigger)", () => {
    expect(on.tokenize("")).toEqual([]);
    expect(on.tokenize("的了是")).toEqual([]);
    expect(off.tokenize("!!!")).toEqual([]);
  });
});
