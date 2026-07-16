import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildBasenameIndex,
  characterAvailability,
  costumeAvailability,
  costumeExternalRefs,
  costumeResolutionMap,
  resolveExternals,
} from "./costume-availability.ts";

const roots: string[] = [];
function freshCharactersDir(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-availability-"));
  roots.push(root);
  return join(root, "characters");
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(charactersDir: string, relPath: string, content = ""): void {
  const abs = join(charactersDir, ...relPath.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// A C2 manifest exercising all four external cases: (a) local-only, (b) owner-hint hit in another character,
// (c) basename fallback under a mismatched owner (the tomori/tomorin case), (d) unresolvable → null + owner.
const CASUAL = {
  version: "Sample 1.0.0",
  model: "data/model.moc",
  textures: ["data/t1.png"],
  motions: {
    local01: [{ file: "motions/local01.mtn" }],
    owner01: [{ file: "../_mtn_emp/other/owner01.mtn" }],
    fall01: [{ file: "../_mtn_emp/tomori/fall01.mtn" }],
    gone01: [{ file: "../_mtn_emp/sakiko/gone01.mtn" }],
  },
  expressions: [{ name: "smile", file: "../_mtn_emp/other/exp_smile.json" }],
};

function seedFixture(charactersDir: string): void {
  write(charactersDir, "taki/character.json", JSON.stringify({ characterId: "taki" }));
  write(charactersDir, "taki/casual/model.json", JSON.stringify(CASUAL));
  write(charactersDir, "taki/casual/data/model.moc");
  write(charactersDir, "taki/casual/data/t1.png");
  write(charactersDir, "taki/casual/motions/local01.mtn");
  write(charactersDir, "other/live/motions/owner01.mtn");
  write(charactersDir, "other/live/exp/exp_smile.json");
  write(charactersDir, "tomorin/pool/fall01.mtn"); // owner hint says "tomori" — only the basename matches
}

describe("buildBasenameIndex", () => {
  it("maps basenames to sorted characters-root rel paths, skipping character.json markers", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    const index = buildBasenameIndex(dir);
    expect(index.get("owner01.mtn")).toEqual(["other/live/motions/owner01.mtn"]);
    expect(index.get("fall01.mtn")).toEqual(["tomorin/pool/fall01.mtn"]);
    expect(index.has("character.json")).toBe(false);
  });

  it("returns an empty index when the characters dir does not exist", () => {
    expect(buildBasenameIndex(join(freshCharactersDir(), "nope")).size).toBe(0);
  });
});

describe("costumeExternalRefs", () => {
  it("returns only refs containing `..` and dedupes them", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    expect(costumeExternalRefs(join(dir, "taki", "casual"), "model.json")).toEqual([
      "../_mtn_emp/other/owner01.mtn",
      "../_mtn_emp/tomori/fall01.mtn",
      "../_mtn_emp/sakiko/gone01.mtn",
      "../_mtn_emp/other/exp_smile.json",
    ]);
  });

  it("returns [] for an unreadable or unsafe settings file", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    expect(costumeExternalRefs(join(dir, "taki", "casual"), "absent.json")).toEqual([]);
    expect(costumeExternalRefs(join(dir, "taki", "casual"), "../casual/model.json")).toEqual([]);
  });
});

describe("resolveExternals ordering", () => {
  it("prefers the owner-hint character over the costume's own character, and own over any", () => {
    const index = new Map([
      ["dup.mtn", ["other/live/dup.mtn", "taki/arbeit/dup.mtn"]],
      ["own.mtn", ["aaa/pool/own.mtn", "taki/arbeit/own.mtn"]],
    ]);
    const { resolution } = resolveExternals({
      refs: ["../_mtn_emp/other/dup.mtn", "../_mtn_emp/nobody/own.mtn"],
      index,
      characterId: "taki",
    });
    expect(resolution["../_mtn_emp/other/dup.mtn"]).toBe("other/live/dup.mtn"); // owner hit beats own-character hit
    expect(resolution["../_mtn_emp/nobody/own.mtn"]).toBe("taki/arbeit/own.mtn"); // own beats first-sorted "aaa"
  });

  it("collects unique missing counts + sorted owner hints for null-resolved refs", () => {
    const { resolution, missingCount, missingOwners } = resolveExternals({
      refs: ["../_mtn_emp/zeta/a.mtn", "../_mtn_emp/alpha/b.mtn", "../_mtn_emp/zeta/a.mtn", "../no_pool/c.mtn"],
      index: new Map(),
      characterId: "taki",
    });
    expect(resolution).toEqual({
      "../_mtn_emp/zeta/a.mtn": null,
      "../_mtn_emp/alpha/b.mtn": null,
      "../no_pool/c.mtn": null,
    });
    expect(missingCount).toBe(3); // the repeated ref counts once
    expect(missingOwners).toEqual(["alpha", "zeta"]); // the hint-less ref contributes no owner
  });
});

