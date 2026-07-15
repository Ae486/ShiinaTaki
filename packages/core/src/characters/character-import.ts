/**
 * INPUT:  CharacterImportParams (sourceKind + base64 archive + fileName + optional characterId) via the WS method
 * OUTPUT: createCharacterImporter({store, now?}) -> { import } producing a CharacterImportResult; throws CharacterImportError
 * POS:    core/characters — the import orchestrator (#18): decode → archive-parse → manifest discovery → costume
 *         resolution → validate-ALL-before-write → extract → marker. Rolls back a partial write. OS-neutral, no OS access.
 */
import { CharacterIdSchema, type CharacterImportParams, type CharacterImportResult, type CharacterSource } from "@taki/shared";
import { validateManifest } from "./cubism-manifest.ts";
import { CharacterImportError } from "./import-error.ts";
import { readZip } from "./zip-archive.ts";
import { readZstArchive } from "./zst-archive.ts";
import type { CharacterStore, CostumeFile } from "./character-store.ts";

const SIDECARS = new Set([".bandori_zst_index.json", "character.json", "outfit.json", "band.json"]);
// Default-costume preference (reference heuristic): the first present of these, else the first sorted costume id.
const DEFAULT_PREFERENCE = ["live_default", "casual", "school_winter", "school_summer"];

export interface CharacterImporter {
  import(params: CharacterImportParams): Promise<CharacterImportResult>;
}

interface Costume {
  id: string;
  manifestPath: string;
}
interface PreparedCostume {
  id: string;
  settingsFile: string;
  files: CostumeFile[];
  warnings: string[];
}

export function createCharacterImporter(deps: { store: CharacterStore; now?: () => Date }): CharacterImporter {
  const now = deps.now ?? (() => new Date());
  return {
    async import(params) {
      const characterId = resolveCharacterId(params);
      if (deps.store.exists(characterId)) {
        throw new CharacterImportError("name_exists", `a character named "${characterId}" is already imported`);
      }
      const { files, enumeration } = await readArchive(params.sourceKind, Buffer.from(params.archiveBase64, "base64"));
      const manifests = findManifests(enumeration, files);
      if (manifests.length === 0) throw new CharacterImportError("no_model_json", "no Cubism manifest found in the archive");
      // Validate EVERY costume before writing ANY — a hard failure then leaves no partial character dir (T4).
      const prepared = resolveCostumes(manifests).map((costume) => buildCostume(files, costume));
      return writeImport(deps.store, { characterId, source: params.sourceKind, prepared, importedAt: now().toISOString() });
    },
  };
}

function resolveCharacterId(params: CharacterImportParams): string {
  const id = params.characterId ?? slugFromFileName(params.fileName);
  if (!CharacterIdSchema.safeParse(id).success) throw new CharacterImportError("invalid_name", `not a valid character id: "${id}"`);
  return id;
}

function slugFromFileName(fileName: string): string {
  return fileName
    .replace(/\.(zst|zip)$/i, "") // drop the archive extension; the stem seeds the id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") // fold every non-slug run to a single dash
    .replace(/^[^a-z0-9]+/, "") // a slug must start with an alphanumeric
    .slice(0, 64);
}

async function readArchive(
  sourceKind: CharacterSource,
  bytes: Buffer,
): Promise<{ files: Map<string, Buffer>; enumeration: string[] }> {
  if (sourceKind === "zst") {
    const { files, index } = await readZstArchive(bytes);
    return { files, enumeration: index ?? [...files.keys()] }; // prefer the index member; never trust raw tar names
  }
  const files = readZip(bytes); // "zip" and "folder-archive" (a folder delivered as a zip) share the reader
  return { files, enumeration: [...files.keys()] };
}

function findManifests(enumeration: string[], files: Map<string, Buffer>): string[] {
  return enumeration.filter((path) => isManifestName(path) && files.has(path));
}

function isManifestName(path: string): boolean {
  const base = posixBasename(path).toLowerCase();
  return base === "model.json" || base.endsWith(".model.json") || base.endsWith(".model3.json");
}

