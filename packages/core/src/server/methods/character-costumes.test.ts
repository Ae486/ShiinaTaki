import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHARACTER_METHODS } from "@taki/shared";
import { createCharacterStore, type CharacterStore } from "../../characters/character-store.ts";
import { characterCostumesMethod } from "./character-costumes.ts";

const roots: string[] = [];
function freshStore(): CharacterStore {
  const root = mkdtempSync(join(tmpdir(), "taki-m-costumes-"));
  roots.push(root);
  return createCharacterStore({ charactersDir: join(root, "characters") });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed(store: CharacterStore): void {
  store.writeMarker({
    characterId: "taki",
    source: "zst",
    importedAt: "2026-07-15T00:00:00.000Z",
    costumes: ["casual", "live_01"],
    defaultCostume: "casual",
    settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
  });
}

describe("characterCostumesMethod (T7)", () => {
  it("is operator-only and named character.costumes", () => {
    const def = characterCostumesMethod(freshStore());
    expect(def.method).toBe(CHARACTER_METHODS.costumes);
    expect(def.roles).toEqual(["operator"]);
  });

  it("returns a character's costumes + settings filenames", () => {
    const store = freshStore();
    seed(store);
    expect(characterCostumesMethod(store).handler({ characterId: "taki" }, undefined as never)).toEqual({
      costumes: ["casual", "live_01"],
      defaultCostume: "casual",
      settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
    });
  });

  it("throws for an unknown character (absence degrades via the registry)", () => {
    const def = characterCostumesMethod(freshStore());
    expect(() => def.handler({ characterId: "ghost" }, undefined as never)).toThrow(/character not found/);
  });
});
