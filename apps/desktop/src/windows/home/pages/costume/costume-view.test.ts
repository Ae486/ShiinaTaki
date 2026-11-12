/**
 * INPUT:  character.costumes result fixtures + a remembered costume (no DOM, no socket).
 * OUTPUT: assertions for the ordering (renderable first), the missing-motion badges, the missing-pack union and the
 *         initial highlight — the rules migrated from the retired pet-side panel.
 * POS:    unit test for windows/home/pages/costume/costume-view. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { CharacterCostumesResult } from "@taki/shared";

import { costumeListView } from "./costume-view.ts";

const RESULT: CharacterCostumesResult = {
  costumes: ["broken", "casual", "school"],
  defaultCostume: "school",
  settingsFilesByCostume: { broken: "b.model3.json", casual: "c.model3.json", school: "s.model3.json" },
  availability: {
    broken: { renderable: false, missingMotions: 0, missingPacks: ["kasumi"] },
    casual: { renderable: true, missingMotions: 3, missingPacks: ["arisa"] },
    school: { renderable: true, missingMotions: 0, missingPacks: [] },
  },
};

describe("costumeListView", () => {
  it("orders renderable costumes first and disables the rest", () => {
    const view = costumeListView(RESULT);

    expect(view.rows.map((row) => row.id)).toEqual(["casual", "school", "broken"]);
    expect(view.rows.at(-1)).toMatchObject({ id: "broken", renderable: false });
  });

  it("badges a degraded costume with its missing-motion count, and leaves a complete one bare", () => {
    const view = costumeListView(RESULT);

    expect(view.rows[0]?.badge).toContain("3");
    expect(view.rows[1]?.badge).toBeNull();
  });

  it("unions the missing packs across costumes, sorted", () => {
    expect(costumeListView(RESULT).missingPacks).toEqual(["arisa", "kasumi"]);
  });

  it("does not turn the marker default into a worn-costume claim", () => {
    expect(costumeListView(RESULT)).not.toHaveProperty("current");
  });

  it("handles a result with no availability metadata as fully renderable", () => {
    const bare = { ...RESULT, availability: undefined };

    const view = costumeListView(bare);

    expect(view.rows.every((row) => row.renderable && row.badge === null)).toBe(true);
    expect(view.missingPacks).toEqual([]);
  });
});
