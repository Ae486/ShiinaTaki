import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from "./frontmatter.ts";

// Round-trip a single string value through the serializer + parser (research §1 adversarial set).
function roundTripString(value: string): FrontmatterValueResult {
  const text = serializeFrontmatter({ disclosure: value }, "body");
  const { data, body } = parseFrontmatter(text);
  return { value: data.disclosure, body };
}
interface FrontmatterValueResult {
  value: unknown;
  body: string;
}

describe("frontmatter subset (T2)", () => {
  const adversarial: Record<string, string> = {
    colon_space: "约定: 周五 19:00 看电影",
    quotes: 'she said "记住这个" ok',
    backslash: "C:\\Users\\taki \\n not-a-newline",
    leading_trailing_spaces: "  两边有空格  ",
    cjk_emoji: "吃了豚骨拉面🍜 超好吃🎉",
    hash_comment_lookalike: "#不是注释 # 也不是",
    yaml_specials: "- [not, a, list] {not: a, map} | > & * ! % @ `",
    fence_lookalike: "---",
    numeric_string_stays_string: "0042",
    empty_string: "",
    iso_created: "2026-07-10T09:30:00.000Z",
  };

  for (const [name, value] of Object.entries(adversarial)) {
    it(`round-trips string: ${name}`, () => {
      const result = roundTripString(value);
      expect(result.value).toBe(value);
      expect(result.body).toBe("body");
    });
  }

  it("keeps numbers and booleans bare and typed", () => {
    const text = serializeFrontmatter({ importance: 9, emotional_weight: 0.75, done: false }, "");
    const { data } = parseFrontmatter(text);
    expect(data.importance).toBe(9);
    expect(data.emotional_weight).toBe(0.75);
    expect(data.done).toBe(false);
  });

  it("round-trips a full CJK record with a multi-field body byte-for-byte", () => {
    const body = "答应周五一起看电影 🎬\n第二行";
    const data: FrontmatterData = { id: "0001-约定", importance: 10, disclosure: "约定,拉面" };
    const { data: back, body: bodyBack } = parseFrontmatter(serializeFrontmatter(data, body));
    expect(back).toEqual(data);
    expect(bodyBack).toBe(body);
  });

  it("parses a hand-edited unquoted CJK value as a trimmed string", () => {
    const { data } = parseFrontmatter("---\ndisclosure: 拉面相关的时候\n---\n");
    expect(data.disclosure).toBe("拉面相关的时候");
  });

  it("rejects a newline inside a value at write time", () => {
    expect(() => serializeFrontmatter({ disclosure: "line1\nline2" }, "")).toThrow(/newline/);
  });

  it("rejects a colon-less frontmatter line", () => {
    expect(() => parseFrontmatter("---\nnope\n---\n")).toThrow(/colon/);
  });

  it("rejects a duplicate key", () => {
    expect(() => parseFrontmatter('---\nid: "a"\nid: "b"\n---\n')).toThrow(/duplicate/);
  });

  it("rejects a missing closing fence", () => {
    expect(() => parseFrontmatter('---\nid: "a"\n')).toThrow(/closing/);
  });

  it("rejects an invalid key", () => {
    expect(() => parseFrontmatter('---\nBad-Key: "a"\n---\n')).toThrow(/invalid key/);
  });

  it("accepts a hyphenated key (SKILL.md allowed-tools relaxation, T18)", () => {
    const { data } = parseFrontmatter('---\nname: my-skill\nallowed-tools: "Read, Grep"\n---\nbody');
    expect(data.name).toBe("my-skill");
    expect(data["allowed-tools"]).toBe("Read, Grep");
  });
});
