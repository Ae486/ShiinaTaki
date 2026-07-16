import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHARACTER_METHODS } from "@taki/shared";
import { createCharacterStore, type CharacterStore } from "../../characters/character-store.ts";
import { characterCostumesMethod } from "./character-costumes.ts";

interface Fixture {
  store: CharacterStore;
  charactersDir: string;
}

const roots: string[] = [];
function fresh(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "taki-m-costumes-"));
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
    costumes: ["casual", "live_01"],
    defaultCostume: "casual",
    settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
  });
  // casual is complete on disk; live_01's settings are absent → availability must split them.
  write(fixture.charactersDir, "taki/casual/model.json", JSON.stringify({ model: "m.moc", textures: ["t.png"] }));
  write(fixture.charactersDir, "taki/casual/m.moc");
  write(fixture.charactersDir, "taki/casual/t.png");
}

describe("characterCostumesMethod (T7)", () => {
  it("is operator-only and named character.costumes", () => {
    const def = characterCostumesMethod(fresh());
    expect(def.method).toBe(CHARACTER_METHODS.costumes);
    expect(def.roles).toEqual(["operator"]);
  });

  it("returns a character's costumes + settings filenames + on-demand availability", () => {
    const fixture = fresh();
    seed(fixture);
    expect(characterCostumesMethod(fixture).handler({ characterId: "taki" }, undefined as never)).toEqual({
      costumes: ["casual", "live_01"],
      defaultCostume: "casual",
      settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
      availability: {
        casual: { renderable: true, missingMotions: 0, missingPacks: [] },
        live_01: { renderable: false, missingMotions: 0, missingPacks: [] },
      },
    });
  });

  it("throws for an unknown character (absence degrades via the registry)", () => {
    const def = characterCostumesMethod(fresh());
    expect(() => def.handler({ characterId: "ghost" }, undefined as never)).toThrow(/character not found/);
  });
});
