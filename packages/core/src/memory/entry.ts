/**
 * INPUT:  parsed frontmatter data + body (fromFile) or a MemoryEntry + body (toFile)
 * OUTPUT: MemoryEntrySchema + MemoryOriginSchema/MemoryOrigin + entryFromFile(text) -> {entry, body};
 *         entryToFile(entry, body) -> text
 * POS:    core/memory — the memory-entry domain codec: frontmatter <-> zod entry (snake_case disk key mapped to camelCase)
 */
import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from "./frontmatter.ts";

export const MemoryEntryStatusSchema = z.enum(["active", "archived"]);
export type MemoryEntryStatus = z.infer<typeof MemoryEntryStatusSchema>;

// Who authored the remembered content: "self" = she wrote it from the conversation; "observed" = it came from
// something sensed about the outside world (a VLM image description). Render sites fence observed content (Q8/D47).
export const MemoryOriginSchema = z.enum(["self", "observed"]);
export type MemoryOrigin = z.infer<typeof MemoryOriginSchema>;

// Frontmatter field set (MEMORY-DESIGN). Disk keys are snake_case; `emotional_weight` and `reinforce_count` are the
// two whose disk key differs from the TS name.
// `origin` defaults on read so every entry file written before T5 keeps parsing unchanged.
export const MemoryEntrySchema = z.object({
  id: z.string().min(1),
  layer: z.string().min(1),
  importance: z.int().min(1).max(10),
  disclosure: z.string().optional(),
  created: z.string().min(1),
  status: MemoryEntryStatusSchema,
  origin: MemoryOriginSchema.default("self"),
  emotionalWeight: z.number().optional(),
  expires: z.string().optional(),
  // R9 reinforcement: a near-duplicate write bumps the EXISTING entry instead of inserting a row.
  updated: z.string().optional(),
  reinforceCount: z.int().positive().optional(),
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
    origin: data.origin,
    emotionalWeight: data.emotional_weight,
    expires: data.expires,
    updated: data.updated,
    reinforceCount: data.reinforce_count,
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
    origin: entry.origin,
  };
  if (entry.disclosure !== undefined) data.disclosure = entry.disclosure;
  if (entry.emotionalWeight !== undefined) data.emotional_weight = entry.emotionalWeight;
  if (entry.expires !== undefined) data.expires = entry.expires;
  if (entry.updated !== undefined) data.updated = entry.updated;
  if (entry.reinforceCount !== undefined) data.reinforce_count = entry.reinforceCount;
  return serializeFrontmatter(data, body);
}
