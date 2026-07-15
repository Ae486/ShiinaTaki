import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import tarStream from "tar-stream";
import { CharacterImportError } from "./import-error.ts";
import { createCharacterStore, type CharacterStore } from "./character-store.ts";
import { createCharacterImporter } from "./character-import.ts";

const roots: string[] = [];
function freshStore(): { store: CharacterStore; charactersDir: string } {
  const root = mkdtempSync(join(tmpdir(), "taki-char-import-"));
  roots.push(root);
  const charactersDir = join(root, "characters");
  return { store: createCharacterStore({ charactersDir }), charactersDir };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const FIXED_NOW = () => new Date("2026-07-15T00:00:00.000Z");
const importerFor = (store: CharacterStore) => createCharacterImporter({ store, now: FIXED_NOW });

const C2_MANIFEST = JSON.stringify({ model: "data/model.moc", textures: ["data/t.png"] });
const C3_MANIFEST = JSON.stringify({ Version: 3, FileReferences: { Moc: "live.moc3", Textures: ["textures/t.png"] } });

function zipBytes(entries: Record<string, string | Uint8Array>): string {
  const record: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(entries)) record[path] = typeof body === "string" ? strToU8(body) : body;
  return Buffer.from(zipSync(record)).toString("base64");
}

async function zstBytes(entries: { name: string; body?: string }[]): Promise<string> {
  const pack = tarStream.pack();
  const index = { files: entries.map((e) => e.name) };
  pack.entry({ name: ".bandori_zst_index.json" }, JSON.stringify(index));
  for (const entry of entries) pack.entry({ name: entry.name }, entry.body ?? "");
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(chunk as Buffer);
  return zstdCompressSync(Buffer.concat(chunks)).toString("base64");
}

describe("createCharacterImporter — zip / folder-archive (T4)", () => {
  it("imports a single-costume folder-as-zip into characters/<id>/<costume>/ with a marker", async () => {
    const { store, charactersDir } = freshStore();
    const archiveBase64 = zipBytes({
      "casual/model.json": C2_MANIFEST,
      "casual/data/model.moc": "MOC",
      "casual/data/t.png": "PNG",
    });
    const result = await importerFor(store).import({ sourceKind: "folder-archive", archiveBase64, fileName: "Taki.zip" });

    expect(result.characterId).toBe("taki"); // slugged from the filename stem
    expect(result.costumes).toEqual(["casual"]);
    expect(result.defaultCostume).toBe("casual");
    expect(result.settingsFilesByCostume).toEqual({ casual: "model.json" });
    expect(existsSync(join(charactersDir, "taki", "casual", "data", "model.moc"))).toBe(true);
    expect(readFileSync(join(charactersDir, "taki", "casual", "data", "model.moc"), "utf8")).toBe("MOC");

    const marker = JSON.parse(readFileSync(join(charactersDir, "taki", "character.json"), "utf8"));
    expect(marker).toMatchObject({ characterId: "taki", source: "folder-archive", importedAt: "2026-07-15T00:00:00.000Z", defaultCostume: "casual" });
  });

  it("rejects a Zip-Slip member and writes no character dir", async () => {
    const { store, charactersDir } = freshStore();
    const archiveBase64 = zipBytes({ "casual/model.json": C2_MANIFEST, "../evil.txt": "pwned" });
    await expect(importerFor(store).import({ sourceKind: "zip", archiveBase64, fileName: "taki.zip" })).rejects.toMatchObject({
      code: "unsafe_resource_path",
    });
    expect(existsSync(join(charactersDir, "taki"))).toBe(false);
  });

  it("hard-fails on a missing texture and leaves NO partial dir (T4)", async () => {
    const { store, charactersDir } = freshStore();
    const archiveBase64 = zipBytes({ "casual/model.json": C2_MANIFEST, "casual/data/model.moc": "MOC" }); // t.png absent
    await expect(importerFor(store).import({ sourceKind: "zip", archiveBase64, fileName: "taki.zip" })).rejects.toMatchObject({
      code: "missing_textures",
    });
    expect(store.exists("taki")).toBe(false);
    expect(existsSync(join(charactersDir, "taki"))).toBe(false);
  });

  it("rejects an archive with no manifest (no_model_json) and an empty-slug name (invalid_name)", async () => {
    const { store } = freshStore();
    await expect(
      importerFor(store).import({ sourceKind: "zip", archiveBase64: zipBytes({ "readme.txt": "hi" }), fileName: "x.zip" }),
    ).rejects.toMatchObject({ code: "no_model_json" });
    await expect(
      importerFor(store).import({ sourceKind: "zip", archiveBase64: zipBytes({ "casual/model.json": C2_MANIFEST }), fileName: ".zip" }),
    ).rejects.toMatchObject({ code: "invalid_name" });
  });

  it("refuses to clobber an already-imported character (name_exists)", async () => {
    const { store } = freshStore();
    const archiveBase64 = zipBytes({ "casual/model.json": C2_MANIFEST, "casual/data/model.moc": "MOC", "casual/data/t.png": "PNG" });
    await importerFor(store).import({ sourceKind: "zip", archiveBase64, fileName: "taki.zip" });
    await expect(importerFor(store).import({ sourceKind: "zip", archiveBase64, fileName: "taki.zip" })).rejects.toMatchObject({
      code: "name_exists",
    });
  });
});

