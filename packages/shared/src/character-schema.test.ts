import { describe, expect, it } from "vitest";
import {
  CHARACTER_METHODS,
  CharacterCostumeResolutionParamsSchema,
  CharacterCostumeResolutionResultSchema,
  CharacterCostumesParamsSchema,
  CharacterCostumesResultSchema,
  CharacterIdSchema,
  CharacterImportErrorSchema,
  CharacterImportParamsSchema,
  CharacterImportResultSchema,
  CharacterListParamsSchema,
  CharacterListResultSchema,
  CostumeAvailabilitySchema,
} from "./character-schema.ts";

describe("CHARACTER_METHODS", () => {
  it("names the four character methods", () => {
    expect(CHARACTER_METHODS).toEqual({
      import: "character.import",
      list: "character.list",
      costumes: "character.costumes",
      costumeResolution: "character.costumeResolution",
    });
  });
});

describe("CharacterIdSchema (the addressable slug)", () => {
  it("accepts lowercase slugs and rejects unsafe / mis-cased ids", () => {
    for (const ok of ["taki", "asuka", "my-model_2", "a", "0"]) {
      expect(CharacterIdSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["", "Taki", "../etc", "a/b", "-lead", "_lead", "with space", "x".repeat(65)]) {
      expect(CharacterIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("character.import schemas (T6)", () => {
  it("round-trips import params (with and without an explicit id)", () => {
    const withId = { sourceKind: "zst" as const, archiveBase64: "AQID", fileName: "taki.zst", characterId: "taki" };
    expect(CharacterImportParamsSchema.parse(withId)).toEqual(withId);
    const noId = { sourceKind: "zip" as const, archiveBase64: "AQID", fileName: "model.zip" };
    expect(CharacterImportParamsSchema.parse(noId)).toEqual(noId);
  });

  it("round-trips the import result including settingsFilesByCostume + warnings", () => {
    const result = {
      characterId: "taki",
      costumes: ["arbeit", "casual", "live_01"],
      defaultCostume: "casual",
      settingsFilesByCostume: { arbeit: "model.json", casual: "model.json", live_01: "taki.model3.json" },
      warnings: ["costume 'casual': 397 optional motion files not found"],
    };
    expect(CharacterImportResultSchema.parse(result)).toEqual(result);
  });

  it("rejects an empty archive, an empty fileName, and a mis-cased characterId", () => {
    expect(CharacterImportParamsSchema.safeParse({ sourceKind: "zst", archiveBase64: "", fileName: "x.zst" }).success).toBe(false);
    expect(CharacterImportParamsSchema.safeParse({ sourceKind: "zst", archiveBase64: "AQID", fileName: "" }).success).toBe(false);
    expect(
      CharacterImportParamsSchema.safeParse({ sourceKind: "zst", archiveBase64: "AQID", fileName: "x", characterId: "BAD" }).success,
    ).toBe(false);
    expect(CharacterImportParamsSchema.safeParse({ sourceKind: "rar", archiveBase64: "AQID", fileName: "x" }).success).toBe(false);
  });
});

describe("character.list + character.costumes schemas (T6)", () => {
  it("round-trips list params + result", () => {
    expect(CharacterListParamsSchema.parse({})).toEqual({});
    const result = {
      characters: [
        {
          characterId: "taki",
          costumes: ["casual"],
          defaultCostume: "casual",
          settingsFilesByCostume: { casual: "model.json" },
          source: "zst" as const,
        },
      ],
    };
    expect(CharacterListResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips costumes params + result (current is optional)", () => {
    expect(CharacterCostumesParamsSchema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
    const result = { costumes: ["casual", "live_01"], defaultCostume: "casual", settingsFilesByCostume: { casual: "model.json", live_01: "x.model3.json" } };
    expect(CharacterCostumesResultSchema.parse(result)).toEqual(result);
    expect(CharacterCostumesResultSchema.parse({ ...result, current: "live_01" }).current).toBe("live_01");
  });

  it("keeps availability optional on the costumes result and round-trips it when present", () => {
    const base = { costumes: ["casual"], defaultCostume: "casual", settingsFilesByCostume: { casual: "model.json" } };
    expect(CharacterCostumesResultSchema.parse(base).availability).toBeUndefined();
    const availability = { casual: { renderable: true, missingMotions: 75, missingPacks: ["anon", "sakiko"] } };
    expect(CharacterCostumesResultSchema.parse({ ...base, availability }).availability).toEqual(availability);
    expect(CostumeAvailabilitySchema.safeParse({ renderable: true, missingMotions: "75", missingPacks: [] }).success).toBe(false);
  });
});

describe("character.costumeResolution schemas", () => {
  it("round-trips params and rejects an empty costume", () => {
    const params = { characterId: "taki", costume: "casual" };
    expect(CharacterCostumeResolutionParamsSchema.parse(params)).toEqual(params);
    expect(CharacterCostumeResolutionParamsSchema.safeParse({ characterId: "taki", costume: "" }).success).toBe(false);
  });

  it("round-trips a resolution map with resolved and null entries", () => {
    const result = {
      resolution: {
        "../_mtn_emp/taki/angry01.mtn": "taki/arbeit/motions/angry01.mtn",
        "../_mtn_emp/sakiko/rare01.mtn": null,
      },
    };
    expect(CharacterCostumeResolutionResultSchema.parse(result)).toEqual(result);
    expect(CharacterCostumeResolutionResultSchema.safeParse({ resolution: { a: 1 } }).success).toBe(false);
  });
});

describe("CharacterImportErrorSchema", () => {
  it("is the closed clean-room import-error vocabulary", () => {
    expect(CharacterImportErrorSchema.options).toEqual([
      "no_model_json",
      "bad_model_json",
      "missing_moc",
      "missing_textures",
      "unsafe_resource_path",
      "bad_zip",
      "bad_zst",
      "name_exists",
      "invalid_name",
    ]);
  });
});
