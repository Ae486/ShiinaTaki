/**
 * INPUT:  characterId/costume/settingsFile triples + a CharacterCostumesResult.
 * OUTPUT: assertions that the Workspace-relative segments match Phase A's characters/ layout + the asset-protocol
 *         scope, and that settingsFile resolution reads the Core's map (never guesses) and degrades on an unknown id.
 * POS:    unit test for character-asset-url's pure core (T8). convertFileSrc/homeDir are Tauri-bound (not unit-tested
 *         here — they're the thin seam); the composition + lookup that CAN go wrong is. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { CharacterCostumesResult } from "@taki/shared";
import { costumeSettingsSegments, resolveSettingsFile } from "./character-asset-url.ts";

const COSTUMES: CharacterCostumesResult = {
  costumes: ["arbeit", "live_01"],
  defaultCostume: "arbeit",
  settingsFilesByCostume: { arbeit: "model.json", live_01: "adv_live2d_taki_005_live_01.model3.json" },
};

describe("costumeSettingsSegments", () => {
  it("builds the Workspace-relative path matching the characters/ layout + asset scope", () => {
    expect(costumeSettingsSegments("taki", "arbeit", "model.json")).toEqual([
      ".takiagent",
      "workspace",
      "characters",
      "taki",
      "arbeit",
      "model.json",
    ]);
  });

  it("keeps a Cubism 3 costume's full settings filename verbatim", () => {
    const segments = costumeSettingsSegments("taki", "live_01", "adv_live2d_taki_005_live_01.model3.json");
    expect(segments.at(-1)).toBe("adv_live2d_taki_005_live_01.model3.json");
    expect(segments.slice(0, 3)).toEqual([".takiagent", "workspace", "characters"]);
  });
});

describe("resolveSettingsFile", () => {
  it("reads the Core-provided settings filename per costume (never guesses the manifest name)", () => {
    expect(resolveSettingsFile(COSTUMES, "arbeit")).toBe("model.json");
    expect(resolveSettingsFile(COSTUMES, "live_01")).toBe("adv_live2d_taki_005_live_01.model3.json");
  });

  it("returns null for a costume the character does not have", () => {
    expect(resolveSettingsFile(COSTUMES, "nope")).toBeNull();
  });
});
