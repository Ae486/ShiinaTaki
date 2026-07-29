import { describe, expect, it } from "vitest";
import { entryFromFile, entryToFile, type MemoryEntry } from "./entry.ts";

const BASE: MemoryEntry = {
  id: "0001-ramen",
  layer: "episodes",
  importance: 5,
  created: "2026-07-28T09:30:00.000Z",
  status: "active",
  origin: "self",
};

describe("entry codec origin (T5 Q8)", () => {
  it("defaults a pre-T5 file with no origin key to 'self'", () => {
    // Files are truth and every entry written before T5 lacks the key — parsing must not break on them.
    const legacy = [
      "---",
      'id: "0001-ramen"',
      'layer: "episodes"',
      "importance: 5",
      'created: "2026-07-01T00:00:00.000Z"',
      'status: "active"',
      "---",
      "他喜欢拉面",
    ].join("\n");

    const { entry, body } = entryFromFile(legacy);
    expect(entry.origin).toBe("self");
    expect(body).toBe("他喜欢拉面");
  });

  it("round-trips an observed origin", () => {
    const { entry } = entryFromFile(entryToFile({ ...BASE, origin: "observed" }, "[image] 桌上有一杯咖啡"));
    expect(entry.origin).toBe("observed");
  });

  it("rejects an origin value outside the closed set", () => {
    const text = entryToFile(BASE, "body").replace('origin: "self"', 'origin: "borrowed"');
    expect(() => entryFromFile(text)).toThrow();
  });
});

describe("entry codec reinforcement fields (T5-R9)", () => {
  it("round-trips updated + reinforce_count through the snake_case disk keys", () => {
    const text = entryToFile({ ...BASE, updated: "2026-07-29T10:00:00.000Z", reinforceCount: 2 }, "他喜欢拉面");
    expect(text).toContain("reinforce_count: 2");
    expect(text).toContain('updated: "2026-07-29T10:00:00.000Z"');

    const { entry, body } = entryFromFile(text);
    expect(entry.updated).toBe("2026-07-29T10:00:00.000Z");
    expect(entry.reinforceCount).toBe(2);
    expect(body).toBe("他喜欢拉面");
  });

  it("omits both keys entirely for an entry that was never reinforced", () => {
    const text = entryToFile(BASE, "他喜欢拉面");
    expect(text).not.toContain("updated:");
    expect(text).not.toContain("reinforce_count:");

    const { entry } = entryFromFile(text);
    expect(entry.updated).toBeUndefined();
    expect(entry.reinforceCount).toBeUndefined();
  });

  it("round-trips every optional field alongside the new ones", () => {
    const full: MemoryEntry = {
      ...BASE,
      disclosure: "用户问自己叫什么",
      emotionalWeight: 0.75,
      expires: "2027-01-01T00:00:00.000Z",
      origin: "observed",
      updated: "2026-07-29T10:00:00.000Z",
      reinforceCount: 1,
    };
    expect(entryFromFile(entryToFile(full, "body")).entry).toEqual(full);
  });
});
