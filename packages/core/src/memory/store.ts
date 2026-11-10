/**
 * INPUT:  MemoryWriteInput / entry file paths + a memory root dir under the Workspace
 * OUTPUT: createMemoryStore({root}) -> { write, archiveAtPath, reinforceAtPath, setDisclosureAtPath, refileAtPath,
 *         deleteAtPath, readAtPath, list, root }; StoredEntry; StoreListing
 * POS:    core/memory — the sanctioned node:fs site for ENTRY files (invariant 1, Workspace-scoped); files are truth,
 *         atomic temp+rename (blocks are the other tier and live in block-store.ts)
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, relative, sep } from "node:path";
import { entryFromFile, entryToFile, MemoryEntrySchema, type MemoryEntry, type MemoryOrigin } from "./entry.ts";
import { getLayer, type MemoryLayerDefinition } from "./layer-registry.ts";
import { assertSafeSegment, resolveWithin, slugify } from "./naming.ts";
import { writeAtomic } from "./write-atomic.ts";

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
  /** Tidy repair: replace the recall trigger in place; the body is untouched (a stored memory's text is not ours). */
  setDisclosureAtPath(filePath: string, disclosure: string): StoredEntry;
  /** Tidy repair: move an entry to another layer's directory — id, body, importance and dates all survive the move. */
  refileAtPath(filePath: string, layer: string, characterId?: string): { stored: StoredEntry; oldPath: string };
  /**
   * Remove an entry file outright. The ONLY sanctioned hard delete (T5-R8): a rolling-window layer's machine-written
   * rows. Everything an agent or a user authored ARCHIVES instead, because a misjudged archive is recoverable.
   */
  deleteAtPath(filePath: string): void;
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

  // The containment guard runs BEFORE the unlink (the path came from the DB index, but a delete is the one operation
  // whose blast radius is not recoverable from the files). A file already gone is not an error: the index row is what
  // the caller is really clearing, and reconcile heals either way.
  function deleteAtPath(filePath: string): void {
    resolveWithin(root, filePath);
    rmSync(filePath, { force: true });
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

  return {
    write: (input) => createEntryFile(root, input),
    archiveAtPath,
    reinforceAtPath,
    // `updated` is refreshed so a just-repaired trigger restarts the stale clock — without it the same row would
    // return as a stale candidate every pass. reinforceCount is NOT bumped: that counter records R9 duplicate evidence.
    setDisclosureAtPath: (filePath, disclosure) =>
      rewriteEntry(root, filePath, (entry) => ({ ...entry, disclosure, updated: new Date().toISOString() })),
    refileAtPath: (filePath, layer, characterId) => refileEntry(root, filePath, { layer, characterId }),
    deleteAtPath,
    readAtPath,
    list,
    root,
  };
}

/** Streaming maintenance traversal; one caller-controlled batch at a time, with malformed truth reported. */
export async function* scanMemoryEntries(root: string): AsyncGenerator<StoredEntry> {
  for (const rel of listRelativeEntryFiles(root)) {
    const filePath = resolveWithin(root, rel);
    let text: string;
    try { text = readFileSync(filePath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    yield toStored(root, filePath, text);
  }
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

// Write-first-then-delete: a crash between the two leaves both files; reconcile indexes both and resolvePath picks
// deterministically, so the store heals into a duplicate rather than losing the entry. Frontmatter changes ONLY the
// layer — dates and importance survive, so a refiled row neither decays nor un-stales by the move alone.
function refileEntry(
  root: string,
  filePath: string,
  args: { layer: string; characterId?: string },
): { stored: StoredEntry; oldPath: string } {
  resolveWithin(root, filePath);
  const target = requireLayer(args.layer);
  const { entry, body } = entryFromFile(readFileSync(filePath, "utf8"));
  const cid = args.characterId ?? characterIdFromPath(root, filePath) ?? undefined;
  const { segments } = placement(target, cid);
  const nextPath = resolveWithin(root, ...segments, basename(filePath));
  const text = entryToFile({ ...entry, layer: target.id }, body);
  writeAtomic(nextPath, text);
  if (nextPath !== filePath) rmSync(filePath, { force: true });
  return { stored: toStored(root, nextPath, text), oldPath: filePath };
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

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
