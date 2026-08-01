/**
 * INPUT:  the core data dir (BEFORE the core process boots) + memory entry specs
 * OUTPUT: seedMemoryEntries(coreDataDir, entries) — writes entry .md files into the workspace memory tree
 *         (<dataDir>/workspace/memory/characters/<cid>/<layer>/); startup reconcile indexes them (files are truth)
 * POS:    e2e/fixture — pre-boot memory seeding (name-recall L2); the file shape replicates core's
 *         store.ts/entry.ts/frontmatter.ts subset (flat scalars, JSON-quoted strings, body after the fence)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SeedMemoryEntry {
  /** Per-character placement (characters/<characterId>/<layer>) — the only shape these scenarios need. */
  characterId: string;
  layer: string;
  /** NNNN-slug (the store's allocateId shape); doubles as the file name. */
  id: string;
  content: string;
  importance: number;
  disclosure?: string;
  /** ISO timestamp; defaults to now. */
  created?: string;
}

export function seedMemoryEntries(coreDataDir: string, entries: SeedMemoryEntry[]): void {
  for (const entry of entries) {
    const dir = join(coreDataDir, "workspace", "memory", "characters", entry.characterId, entry.layer);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${entry.id}.md`), entryFileText(entry));
  }
}

// Key order and quoting mirror core's entryToFile/serializeFrontmatter, so reconcile parses the file unchanged.
function entryFileText(entry: SeedMemoryEntry): string {
  const lines = [
    "---",
    `id: ${JSON.stringify(entry.id)}`,
    `layer: ${JSON.stringify(entry.layer)}`,
    `importance: ${entry.importance}`,
    `created: ${JSON.stringify(entry.created ?? new Date().toISOString())}`,
    'status: "active"',
    'origin: "self"',
  ];
  if (entry.disclosure !== undefined) lines.push(`disclosure: ${JSON.stringify(entry.disclosure)}`);
  lines.push("---");
  return `${lines.join("\n")}\n${entry.content}`;
}
