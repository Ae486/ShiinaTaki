/**
 * INPUT:  a characterId + costume + validated {path, bytes} file list (from the importer), or a characterId to read
 * OUTPUT: createCharacterStore({charactersDir}) -> { exists, writeCostume, writeMarker, readMarker, list, remove }
 * POS:    core/characters — the Workspace characters/ R/W site (#18, inv. 2: Core is the single Workspace writer). Every
 *         write path is re-confined under the character dir (defense-in-depth over member-path); OS-neutral (path.join).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative as pathRelative, resolve } from "node:path";
import type { CharacterSource } from "@taki/shared";
import { CharacterImportError } from "./import-error.ts";

const MARKER_FILE = "character.json";

export interface CharacterMarker {
  characterId: string;
  source: CharacterSource;
  importedAt: string; // ISO-8601 (injected clock — kept deterministic in tests)
  costumes: string[];
  defaultCostume: string;
  settingsFilesByCostume: Record<string, string>;
}

export interface CostumeFile {
  path: string; // POSIX-relative within the costume dir (already normalized by member-path)
  bytes: Buffer;
}

export interface CharacterStore {
  exists(characterId: string): boolean;
  writeCostume(characterId: string, costume: string, files: CostumeFile[]): void;
  writeMarker(marker: CharacterMarker): void;
  readMarker(characterId: string): CharacterMarker | undefined;
  list(): CharacterMarker[];
  remove(characterId: string): void;
}

export function createCharacterStore(deps: { charactersDir: string }): CharacterStore {
  mkdirSync(deps.charactersDir, { recursive: true });
  const root = realpathSync(deps.charactersDir); // canonicalize once so confinement compares like-for-like
  return {
    exists: (id) => existsSync(confine(root, id)),
    writeCostume: (id, costume, files) => writeCostume(confine(root, id), costume, files),
    writeMarker: (marker) => writeMarker(confine(root, marker.characterId), marker),
    readMarker: (id) => readMarker(confine(root, id)),
    list: () => listMarkers(root),
    remove: (id) => rmSync(confine(root, id), { recursive: true, force: true }),
  };
}

function writeCostume(charRoot: string, costume: string, files: CostumeFile[]): void {
  for (const file of files) {
    const dest = confine(charRoot, join(costume, ...file.path.split("/")));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.bytes);
  }
}

function writeMarker(charRoot: string, marker: CharacterMarker): void {
  mkdirSync(charRoot, { recursive: true });
  writeFileSync(join(charRoot, MARKER_FILE), JSON.stringify(marker, null, 2));
}

function readMarker(charRoot: string): CharacterMarker | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(charRoot, MARKER_FILE), "utf8");
  } catch {
    return undefined; // no marker (not an imported character, or removed)
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isMarker(parsed) ? parsed : undefined; // a hand-corrupted marker degrades to "not listed", never a crash
  } catch {
    return undefined;
  }
}

function listMarkers(root: string): CharacterMarker[] {
  let dirents;
  try {
    dirents = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // characters/ not created yet (nothing imported)
  }
  const markers: CharacterMarker[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const marker = readMarker(join(root, dirent.name));
    if (marker) markers.push(marker);
  }
  return markers;
}

// Resolve `relPath` under `base` and re-assert it stays inside — a second, independent traversal layer over member-path.
function confine(base: string, relPath: string): string {
  const target = resolve(base, relPath);
  const rel = pathRelative(base, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new CharacterImportError("unsafe_resource_path", `path escapes the character dir: ${relPath}`);
  }
  return target;
}

function isMarker(value: unknown): value is CharacterMarker {
  const marker = value as Record<string, unknown> | null;
  return (
    typeof marker === "object" &&
    marker !== null &&
    typeof marker.characterId === "string" &&
    typeof marker.defaultCostume === "string" &&
    Array.isArray(marker.costumes) &&
    typeof marker.settingsFilesByCostume === "object" &&
    marker.settingsFilesByCostume !== null
  );
}
