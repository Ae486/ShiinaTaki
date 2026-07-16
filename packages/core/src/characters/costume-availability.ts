/**
 * INPUT:  the Workspace characters/ root + a costume's dir/settings file + the marker's costume→settings map
 * OUTPUT: buildBasenameIndex / costumeExternalRefs / resolveExternals / costumeAvailability + per-request aggregates
 *         characterAvailability (availability per costume) and costumeResolutionMap (external ref → rel path | null)
 * POS:    core/characters — on-demand availability + external-`../_mtn_emp/`-ref resolution (#18 degrade-and-badge);
 *         computed per request, never stored. Read-only fs walk; OS-neutral (POSIX rel paths from the characters root).
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import type { CostumeAvailability } from "@taki/shared";
import { motionExpressionRefs, validateEssentials } from "./cubism-manifest.ts";
import { safeMemberPath } from "./member-path.ts";

export interface CostumeResolution {
  resolution: Record<string, string | null>; // external ref → POSIX rel path from the characters/ root, or null
  missingCount: number; // unique refs no imported character supplies
  missingOwners: string[]; // owner hints of the null-resolved refs, sorted (feeds the panel's "import <owners>" notice)
}

/** basename → sorted POSIX rel paths (from the characters/ root) across every imported character; markers skipped. */
export function buildBasenameIndex(charactersDir: string): Map<string, string[]> {
  let entries: Dirent[];
  try {
    entries = readdirSync(charactersDir, { recursive: true, withFileTypes: true });
  } catch {
    return new Map(); // characters/ absent — nothing imported, nothing resolvable
  }
  const relPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "character.json") continue;
    relPaths.push(relative(charactersDir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
  }
  relPaths.sort(); // deterministic candidate order on every OS (raw readdir order is filesystem-dependent)
  const index = new Map<string, string[]>();
  for (const relPath of relPaths) {
    const basename = relPath.slice(relPath.lastIndexOf("/") + 1);
    const bucket = index.get(basename);
    if (bucket) bucket.push(relPath);
    else index.set(basename, [relPath]);
  }
  return index;
}

/** Every motion/sound/expression ref containing `..` (the external-pool surface); [] when the settings are unreadable. */
export function costumeExternalRefs(costumeDir: string, settingsFile: string): string[] {
  const json = readSettingsJson(costumeDir, settingsFile);
  return json === undefined ? [] : externalRefs(json);
}

/** Resolve external refs by basename over the imported-characters index: owner-hint dir → own character → any → null. */
export function resolveExternals(deps: {
  refs: string[];
  index: Map<string, string[]>;
  characterId: string;
}): CostumeResolution {
  const resolution: Record<string, string | null> = {};
  const owners = new Set<string>();
  let missingCount = 0;
  for (const ref of deps.refs) {
    if (ref in resolution) continue; // unique refs count once (the manifest may repeat a pool file across groups)
    const hit = resolveOne(ref, deps);
    resolution[ref] = hit;
    if (hit !== null) continue;
    missingCount += 1;
    const owner = ownerOf(refSegments(ref));
    if (owner !== undefined) owners.add(owner);
  }
  return { resolution, missingCount, missingOwners: [...owners].sort() };
}

/** renderable = settings parse + essentials (moc/textures) exist locally; missing counts from external-ref resolution. */
export function costumeAvailability(deps: {
  costumeDir: string;
  settingsFile: string;
  characterId: string;
  index: Map<string, string[]>;
}): CostumeAvailability {
  const json = readSettingsJson(deps.costumeDir, deps.settingsFile);
  if (json === undefined) return { renderable: false, missingMotions: 0, missingPacks: [] };
  const resolved = resolveExternals({ refs: externalRefs(json), index: deps.index, characterId: deps.characterId });
  return {
    renderable: essentialsPresent(json, deps.costumeDir),
    missingMotions: resolved.missingCount,
    missingPacks: resolved.missingOwners,
  };
}

/** Availability for every costume of one character — the basename index is built ONCE per request (one tree walk). */
export function characterAvailability(deps: {
  charactersDir: string;
  characterId: string;
  settingsFilesByCostume: Record<string, string>;
}): Record<string, CostumeAvailability> {
  const index = buildBasenameIndex(deps.charactersDir);
  const availability: Record<string, CostumeAvailability> = {};
  for (const [costume, settingsFile] of Object.entries(deps.settingsFilesByCostume)) {
    const costumeDir = safeCostumeDir(deps.charactersDir, `${deps.characterId}/${costume}`);
    availability[costume] =
      costumeDir === null
        ? { renderable: false, missingMotions: 0, missingPacks: [] }
        : costumeAvailability({ costumeDir, settingsFile, characterId: deps.characterId, index });
  }
  return availability;
}

/** One costume's full external-ref resolution map (the payload character.costumeResolution serves on demand). */
export function costumeResolutionMap(deps: {
  charactersDir: string;
  characterId: string;
  costume: string;
  settingsFile: string;
}): Record<string, string | null> {
  const costumeDir = safeCostumeDir(deps.charactersDir, `${deps.characterId}/${deps.costume}`);
  if (costumeDir === null) return {};
  const refs = costumeExternalRefs(costumeDir, deps.settingsFile);
  if (refs.length === 0) return {}; // fast path: a self-contained costume never pays the tree walk
  return resolveExternals({ refs, index: buildBasenameIndex(deps.charactersDir), characterId: deps.characterId }).resolution;
}

function externalRefs(json: unknown): string[] {
  return motionExpressionRefs(json).filter((ref) => ref.includes(".."));
}

// Owner-hint first (the pool subdir names the character whose pack ships the file), then the costume's own character,
// then any import — pool subdir and archive id can disagree (tomori vs tomorin), so the hint never gates a match.
function resolveOne(ref: string, deps: { index: Map<string, string[]>; characterId: string }): string | null {
  const segments = refSegments(ref);
  const candidates = deps.index.get(segments.at(-1) ?? "") ?? [];
  const owner = ownerOf(segments);
  const byOwner = owner === undefined ? undefined : candidates.find((path) => path.startsWith(`${owner}/`));
  return byOwner ?? candidates.find((path) => path.startsWith(`${deps.characterId}/`)) ?? candidates[0] ?? null;
}

function refSegments(ref: string): string[] {
  return ref
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

// The segment after `_mtn_emp` names the owning character — only when it is a directory (not the filename itself).
function ownerOf(segments: string[]): string | undefined {
  const at = segments.indexOf("_mtn_emp");
  return at !== -1 && at + 1 < segments.length - 1 ? segments[at + 1] : undefined;
}

// An external essential also lands here: safeMemberPath nulls a `..` ref, validateEssentials sees it as absent → throw.
function essentialsPresent(json: unknown, costumeDir: string): boolean {
  try {
    validateEssentials(json, (relPath) => existsSync(join(costumeDir, ...relPath.split("/"))));
    return true;
  } catch {
    return false;
  }
}

function readSettingsJson(costumeDir: string, settingsFile: string): unknown {
  const safe = safeMemberPath(settingsFile);
  if (safe === null) return undefined;
  try {
    return JSON.parse(readFileSync(join(costumeDir, ...safe.split("/")), "utf8"));
  } catch {
    return undefined; // unreadable/bad JSON → the costume degrades to unrenderable, never a crash
  }
}

// Marker fields are import-derived but hand-editable on disk — re-confine before any read join (defense-in-depth).
function safeCostumeDir(charactersDir: string, relPath: string): string | null {
  const safe = safeMemberPath(relPath);
  return safe === null ? null : join(charactersDir, ...safe.split("/"));
}
