import { describe, expect, it } from "vitest";
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import { findDuplicate, normalizeForDedupe } from "./dedupe.ts";

function row(id: string, content: string): MemoryEntryRow {
  return {
    path: `/m/${id}.md`,
    id,
    layer: "episodes",
    characterId: "taki",
    importance: 5,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    origin: "self",
    expiresAt: null,
    disclosure: "",
    content,
  };
}

describe("normalizeForDedupe (T5-R9 comparison key)", () => {
  it("collapses trailing and inner punctuation, CJK and ASCII alike", () => {
    expect(normalizeForDedupe("他喜欢拉面。")).toBe(normalizeForDedupe("他喜欢拉面"));
    // Punctuation is dropped outright (no separator inserted), so quoting marks cannot fork one memory into two.
    expect(normalizeForDedupe("他说：「很烦」")).toBe(normalizeForDedupe("他说很烦"));
    expect(normalizeForDedupe("he likes ramen!")).toBe(normalizeForDedupe("he likes ramen"));
  });

  it("casefolds ASCII and collapses runs of whitespace", () => {
    expect(normalizeForDedupe("Uses VSCode")).toBe(normalizeForDedupe("uses   vscode"));
    expect(normalizeForDedupe("  padded  text  ")).toBe("padded text");
  });

  it("normalizes to NFC so a decomposed sequence matches its composed form", () => {
    // One user-visible string, two Unicode encodings — a raw compare would call these different memories.
    const composed = "café";
    const decomposed = composed.normalize("NFD");
    expect(composed).not.toBe(decomposed);
    expect(normalizeForDedupe(composed)).toBe(normalizeForDedupe(decomposed));
  });

  it("keeps genuinely different content distinct", () => {
    expect(normalizeForDedupe("他喜欢拉面")).not.toBe(normalizeForDedupe("他讨厌拉面"));
  });
});

describe("findDuplicate", () => {
  it("returns the existing row whose content matches after normalization", () => {
    const rows = [row("0001-a", "他不喜欢人多的地方"), row("0002-b", "他喜欢吃豚骨拉面。")];
    expect(findDuplicate(rows, "他喜欢吃豚骨拉面")?.id).toBe("0002-b");
  });

  it("returns undefined when nothing matches (a genuinely new memory)", () => {
    expect(findDuplicate([row("0001-a", "他喜欢拉面")], "他周五要去看电影")).toBeUndefined();
  });

  it("returns undefined for an empty candidate set", () => {
    expect(findDuplicate([], "他喜欢拉面")).toBeUndefined();
  });

  it("returns undefined when the incoming content normalizes to nothing", () => {
    // Punctuation-only content has an empty key, which would otherwise match every other empty-key row.
    expect(findDuplicate([row("0001-a", "。。。")], "！！！")).toBeUndefined();
    expect(findDuplicate([row("0001-a", "他喜欢拉面")], "   ")).toBeUndefined();
  });

  it("returns the FIRST match when several rows collapse to the same key", () => {
    const rows = [row("0001-a", "他喜欢拉面"), row("0002-b", "他喜欢拉面!")];
    expect(findDuplicate(rows, "他喜欢拉面")?.id).toBe("0001-a");
  });
});
