/**
 * INPUT:  a temp directory laid out like ~/.takiagent/workspace/characters + a fake env record.
 * OUTPUT: assertions on the env override, the manifest listing, MIME mapping, and the traversal/missing-file refusals.
 * POS:    unit test for the lab's dev-server middleware pieces. No server, no Vite. Exempt from caps.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listCharacters, mimeForPath, resolveCharactersRoot, resolveFile } from "./lab-characters.ts";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "taki-lab-characters-"));
  mkdirSync(join(root, "taki", "arbeit"), { recursive: true });
  writeFileSync(join(root, "taki", "character.json"), JSON.stringify({ characterId: "taki", costumes: ["arbeit"] }));
  writeFileSync(join(root, "taki", "arbeit", "model.json"), "{}");
  mkdirSync(join(root, "anon"), { recursive: true });
  writeFileSync(join(root, "anon", "character.json"), JSON.stringify({ characterId: "anon", costumes: [] }));
  // A directory with no manifest and a loose file at the root: neither is a character.
  mkdirSync(join(root, "not-a-character"), { recursive: true });
  writeFileSync(join(root, "stray.txt"), "x");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveCharactersRoot", () => {
  it("prefers the explicit env override", () => {
    expect(resolveCharactersRoot({ TAKI_LAB_CHARACTERS_ROOT: join(sep, "models", "characters") })).toBe(
      join(sep, "models", "characters"),
    );
  });

  it("falls back to the workspace characters directory under the home dir", () => {
    expect(resolveCharactersRoot({})).toBe(join(homedir(), ".takiagent", "workspace", "characters"));
  });
});

describe("listCharacters", () => {
  it("lists only name-sorted subdirectories holding a parsed character.json", () => {
    const listing = listCharacters(root);
    expect(listing.root).toBe(root);
    expect(listing.characters.map((entry) => entry.id)).toEqual(["anon", "taki"]);
    expect(listing.characters[1]?.character).toEqual({ characterId: "taki", costumes: ["arbeit"] });
  });

  it("returns an empty listing when the root does not exist", () => {
    expect(listCharacters(join(root, "absent")).characters).toEqual([]);
  });
});

describe("resolveFile", () => {
  it("resolves a costume file inside the root", () => {
    expect(resolveFile(root, "taki/arbeit/model.json")).toBe(join(root, "taki", "arbeit", "model.json"));
  });

  it("refuses a traversal that escapes the root", () => {
    expect(resolveFile(root, "../../x")).toBeNull();
    expect(resolveFile(root, "taki/../../outside.json")).toBeNull();
  });

  it("refuses a missing file and a directory", () => {
    expect(resolveFile(root, "taki/absent.json")).toBeNull();
    expect(resolveFile(root, "taki")).toBeNull();
  });
});

describe("mimeForPath", () => {
  it("maps the served extensions and defaults everything else to a byte stream", () => {
    expect(mimeForPath("a/model.json")).toBe("application/json");
    expect(mimeForPath("a/tex.PNG")).toBe("image/png");
    expect(mimeForPath("a/clip.wav")).toBe("audio/wav");
    expect(mimeForPath("a/clip.mp3")).toBe("audio/mpeg");
    expect(mimeForPath("a/model.moc3")).toBe("application/octet-stream");
  });
});
