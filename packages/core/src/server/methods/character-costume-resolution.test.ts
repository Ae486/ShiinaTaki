import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHARACTER_METHODS } from "@taki/shared";
import { createCharacterStore, type CharacterStore } from "../../characters/character-store.ts";
import { characterCostumeResolutionMethod } from "./character-costume-resolution.ts";

interface Fixture {
  store: CharacterStore;
  charactersDir: string;
}

const roots: string[] = [];
function fresh(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "taki-m-resolution-"));
  roots.push(root);
  const charactersDir = join(root, "characters");
  return { store: createCharacterStore({ charactersDir }), charactersDir };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(charactersDir: string, relPath: string, content = ""): void {
  const abs = join(charactersDir, ...relPath.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function seed(fixture: Fixture): void {
  fixture.store.writeMarker({
    characterId: "taki",
    source: "zst",
    importedAt: "2026-07-15T00:00:00.000Z",
    costumes: ["casual"],
    defaultCostume: "casual",
    settingsFilesByCostume: { casual: "model.json" },
  });
  const manifest = {
    model: "data/model.moc",
    textures: ["data/t1.png"],
    motions: {
      hit: [{ file: "../_mtn_emp/other/hit.mtn" }],
      gone: [{ file: "../_mtn_emp/sakiko/gone.mtn" }],
    },
  };
  write(fixture.charactersDir, "taki/casual/model.json", JSON.stringify(manifest));
  write(fixture.charactersDir, "other/live/motions/hit.mtn");
}

describe("characterCostumeResolutionMethod", () => {
  it("is operator-only and named character.costumeResolution", () => {
    const def = characterCostumeResolutionMethod(fresh());
    expect(def.method).toBe(CHARACTER_METHODS.costumeResolution);
    expect(def.roles).toEqual(["operator"]);
  });

  it("returns the costume's external-ref resolution map (resolved + null entries)", () => {
    const fixture = fresh();
    seed(fixture);
    expect(characterCostumeResolutionMethod(fixture).handler({ characterId: "taki", costume: "casual" }, undefined as never)).toEqual({
      resolution: {
        "../_mtn_emp/other/hit.mtn": "other/live/motions/hit.mtn",
        "../_mtn_emp/sakiko/gone.mtn": null,
      },
    });
  });

  it("throws for an unknown character and an unknown costume (degrades via the registry)", () => {
    const fixture = fresh();
    seed(fixture);
    const def = characterCostumeResolutionMethod(fixture);
    expect(() => def.handler({ characterId: "ghost", costume: "casual" }, undefined as never)).toThrow(/character not found/);
    expect(() => def.handler({ characterId: "taki", costume: "../escape" }, undefined as never)).toThrow(/costume not found/);
  });
});