describe("costumeAvailability", () => {
  it("resolves owner-hit, basename-fallback, and unresolvable externals on the fs fixture", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    const index = buildBasenameIndex(dir);
    const availability = costumeAvailability({
      costumeDir: join(dir, "taki", "casual"),
      settingsFile: "model.json",
      characterId: "taki",
      index,
    });
    expect(availability).toEqual({ renderable: true, missingMotions: 1, missingPacks: ["sakiko"] });
  });

  it("reports a local-refs-only costume as renderable with nothing missing", () => {
    const dir = freshCharactersDir();
    const manifest = { model: "m.moc", textures: ["t.png"], motions: { idle: [{ file: "idle.mtn" }] } };
    write(dir, "solo/plain/model.json", JSON.stringify(manifest));
    write(dir, "solo/plain/m.moc");
    write(dir, "solo/plain/t.png");
    const availability = costumeAvailability({
      costumeDir: join(dir, "solo", "plain"),
      settingsFile: "model.json",
      characterId: "solo",
      index: buildBasenameIndex(dir),
    });
    expect(availability).toEqual({ renderable: true, missingMotions: 0, missingPacks: [] });
  });

  it("marks a costume unrenderable when an essential texture is absent or the settings do not parse", () => {
    const dir = freshCharactersDir();
    write(dir, "solo/broken/model.json", JSON.stringify({ model: "m.moc", textures: ["gone.png"] }));
    write(dir, "solo/broken/m.moc");
    write(dir, "solo/garbled/model.json", "not json");
    const index = buildBasenameIndex(dir);
    const base = { settingsFile: "model.json", characterId: "solo", index };
    expect(costumeAvailability({ ...base, costumeDir: join(dir, "solo", "broken") }).renderable).toBe(false);
    expect(costumeAvailability({ ...base, costumeDir: join(dir, "solo", "garbled") })).toEqual({
      renderable: false,
      missingMotions: 0,
      missingPacks: [],
    });
  });
});

describe("characterAvailability + costumeResolutionMap (the handler aggregates)", () => {
  it("computes availability per costume from the marker's settings map", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    const availability = characterAvailability({
      charactersDir: dir,
      characterId: "taki",
      settingsFilesByCostume: { casual: "model.json", ghost: "model.json" },
    });
    expect(availability.casual).toEqual({ renderable: true, missingMotions: 1, missingPacks: ["sakiko"] });
    expect(availability.ghost).toEqual({ renderable: false, missingMotions: 0, missingPacks: [] });
  });

  it("degrades an unsafe marker costume name to unrenderable instead of joining it", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    const availability = characterAvailability({
      charactersDir: dir,
      characterId: "taki",
      settingsFilesByCostume: { "../../escape": "model.json" },
    });
    expect(availability["../../escape"]).toEqual({ renderable: false, missingMotions: 0, missingPacks: [] });
  });

  it("returns the full resolution map for one costume, and {} for a self-contained one", () => {
    const dir = freshCharactersDir();
    seedFixture(dir);
    const resolution = costumeResolutionMap({
      charactersDir: dir,
      characterId: "taki",
      costume: "casual",
      settingsFile: "model.json",
    });
    expect(resolution).toEqual({
      "../_mtn_emp/other/owner01.mtn": "other/live/motions/owner01.mtn",
      "../_mtn_emp/tomori/fall01.mtn": "tomorin/pool/fall01.mtn",
      "../_mtn_emp/sakiko/gone01.mtn": null,
      "../_mtn_emp/other/exp_smile.json": "other/live/exp/exp_smile.json",
    });
    write(dir, "solo/plain/model.json", JSON.stringify({ model: "m.moc", textures: ["t.png"] }));
    expect(
      costumeResolutionMap({ charactersDir: dir, characterId: "solo", costume: "plain", settingsFile: "model.json" }),
    ).toEqual({});
  });
});