function resolveCostumes(manifests: string[]): Costume[] {
  const byDir = groupByDir(manifests);
  const used = new Set<string>();
  const costumes: Costume[] = [];
  for (const dir of [...byDir.keys()].sort()) {
    const base = dir === "" ? "default" : posixBasename(dir);
    costumes.push({ id: uniqueId(base, used), manifestPath: preferredManifest(byDir.get(dir) ?? []) });
  }
  return costumes;
}

function groupByDir(manifests: string[]): Map<string, string[]> {
  const byDir = new Map<string, string[]>();
  for (const manifestPath of manifests) {
    const dir = posixDirname(manifestPath);
    const group = byDir.get(dir);
    if (group) group.push(manifestPath);
    else byDir.set(dir, [manifestPath]);
  }
  return byDir;
}

// One manifest per costume dir: prefer an exact `model.json`, else the first sorted (the reference's rule).
function preferredManifest(paths: string[]): string {
  const modelJson = paths.find((path) => posixBasename(path).toLowerCase() === "model.json");
  if (modelJson) return modelJson;
  const first = [...paths].sort()[0];
  if (first === undefined) throw new CharacterImportError("no_model_json", "empty costume manifest group");
  return first;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`; // dedup same-named folders (arbeit, arbeit_2, …)
  used.add(id);
  return id;
}

function buildCostume(files: Map<string, Buffer>, costume: Costume): PreparedCostume {
  const dir = posixDirname(costume.manifestPath);
  const costumeFiles = collectCostumeFiles(files, dir);
  const manifest = parseManifest(files.get(costume.manifestPath));
  const present = new Set(costumeFiles.map((file) => file.path));
  const warnings = validateManifest(manifest, (relPath) => present.has(relPath)); // throws missing_moc/missing_textures
  return {
    id: costume.id,
    settingsFile: posixBasename(costume.manifestPath),
    files: costumeFiles,
    warnings: warnings.map((warning) => `costume '${costume.id}': ${warning}`),
  };
}

// A costume's files, keyed by their path RELATIVE to the manifest dir (so the manifest's own relative refs resolve).
function collectCostumeFiles(files: Map<string, Buffer>, dir: string): CostumeFile[] {
  const out: CostumeFile[] = [];
  for (const [path, bytes] of files) {
    if (SIDECARS.has(posixBasename(path))) continue;
    if (dir === "") out.push({ path, bytes });
    else if (path.startsWith(`${dir}/`)) out.push({ path: path.slice(dir.length + 1), bytes });
  }
  return out;
}

function parseManifest(bytes: Buffer | undefined): unknown {
  if (!bytes) throw new CharacterImportError("bad_model_json", "the manifest member has no bytes");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CharacterImportError("bad_model_json", "the manifest is not valid JSON");
  }
}

function writeImport(
  store: CharacterStore,
  spec: { characterId: string; source: CharacterSource; prepared: PreparedCostume[]; importedAt: string },
): CharacterImportResult {
  const { characterId, source, prepared, importedAt } = spec;
  const settingsFilesByCostume: Record<string, string> = {};
  const warnings: string[] = [];
  try {
    for (const costume of prepared) {
      store.writeCostume(characterId, costume.id, costume.files);
      settingsFilesByCostume[costume.id] = costume.settingsFile;
      warnings.push(...costume.warnings);
    }
    const costumes = prepared.map((costume) => costume.id);
    const defaultCostume = pickDefault(costumes);
    store.writeMarker({ characterId, source, importedAt, costumes, defaultCostume, settingsFilesByCostume });
    return { characterId, costumes, defaultCostume, settingsFilesByCostume, warnings };
  } catch (error) {
    store.remove(characterId); // roll back a partially written character on any write failure
    throw error;
  }
}

function pickDefault(ids: string[]): string {
  const preferred = DEFAULT_PREFERENCE.find((pref) => ids.includes(pref));
  if (preferred) return preferred;
  const first = [...ids].sort()[0];
  if (first === undefined) throw new CharacterImportError("no_model_json", "no costumes resolved from the archive");
  return first;
}

function posixBasename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
