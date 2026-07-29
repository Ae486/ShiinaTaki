/**
 * INPUT:  MemoryWriteInput / entry file paths + a memory root dir under the Workspace
 * OUTPUT: createMemoryStore({root}) -> { write, archiveAtPath, reinforceAtPath, readAtPath, list, root };
 *         StoredEntry; StoreListing
 * POS:    core/memory — THE sanctioned node:fs site (invariant 1, Workspace-scoped); files are truth, atomic temp+rename
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, sep } from "node:path";
import { entryFromFile, entryToFile, MemoryEntrySchema, type MemoryEntry, type MemoryOrigin } from "./entry.ts";
import { getLayer, type MemoryLayerDefinition } from "./layer-registry.ts";
import { assertSafeSegment, resolveWithin, slugify } from "./naming.ts";

export interface StoredEntry {
  entry: MemoryEntry;
  characterId: string | null; // null for global layers; carried by the directory, not the frontmatter
  filePath: string;
  body: string;
  contentHash: string;
}

export interface InvalidEntryFile {
  filePath: string;
  reason: string;
}

export interface StoreListing {
  entries: StoredEntry[];
  invalid: InvalidEntryFile[];
}

export interface MemoryWriteInput {
  layer: string;
  characterId?: string;
  content: string;
  importance: number;
  disclosure?: string;
  origin?: MemoryOrigin;
  emotionalWeight?: number;
  expires?: string;
}

export interface MemoryStore {
  write(input: MemoryWriteInput): StoredEntry;
  archiveAtPath(filePath: string): StoredEntry;
  /** T5-R9: bump an existing entry in place (importance up, recency refreshed) instead of inserting a duplicate row. */
  reinforceAtPath(filePath: string, importance: number): StoredEntry;
  readAtPath(filePath: string): StoredEntry;
  /** Every entry file under the root, parsed — the reconciliation source of truth. */
  list(): StoreListing;
  readonly root: string;
}

export function createMemoryStore(deps: { root: string }): MemoryStore {
  const { root } = deps;

  function archiveAtPath(filePath: string): StoredEntry {
    return rewriteEntry(root, filePath, (entry) => ({ ...entry, status: "archived" }));
  }

  // Importance only ever rises: an explicit high-importance entry must not be demoted by a later automatic write.
  function reinforceAtPath(filePath: string, importance: number): StoredEntry {
    return rewriteEntry(root, filePath, (entry) => ({
      ...entry,
      importance: Math.max(entry.importance, importance),
      updated: new Date().toISOString(),
      reinforceCount: (entry.reinforceCount ?? 0) + 1,
    }));
  }

  function readAtPath(filePath: string): StoredEntry {
    resolveWithin(root, filePath);
    return toStored(root, filePath, readFileSync(filePath, "utf8"));
  }

  // Files are user-editable truth: a hand-broken file is REPORTED as invalid, never a boot crash (research §1).
  function list(): StoreListing {
    const entries: StoredEntry[] = [];
    const invalid: InvalidEntryFile[] = [];
    for (const rel of listRelativeEntryFiles(root)) {
      const filePath = resolveWithin(root, rel);
      try {
        entries.push(toStored(root, filePath, readFileSync(filePath, "utf8")));
      } catch (error) {
        invalid.push({ filePath, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { entries, invalid };
  }

  return { write: (input) => createEntryFile(root, input), archiveAtPath, reinforceAtPath, readAtPath, list, root };
}

function createEntryFile(root: string, input: MemoryWriteInput): StoredEntry {
  const layer = requireLayer(input.layer);
  const { segments, characterId } = placement(layer, input.characterId);
  const id = allocateId(root, input.content);
  const entry = MemoryEntrySchema.parse({
    id,
    layer: layer.id,
    importance: input.importance,
    disclosure: input.disclosure,
    created: new Date().toISOString(),
    status: "active",
    origin: input.origin,
    emotionalWeight: input.emotionalWeight,
    expires: input.expires,
  });
  const text = entryToFile(entry, input.content);
  const filePath = resolveWithin(root, ...segments, `${id}.md`);
  writeAtomic(filePath, text);
  return { entry, characterId, filePath, body: input.content, contentHash: hashText(text) };
}

// Every in-place edit is this shape: containment guard (the path came from the DB index), read, transform the
// FRONTMATTER only, atomic write. The body is never rewritten — a stored memory's text is not ours to change.
function rewriteEntry(root: string, filePath: string, transform: (entry: MemoryEntry) => MemoryEntry): StoredEntry {
  resolveWithin(root, filePath);
  const { entry, body } = entryFromFile(readFileSync(filePath, "utf8"));
  const text = entryToFile(transform(entry), body);
  writeAtomic(filePath, text);
  return toStored(root, filePath, text);
}

function requireLayer(id: string): MemoryLayerDefinition {
  const layer = getLayer(id);
  if (!layer) throw new Error(`unknown memory layer: ${id}`);
  return layer;
}

// Ownership decides the directory: global lives under global/<layer>, per-character under characters/<id>/<layer>.
function placement(
  layer: MemoryLayerDefinition,
  characterId: string | undefined,
): { segments: string[]; characterId: string | null } {
  if (layer.ownership === "global") return { segments: ["global", layer.id], characterId: null };
  if (!characterId) throw new Error(`layer ${layer.id} is per-character but no characterId was given`);
  assertSafeSegment(characterId, "characterId");
  return { segments: ["characters", characterId, layer.id], characterId };
}

// Root-wide NNNN counter (>=4 digits): scan existing entry files, take max + 1 — unique per write (single writer).
function allocateId(root: string, content: string): string {
  let max = 0;
  for (const rel of listRelativeEntryFiles(root)) {
    const match = /^(\d{4,})-/.exec(basename(rel));
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${String(max + 1).padStart(4, "0")}-${slugify(content)}`;
}

function listRelativeEntryFiles(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true }).filter(
      (entry): entry is string => typeof entry === "string" && entry.endsWith(".md"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // first boot: no memory yet
    throw error;
  }
}

function toStored(root: string, filePath: string, text: string): StoredEntry {
  const { entry, body } = entryFromFile(text);
  return { entry, body, filePath, characterId: characterIdFromPath(root, filePath), contentHash: hashText(text) };
}

function characterIdFromPath(root: string, filePath: string): string | null {
  const parts = relative(root, filePath).split(sep);
  return parts[0] === "characters" ? (parts[1] ?? null) : null;
}

function writeAtomic(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, text);
  renameSync(tempPath, filePath); // same-volume atomic replace (Workspace-local)
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
