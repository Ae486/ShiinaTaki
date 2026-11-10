/**
 * INPUT:  characterId/costume/settingsFile triples + a CharacterCostumesResult.
 * OUTPUT: native-selected-root settings/resource URLs and traversal-safe Core metadata resolution.
 * POS: unit tests for the asset composition boundary; actual protocol scope is tested by native acceptance.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { CharacterCostumesResult } from "@taki/shared";
import { characterCostumeUrl, costumeAssetResolver, costumeSettingsSegments, resolveResourcePath, resolveSettingsFile, resourceSegments } from "./character-asset-url.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn((path: string) => `asset://${path}`) }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue("G:/isolated profile/workspace/characters"); });

const COSTUMES: CharacterCostumesResult = {
  costumes: ["arbeit", "live_01"],
  defaultCostume: "arbeit",
  settingsFilesByCostume: { arbeit: "model.json", live_01: "adv_live2d_taki_005_live_01.model3.json" },
};

describe("costumeSettingsSegments", () => {
  it("keeps metadata relative to the native-selected characters root", () => {
    expect(costumeSettingsSegments("taki", "arbeit", "model.json")).toEqual([
      "taki",
      "arbeit",
      "model.json",
    ]);
  });

  it("keeps a Cubism 3 costume's full settings filename verbatim", () => {
    const segments = costumeSettingsSegments("taki", "live_01", "adv_live2d_taki_005_live_01.model3.json");
    expect(segments.at(-1)).toBe("adv_live2d_taki_005_live_01.model3.json");
    expect(segments.slice(0, 2)).toEqual(["taki", "live_01"]);
  });
});

describe("native character root composition", () => {
  it("uses one native-selected root for settings, local resources and resolved cross-character resources", async () => {
    const source = await costumeAssetResolver({ characterId: "taki", costume: "imported", settingsFile: "model.json",
      resolution: { "../shared/idle.mtn": "sakiko/shared/idle.mtn" } });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("local_characters_root");
    expect(source.settingsUrl).toBe("asset://G:/isolated profile/workspace/characters/taki/imported/model.json");
    expect(source.resolve("textures/one.png")).toBe("asset://G:/isolated profile/workspace/characters/taki/imported/textures/one.png");
    expect(source.resolve("../shared/idle.mtn")).toBe("asset://G:/isolated profile/workspace/characters/sakiko/shared/idle.mtn");
    expect(source.resolve("../unresolved/outside.png")).toBeNull();
  });

  it("uses the same native root in the direct settings URL helper", async () => {
    expect(await characterCostumeUrl("taki", "imported", "model3.json"))
      .toBe("asset://G:/isolated profile/workspace/characters/taki/imported/model3.json");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("local_characters_root");
  });

  it("preserves native failures without falling back to a daily-profile path", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("selected characters unavailable"));
    await expect(characterCostumeUrl("taki", "imported", "model.json")).rejects.toThrow("selected characters unavailable");
    await expect(costumeAssetResolver({ characterId: "taki", costume: "imported", settingsFile: "model.json", resolution: {} }))
      .rejects.toThrow("selected characters unavailable");
    expect(convertFileSrc).not.toHaveBeenCalled();
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
