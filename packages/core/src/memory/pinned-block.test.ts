import { describe, expect, it } from "vitest";
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import { selectPinned } from "./pinned-block.ts";

function row(over: Partial<MemoryEntryRow> & Pick<MemoryEntryRow, "id" | "layer" | "content">): MemoryEntryRow {
  return {
    path: `/m/${over.id}.md`,
    characterId: "taki",
    importance: 9,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    origin: "self",
    expiresAt: null,
    disclosure: "",
    ...over,
  };
}

describe("pinned-block never-truncate (T10, AC 4/11)", () => {
  it("keeps all relationship rows and drops the OLDEST truncatable (profile) first under pressure", () => {
    const rows = [
      row({ id: "r1", layer: "relationship", content: "约定一", createdAt: "2026-02-01T00:00:00.000Z" }),
      row({ id: "p-old", layer: "profile", content: "旧事实" + "记".repeat(20), createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: "p-new", layer: "profile", content: "新事实", createdAt: "2026-03-01T00:00:00.000Z" }),
    ];
    // Budget fits relationship + the small new profile fact, but not the big old one.
    const kept = selectPinned(rows, 12);
    const ids = kept.map((r) => r.id);
    expect(ids).toContain("r1"); // relationship never dropped
    expect(ids).toContain("p-new"); // newer truncatable kept
    expect(ids).not.toContain("p-old"); // oldest truncatable dropped first
  });

  it("keeps relationship even when it alone exceeds the budget; all truncatable drop", () => {
    const rows = [
      row({ id: "r-huge", layer: "relationship", content: "约".repeat(2000) }),
      row({ id: "p1", layer: "profile", content: "小事实", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const kept = selectPinned(rows, 50);
    expect(kept.map((r) => r.id)).toEqual(["r-huge"]); // only relationship survives
  });

  it("excludes retrieved-layer entries below the pin threshold (profile < 9)", () => {
    const rows = [
      row({ id: "p-hi", layer: "profile", importance: 9, content: "重要事实" }),
      row({ id: "p-lo", layer: "profile", importance: 5, content: "普通事实" }),
    ];
    expect(selectPinned(rows, 800).map((r) => r.id)).toEqual(["p-hi"]);
  });

  it("orders the block deterministically by registry layer order then chronologically", () => {
    const rows = [
      row({ id: "r1", layer: "relationship", content: "约定", createdAt: "2026-05-01T00:00:00.000Z" }),
      row({ id: "p1", layer: "profile", importance: 9, content: "事实甲", createdAt: "2026-02-01T00:00:00.000Z" }),
      row({ id: "p2", layer: "profile", importance: 9, content: "事实乙", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    // profile (registry index 0) before relationship (index 2); within profile, oldest first.
    expect(selectPinned(rows, 800).map((r) => r.id)).toEqual(["p2", "p1", "r1"]);
  });
});
