/**
 * INPUT:  parsed frontmatter data + body (fromFile) or a MemoryEntry + body (toFile)
 * OUTPUT: MemoryEntrySchema + entryFromFile(text) -> {entry, body}; entryToFile(entry, body) -> text
 * POS:    core/memory — the memory-entry domain codec: frontmatter <-> zod entry (snake_case disk key mapped to camelCase)
 */
import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from "./frontmatter.ts";

export const MemoryEntryStatusSchema = z.enum(["active", "archived"]);
export type MemoryEntryStatus = z.infer<typeof MemoryEntryStatusSchema>;

// Frontmatter field set (MEMORY-DESIGN). Disk keys are snake_case; only `emotional_weight` differs from its TS name.
export const MemoryEntrySchema = z.object({
  id: z.string().min(1),
  layer: z.string().min(1),
  importance: z.int().min(1).max(10),
  disclosure: z.string().optional(),
  created: z.string().min(1),
  status: MemoryEntryStatusSchema,
  emotionalWeight: z.number().optional(),
  expires: z.string().optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface EntryFile {
  entry: MemoryEntry;
  body: string;
}

export function entryFromFile(text: string): EntryFile {
  const { data, body } = parseFrontmatter(text);
  const entry = MemoryEntrySchema.parse({
    id: data.id,
    layer: data.layer,
    importance: data.importance,
    disclosure: data.disclosure,
    created: data.created,
    status: data.status,
    emotionalWeight: data.emotional_weight,
    expires: data.expires,
  });
  return { entry, body };
}

export function entryToFile(entry: MemoryEntry, body: string): string {
  // Omit undefined so optional fields never emit a bare `key:` line.
  const data: FrontmatterData = {
    id: entry.id,
    layer: entry.layer,
    importance: entry.importance,
    created: entry.created,
    status: entry.status,
  };
  if (entry.disclosure !== undefined) data.disclosure = entry.disclosure;
  if (entry.emotionalWeight !== undefined) data.emotional_weight = entry.emotionalWeight;
  if (entry.expires !== undefined) data.expires = entry.expires;
  return serializeFrontmatter(data, body);
}
