/**
 * INPUT:  MemoryToolOps (engine-backed) + a bound characterId + LLM-supplied tool args
 * OUTPUT: createMemoryTools(ops, characterId) -> ToolSet { memory_write, memory_search, memory_archive }
 * POS:    core/memory — the FIRST agent tools; thin, characterId-closured; execute NEVER throws (returns {ok:false})
 */
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { V1_MEMORY_LAYERS, WRITABLE_LAYER_IDS, isWritableLayer } from "./layer-registry.ts";
import type { RankedEntry } from "./retriever.ts";

// Model-facing result envelope + error codes — core-internal (NOT @taki/shared, which is cross-process protocol).
type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };
const TOOL_ERR = { notWritable: "LAYER_NOT_WRITABLE", notFound: "NOT_FOUND", io: "IO_ERROR" } as const;

const LAYER_IDS = V1_MEMORY_LAYERS.map((layer) => layer.id) as [string, ...string[]];
const LayerEnum = z.enum(LAYER_IDS);

/** The high-level memory operations the tools delegate to (the engine implements this). */
export interface MemoryToolOps {
  writeEntry(input: { characterId: string; type: string; content: string; importance: number; disclosure?: string }): {
    id: string;
    layer: string;
  };
  archiveEntry(input: { characterId: string; id: string }): boolean;
  search(input: { characterId: string; query: string; layer?: string }): RankedEntry[];
}

export function createMemoryTools(ops: MemoryToolOps, characterId: string): ToolSet {
  return {
    memory_write: writeTool(ops, characterId),
    memory_search: searchTool(ops, characterId),
    memory_archive: archiveTool(ops, characterId),
  };
}

function writeTool(ops: MemoryToolOps, characterId: string): Tool {
  return tool({
    description:
      "Save a lasting memory. Use 'relationship' for promises, rules, or milestones " +
      "(the user saying 记住/我们约定 → relationship, importance 10); 'profile' for stable user facts, " +
      "preferences, or taboos; 'episodes' for a notable moment; 'intentions' for a private thought to raise later. " +
      "Do not save fleeting chit-chat.",
    inputSchema: z.object({
      type: LayerEnum,
      content: z.string().min(1),
      importance: z.int().min(1).max(10),
      disclosure: z.string().optional(),
    }),
    execute: ({ type, content, importance, disclosure }): ToolResult => {
      try {
        if (!isWritableLayer(type)) {
          return {
            ok: false,
            code: TOOL_ERR.notWritable,
            message: `layer '${type}' is not writable by tools; writable layers: ${WRITABLE_LAYER_IDS.join(", ")}`,
          };
        }
        const entry = ops.writeEntry({ characterId, type, content, importance, disclosure });
        return { ok: true, id: entry.id, layer: entry.layer };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function searchTool(ops: MemoryToolOps, characterId: string): Tool {
  return tool({
    description: "Search your long-term memory for something you may have forgotten. Optionally restrict to one layer.",
    inputSchema: z.object({ query: z.string().min(1), layer: LayerEnum.optional() }),
    execute: ({ query, layer }): ToolResult => {
      try {
        return { ok: true, results: ops.search({ characterId, query, layer }).map(toHit) };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function archiveTool(ops: MemoryToolOps, characterId: string): Tool {
  return tool({
    description: "Archive a memory by id when it is outdated or was a mistake; it stops surfacing but is not deleted.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: ({ id }): ToolResult => {
      try {
        return ops.archiveEntry({ characterId, id })
          ? { ok: true, id }
          : { ok: false, code: TOOL_ERR.notFound, message: `no memory with id '${id}'` };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function toHit(entry: RankedEntry): Record<string, unknown> {
  return { id: entry.id, layer: entry.layer, content: entry.content, importance: entry.importance, created: entry.created };
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
