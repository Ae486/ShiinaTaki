/**
 * INPUT:  a costume's RAW settings JSON (either Cubism generation) + the resolve(ref) → url|null fn built in lib.
 * OUTPUT: pruneSettings(json, resolve) -> { settings, prunedMotions, prunedExpressions } — motion/expression entries
 *         with an unresolvable file are STRIPPED (a sound-only miss keeps the motion, minus sound); empty groups drop.
 * POS:    ui/renderer/live2d — pure JSON, framework-free, node-testable. Runs BEFORE createSettings so the engine
 *         (and readVocabulary → avatar.report) never sees an unresolvable `..` ref; moc/textures stay untouched (#18).
 */

export type ResolveRef = (ref: string) => string | null;

export interface PrunedSettings {
  settings: Record<string, unknown>;
  prunedMotions: number;
  prunedExpressions: number;
}

interface RefKeys {
  file: "file" | "File";
  sound: "sound" | "Sound";
}

export function pruneSettings(json: Record<string, unknown>, resolve: ResolveRef): PrunedSettings {
  const fr = asRecord(json.FileReferences);
  if (fr) {
    const keys: RefKeys = { file: "File", sound: "Sound" };
    const motions = pruneMotionGroups(asRecord(fr.Motions), keys, resolve);
    const expressions = pruneExpressions(asArray(fr.Expressions), keys, resolve);
    const pruned = withPruned(fr, { Motions: motions.groups, Expressions: expressions.list });
    return { settings: { ...json, FileReferences: pruned }, prunedMotions: motions.pruned, prunedExpressions: expressions.pruned };
  }
  const keys: RefKeys = { file: "file", sound: "sound" };
  const motions = pruneMotionGroups(asRecord(json.motions), keys, resolve);
  const expressions = pruneExpressions(asArray(json.expressions), keys, resolve);
  return {
    settings: withPruned(json, { motions: motions.groups, expressions: expressions.list }),
    prunedMotions: motions.pruned,
    prunedExpressions: expressions.pruned,
  };
}

function pruneMotionGroups(
  groups: Record<string, unknown> | undefined,
  keys: RefKeys,
  resolve: ResolveRef,
): { groups: Record<string, unknown> | undefined; pruned: number } {
  if (groups === undefined) return { groups: undefined, pruned: 0 };
  const kept: Record<string, unknown> = {};
  let pruned = 0;
  for (const [name, group] of Object.entries(groups)) {
    const entries = asArray(group);
    if (entries === undefined) {
      kept[name] = group; // not a motion array — leave unknown shapes alone
      continue;
    }
    const keptEntries: unknown[] = [];
    for (const entry of entries) {
      const next = pruneMotionEntry(entry, keys, resolve);
      if (next === undefined) pruned += 1;
      else keptEntries.push(next);
    }
    if (keptEntries.length > 0) kept[name] = keptEntries; // an emptied group would be an unplayable phantom name
  }
  return { groups: kept, pruned };
}

// undefined = drop the entry (unresolvable motion file); a sound-only miss keeps the motion without its sound.
function pruneMotionEntry(entry: unknown, keys: RefKeys, resolve: ResolveRef): unknown {
  const record = asRecord(entry);
  if (record === undefined) return entry;
  const file = record[keys.file];
  if (typeof file === "string" && resolve(file) === null) return undefined;
  const sound = record[keys.sound];
  if (typeof sound === "string" && resolve(sound) === null) {
    const rest = { ...record };
    delete rest[keys.sound];
    return rest;
  }
  return entry;
}

function pruneExpressions(
  list: unknown[] | undefined,
  keys: RefKeys,
  resolve: ResolveRef,
): { list: unknown[] | undefined; pruned: number } {
  if (list === undefined) return { list: undefined, pruned: 0 };
  const kept: unknown[] = [];
  let pruned = 0;
  for (const entry of list) {
    const file = asRecord(entry)?.[keys.file];
    if (typeof file === "string" && resolve(file) === null) pruned += 1;
    else kept.push(entry);
  }
  return { list: kept, pruned };
}

// Merge only the containers that existed (an absent motions/expressions key must stay absent, not become undefined).
function withPruned(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
