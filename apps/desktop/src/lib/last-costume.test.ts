/**
 * INPUT:  characterId/costume pairs + a fake Storage.
 * OUTPUT: assertions that the last-worn costume round-trips per character and absent/blank values load as null.
 * POS:    unit test for lib/last-costume (the restart-persistence seam behind B7/B19).
 */

import { describe, expect, it } from "vitest";
import { loadLastCostume, saveLastCostume } from "./last-costume.ts";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("last-costume", () => {
  it("round-trips the last-worn costume per character", () => {
    const storage = fakeStorage();
    saveLastCostume("taki", "casual", storage);
    saveLastCostume("anon", "live_01", storage);
    expect(loadLastCostume("taki", storage)).toBe("casual");
    expect(loadLastCostume("anon", storage)).toBe("live_01");
  });

  it("loads null when nothing was saved or the value is blank", () => {
    const storage = fakeStorage();
    expect(loadLastCostume("taki", storage)).toBeNull();
    storage.setItem("taki.last-costume.taki", "");
    expect(loadLastCostume("taki", storage)).toBeNull();
  });
});
