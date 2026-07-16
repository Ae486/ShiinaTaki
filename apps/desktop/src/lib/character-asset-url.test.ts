/**
 * INPUT:  characterId/costume/settingsFile triples + a CharacterCostumesResult.
 * OUTPUT: assertions that the Workspace-relative segments match Phase A's characters/ layout + the asset-protocol
 *         scope, and that settingsFile resolution reads the Core's map (never guesses) and degrades on an unknown id.
 * POS:    unit test for character-asset-url's pure core (T8). convertFileSrc/homeDir are Tauri-bound (not unit-tested
 *         here — they're the thin seam); the composition + lookup that CAN go wrong is. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { CharacterCostumesResult } from "@taki/shared";
import { costumeSettingsSegments, resolveResourcePath, resolveSettingsFile, resourceSegments } from "./character-asset-url.ts";

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

describe("resourceSegments", () => {
  // These feed the per-sub-resource asset URL that fixes the dropped-prefix defect (rc-asset-suburl-defect.md):
  // each settings-relative ref becomes its own absolute path, so the engine never relative-joins it.
  it("splits a nested POSIX ref into clean segments", () => {
    expect(resourceSegments("data/textures/texture_00.png")).toEqual(["data", "textures", "texture_00.png"]);
    expect(resourceSegments("model.moc")).toEqual(["model.moc"]);
  });

  it("drops leading ./ and empty segments so the joined path stays clean", () => {
    expect(resourceSegments("./data/model.moc")).toEqual(["data", "model.moc"]);
    expect(resourceSegments("data//model.moc")).toEqual(["data", "model.moc"]);
  });
});

describe("resolveResourcePath (the fail-safe: `..` never reaches convertFileSrc)", () => {
  const RESOLUTION = {
    "../_mtn_emp/taki/hit.mtn": "taki/arbeit/motions/hit.mtn",
    "../_mtn_emp/sakiko/gone.mtn": null,
  };

  it("keeps a plain ref costume-relative", () => {
    expect(resolveResourcePath("motions/idle.mtn", RESOLUTION)).toEqual({
      kind: "costume",
      segments: ["motions", "idle.mtn"],
    });
  });

  it("maps a Core-resolved external ref to characters-root segments", () => {
    expect(resolveResourcePath("../_mtn_emp/taki/hit.mtn", RESOLUTION)).toEqual({
      kind: "characters",
      segments: ["taki", "arbeit", "motions", "hit.mtn"],
    });
  });

  it("returns null for a null-resolved ref and for any `..` ref without a resolution entry", () => {
    expect(resolveResourcePath("../_mtn_emp/sakiko/gone.mtn", RESOLUTION)).toBeNull();
    expect(resolveResourcePath("../_mtn_emp/unknown/x.mtn", {})).toBeNull();
    expect(resolveResourcePath("a/../../escape.png", {})).toBeNull();
  });

  it("rejects a resolution value that itself carries `..` (defense against a corrupted map)", () => {
    expect(resolveResourcePath("ref.mtn", { "ref.mtn": "../outside.mtn" })).toBeNull();
  });

  // Cubism 3 manifests have optional file slots (physics/pose); the engine's replaceFiles hands their null through
  // its `string`-typed callback — six C3 costumes crashed on `null.includes` before this guard (B13).
  it("returns null for a non-string or empty ref instead of crashing", () => {
    expect(resolveResourcePath(null as unknown as string, {})).toBeNull();
    expect(resolveResourcePath(undefined as unknown as string, {})).toBeNull();
    expect(resolveResourcePath("", {})).toBeNull();
  });
});
