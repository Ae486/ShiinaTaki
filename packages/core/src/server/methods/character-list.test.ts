import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHARACTER_METHODS } from "@taki/shared";
import { createCharacterStore, type CharacterStore } from "../../characters/character-store.ts";
import { characterListMethod } from "./character-list.ts";

const roots: string[] = [];
function freshStore(): CharacterStore {
  const root = mkdtempSync(join(tmpdir(), "taki-m-list-"));
  roots.push(root);
  return createCharacterStore({ charactersDir: join(root, "characters") });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("characterListMethod (T7)", () => {
  it("is operator-only and named character.list", () => {
    const def = characterListMethod(freshStore());
    expect(def.method).toBe(CHARACTER_METHODS.list);
    expect(def.roles).toEqual(["operator"]);
  });

  it("returns a summary per imported character (empty before any import)", () => {
    const store = freshStore();
    expect(characterListMethod(store).handler({}, undefined as never)).toEqual({ characters: [] });

    store.writeMarker({
      characterId: "taki",
      source: "zst",
      importedAt: "2026-07-15T00:00:00.000Z",
      costumes: ["casual", "live_01"],
      defaultCostume: "casual",
      settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
    });
    expect(characterListMethod(store).handler({}, undefined as never)).toEqual({
      characters: [
        {
          characterId: "taki",
          costumes: ["casual", "live_01"],
          defaultCostume: "casual",
          settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
          source: "zst",
        },
      ],
    });
  });
});
