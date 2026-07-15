import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterImportError } from "./import-error.ts";
import { createCharacterStore, type CharacterMarker } from "./character-store.ts";

const roots: string[] = [];
function freshStore() {
  const root = mkdtempSync(join(tmpdir(), "taki-char-store-"));
  roots.push(root);
  return { store: createCharacterStore({ charactersDir: join(root, "characters") }), root: join(root, "characters") };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const marker = (id: string): CharacterMarker => ({
  characterId: id,
  source: "zst",
  importedAt: "2026-07-15T00:00:00.000Z",
  costumes: ["casual", "live_01"],
  defaultCostume: "casual",
  settingsFilesByCostume: { casual: "model.json", live_01: "taki.model3.json" },
});

describe("createCharacterStore (T5)", () => {
  it("writes costume files under characters/<id>/<costume>/ and round-trips the marker", () => {
    const { store, root } = freshStore();
    expect(store.exists("taki")).toBe(false);
    store.writeCostume("taki", "casual", [
      { path: "model.json", bytes: Buffer.from("{}") },
      { path: "data/model.moc", bytes: Buffer.from("MOC") },
    ]);
    store.writeMarker(marker("taki"));

    expect(store.exists("taki")).toBe(true);
    expect(existsSync(join(root, "taki", "casual", "data", "model.moc"))).toBe(true);
    expect(readFileSync(join(root, "taki", "casual", "data", "model.moc"), "utf8")).toBe("MOC");
    expect(store.readMarker("taki")).toEqual(marker("taki"));
    expect(store.readMarker("taki")?.costumes).toEqual(["casual", "live_01"]);
  });

  it("list() returns a marker per imported character and skips markerless / stray dirs", () => {
    const { store } = freshStore();
    store.writeMarker(marker("taki"));
    store.writeMarker(marker("asuka"));
    store.writeCostume("no-marker", "casual", [{ path: "x.moc", bytes: Buffer.from("x") }]); // dir without a marker
    expect(store.list().map((m) => m.characterId).sort()).toEqual(["asuka", "taki"]);
  });

  it("remove() deletes the whole character dir", () => {
    const { store } = freshStore();
    store.writeMarker(marker("taki"));
    expect(store.exists("taki")).toBe(true);
    store.remove("taki");
    expect(store.exists("taki")).toBe(false);
    expect(store.readMarker("taki")).toBeUndefined();
  });

  it("confines writes: a file path escaping the character dir is a structured reject (second traversal layer)", () => {
    const { store } = freshStore();
    try {
      store.writeCostume("taki", "casual", [{ path: "../../../../evil.txt", bytes: Buffer.from("pwned") }]);
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterImportError);
      expect((error as CharacterImportError).code).toBe("unsafe_resource_path");
    }
  });

  it("returns undefined for an unknown character and an empty list before any import", () => {
    const { store } = freshStore();
    expect(store.readMarker("ghost")).toBeUndefined();
    expect(store.list()).toEqual([]);
  });
});