describe("createCharacterImporter — zst multi-costume (T4)", () => {
  it("extracts every costume of a .zst (C2 + C3) and picks the preferred default", async () => {
    const { store, charactersDir } = freshStore();
    const archiveBase64 = await zstBytes([
      { name: "character.png", body: "THUMB" },
      { name: "casual/model.json", body: C2_MANIFEST },
      { name: "casual/data/model.moc", body: "MOC2" },
      { name: "casual/data/t.png", body: "PNG" },
      { name: "live_01/taki.model3.json", body: C3_MANIFEST },
      { name: "live_01/live.moc3", body: "MOC3" },
      { name: "live_01/textures/t.png", body: "PNG" },
    ]);
    const result = await importerFor(store).import({ sourceKind: "zst", archiveBase64, fileName: "taki.zst" });

    expect(result.costumes).toEqual(["casual", "live_01"]);
    expect(result.defaultCostume).toBe("casual"); // preference order picks casual over live_01
    expect(result.settingsFilesByCostume).toEqual({ casual: "model.json", live_01: "taki.model3.json" });
    expect(existsSync(join(charactersDir, "taki", "casual", "data", "model.moc"))).toBe(true);
    expect(existsSync(join(charactersDir, "taki", "live_01", "live.moc3"))).toBe(true);
    // The archive-root thumbnail/index are NOT part of any costume subtree.
    expect(existsSync(join(charactersDir, "taki", "character.png"))).toBe(false);
  });

  it("surfaces optional-resource misses as warnings without failing the import", async () => {
    const { store } = freshStore();
    const manifestWithMotions = JSON.stringify({ model: "data/model.moc", textures: ["data/t.png"], motions: { idle: [{ file: "../_mtn_emp/idle.mtn" }] } });
    const archiveBase64 = await zstBytes([
      { name: "casual/model.json", body: manifestWithMotions },
      { name: "casual/data/model.moc", body: "MOC" },
      { name: "casual/data/t.png", body: "PNG" },
    ]);
    const result = await importerFor(store).import({ sourceKind: "zst", archiveBase64, fileName: "taki.zst" });
    expect(result.warnings.some((w) => w.includes("casual") && w.includes("motion"))).toBe(true);
  });

  it("rejects a non-archive payload as bad_zst", async () => {
    const { store } = freshStore();
    const archiveBase64 = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    await expect(importerFor(store).import({ sourceKind: "zst", archiveBase64, fileName: "x.zst" })).rejects.toBeInstanceOf(
      CharacterImportError,
    );
  });
});
