import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { IdSchema, assertSafeSegment, resolveWithin, slugify } from "./naming.ts";

describe("slugify (T3)", () => {
  it("keeps CJK and lowercases ASCII, collapsing punctuation to single dashes", () => {
    expect(slugify("吃了豚骨拉面")).toBe("吃了豚骨拉面");
    expect(slugify("Watched the new Godzilla movie!")).toBe("watched-the-new-godzilla-movie");
    expect(slugify("用 VSCode 写 TypeScript")).toBe("用-vscode-写-typescript");
  });

  it("trims leading/trailing separators and falls back to 'entry' for empty/all-symbol input", () => {
    expect(slugify("  ...!!!  ")).toBe("entry");
    expect(slugify("🍜🎉")).toBe("entry");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("caps length without leaving a trailing dash", () => {
    const slug = slugify("a".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("IdSchema (T3)", () => {
  it("accepts NNNN-slug ids including CJK slugs", () => {
    expect(IdSchema.safeParse("0001-约定").success).toBe(true);
    expect(IdSchema.safeParse("0042-watched-godzilla").success).toBe(true);
    expect(IdSchema.safeParse("12345-长").success).toBe(true); // >=4 digits
  });

  it("rejects ids that could traverse or carry separators", () => {
    for (const bad of ["0001-..", "0001-a/b", "0001-a\\b", "0001-a.b", "1-x", "abcd-x", "0001-"]) {
      expect(IdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("path containment (T4)", () => {
  const root = join("/tmp", "memory-root");

  it("resolves a legit entry path under the root", () => {
    const p = resolveWithin(root, "global", "profile", "0001-x.md");
    expect(p.startsWith(resolve(root))).toBe(true);
  });

  it("throws when a segment tries to escape the root", () => {
    expect(() => resolveWithin(root, "..", "..", "etc", "passwd")).toThrow(/escapes/);
    expect(() => resolveWithin(root, "characters", "..", "..", "outside")).toThrow(/escapes/);
  });

  it("assertSafeSegment rejects separators and traversal in characterId/layer", () => {
    expect(() => assertSafeSegment("taki", "characterId")).not.toThrow();
    for (const bad of ["..", "a/b", "a\\b", "a.b", "a b"]) {
      expect(() => assertSafeSegment(bad, "characterId")).toThrow(/safe path segment/);
    }
  });
});
