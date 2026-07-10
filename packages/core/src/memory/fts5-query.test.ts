import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "./fts5-query.ts";

describe("FTS5 query hygiene (T8 sanitizer, leader ruling 2)", () => {
  it("expands a >= 3-char token into overlapping trigrams, OR-ed", () => {
    // A single 3-char token is exactly one trigram.
    expect(buildFtsQuery("豚骨拉")).toEqual({ kind: "match", match: '"豚骨拉"' });
    // A longer CJK phrase decomposes into overlapping windows (the trigram index is matched the same way).
    expect(buildFtsQuery("豚骨拉面")).toEqual({ kind: "match", match: '"豚骨拉" OR "骨拉面"' });
  });

  it("drops sub-3-char tokens but keeps trigrams from the long ones", () => {
    expect(buildFtsQuery("看电影 vs")).toEqual({ kind: "match", match: '"看电影"' });
  });

  it("quotes raw FTS5 syntax so it is a literal substring, never a syntax error", () => {
    // Unquoted `拉面?` throws an fts5 syntax error; quoted (one trigram 拉面?) it is safe (research §3).
    expect(buildFtsQuery("拉面?")).toEqual({ kind: "match", match: '"拉面?"' });
    // Internal double-quotes are doubled inside the quoted trigram.
    expect(buildFtsQuery("他\"说")).toEqual({ kind: "match", match: '"他""说"' });
  });

  it("falls back to an escaped LIKE when every token is under 3 chars (common 2-char CJK words)", () => {
    expect(buildFtsQuery("拉面")).toEqual({ kind: "like", like: "%拉面%" });
    expect(buildFtsQuery("_x")).toEqual({ kind: "like", like: "%\\_x%" });
  });

  it("treats blank input as empty", () => {
    expect(buildFtsQuery("")).toEqual({ kind: "empty" });
    expect(buildFtsQuery("   ")).toEqual({ kind: "empty" });
  });
});
