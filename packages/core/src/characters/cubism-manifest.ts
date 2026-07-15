/**
 * INPUT:  a parsed Cubism settings manifest (unknown JSON) + a has(relPath) existence probe over the costume's files
 * OUTPUT: detectGeneration / validateManifest (throws on missing moc|textures, warns on optional misses) / extractManifestNames
 * POS:    core/characters — clean-room Cubism 2.1 vs 3-5 handling (#18). Detection + validation feed the importer; name
 *         extraction feeds a costume's motion/expression vocabulary. Pure, OS-neutral; no fs, no engine dependency.
 */
import { CharacterImportError } from "./import-error.ts";
import { safeMemberPath } from "./member-path.ts";

export type Generation = "cubism2" | "cubism3";

/** Cubism 3-5 iff the manifest carries a `FileReferences` object OR a `Version` beginning with "3"; else Cubism 2.1. */
export function detectGeneration(json: unknown): Generation {
  const obj = asRecord(json);
  if (asRecord(obj?.FileReferences)) return "cubism3";
  const version = obj?.Version;
  if (version !== undefined && String(version).startsWith("3")) return "cubism3";
  return "cubism2";
}

/**
 * Validate a manifest against the costume's extracted files. Essential geometry (moc/moc3) + every texture MUST exist
 * (hard failure). Every OPTIONAL reference missing (motions/expressions/physics/pose/display) → a warning, never a
 * failure (decision 6: e.g. a Cubism-2 costume's external `../_mtn_emp/` shared-motion pool is tolerated at load).
 */
export function validateManifest(json: unknown, has: (relPath: string) => boolean): string[] {
  const obj = asRecord(json) ?? {};
  const gen = detectGeneration(json);
  const source = gen === "cubism3" ? asRecord(obj.FileReferences) ?? {} : obj;
  const mocKey = gen === "cubism3" ? "Moc" : "model";
  const texKey = gen === "cubism3" ? "Textures" : "textures";
  requireMoc(asString(source[mocKey]), has);
  requireTextures(asStringArray(source[texKey]), has);
  return warnMissing(gen === "cubism3" ? optionalRefs3(source) : optionalRefs2(obj), has);
}

/** Motion GROUP names + expression names for BOTH generations (feeds a costume's avatar vocabulary). */
export function extractManifestNames(json: unknown): { motions: string[]; expressions: string[] } {
  const obj = asRecord(json) ?? {};
  const fr = asRecord(obj.FileReferences);
  const motionsObj = asRecord(obj.motions) ?? asRecord(fr?.Motions);
  const exprArr = asArray(obj.expressions) ?? asArray(fr?.Expressions);
  const expressions = (exprArr ?? [])
    .map((entry) => asString(asRecord(entry)?.name) ?? asString(asRecord(entry)?.Name))
    .filter((name): name is string => name !== undefined);
  return { motions: dedupeSort(motionsObj ? Object.keys(motionsObj) : []), expressions: dedupeSort(expressions) };
}

interface ResourceRef {
  kind: "motion" | "expression" | "physics" | "pose" | "display";
  path: string;
}

function requireMoc(moc: string | undefined, has: (relPath: string) => boolean): void {
  if (moc === undefined || !existsResolved(moc, has)) {
    throw new CharacterImportError("missing_moc", `manifest references no reachable moc geometry (${moc ?? "absent"})`);
  }
}

function requireTextures(textures: string[] | undefined, has: (relPath: string) => boolean): void {
  if (textures === undefined || textures.length === 0) {
    throw new CharacterImportError("missing_textures", "manifest references no textures");
  }
  for (const texture of textures) {
    if (!existsResolved(texture, has)) throw new CharacterImportError("missing_textures", `missing texture: ${texture}`);
  }
}

function warnMissing(refs: ResourceRef[], has: (relPath: string) => boolean): string[] {
  const missingByKind = new Map<string, number>();
  for (const ref of refs) {
    if (!existsResolved(ref.path, has)) missingByKind.set(ref.kind, (missingByKind.get(ref.kind) ?? 0) + 1);
  }
  return [...missingByKind].map(([kind, count]) => `${count} optional ${kind} file(s) referenced but not found (tolerated at load)`);
}

// A ref that fails normalization (absolute / `..` / device) is treated as absent — for an OPTIONAL ref that means a
// warning (e.g. external `../_mtn_emp/`); for an ESSENTIAL ref requireMoc/requireTextures turn absent into a hard fail.
function existsResolved(ref: string, has: (relPath: string) => boolean): boolean {
  const safe = safeMemberPath(ref);
  return safe !== null && has(safe);
}

function optionalRefs2(obj: Record<string, unknown>): ResourceRef[] {
  const refs: ResourceRef[] = [];
  pushString(refs, "physics", obj.physics);
  pushString(refs, "pose", obj.pose);
  for (const group of Object.values(asRecord(obj.motions) ?? {})) {
    for (const entry of asArray(group) ?? []) pushString(refs, "motion", asRecord(entry)?.file);
  }
  for (const entry of asArray(obj.expressions) ?? []) pushString(refs, "expression", asRecord(entry)?.file);
  return refs;
}

function optionalRefs3(fr: Record<string, unknown>): ResourceRef[] {
  const refs: ResourceRef[] = [];
  pushString(refs, "physics", fr.Physics);
  pushString(refs, "pose", fr.Pose);
  pushString(refs, "display", fr.DisplayInfo);
  for (const group of Object.values(asRecord(fr.Motions) ?? {})) {
    for (const entry of asArray(group) ?? []) pushString(refs, "motion", asRecord(entry)?.File);
  }
  for (const entry of asArray(fr.Expressions) ?? []) pushString(refs, "expression", asRecord(entry)?.File);
  return refs;
}

function pushString(refs: ResourceRef[], kind: ResourceRef["kind"], value: unknown): void {
  const path = asString(value);
  if (path !== undefined) refs.push({ kind, path });
}

function dedupeSort(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : undefined;
}
