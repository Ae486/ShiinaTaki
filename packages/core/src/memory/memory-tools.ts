/**
 * INPUT:  MemoryToolOps (engine-backed) + a bound characterId + an optional turn-seq getter + LLM-supplied tool args
 * OUTPUT: createMemoryTools(ops, characterId, seq?) -> ToolSet { memory_write, memory_search, memory_archive };
 *         createBackgroundMemoryTools(ops, characterId, seq?) -> the same set with memory_write restricted to the auto rungs
 * POS:    core/memory — the FIRST agent tools; thin, characterId-closured; execute NEVER throws (returns {ok:false})
 */
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { AUTO_LAYER_CHOICES, autoLayerGuidance, clampAutoImportance } from "./auto-layer-policy.ts";
import type { MemoryOrigin } from "./entry.ts";
import { V1_MEMORY_LAYERS, WRITABLE_LAYER_IDS, isWritableLayer } from "./layer-registry.ts";
import type { RankedEntry } from "./retriever.ts";

// Model-facing result envelope + error codes — core-internal (NOT @taki/shared, which is cross-process protocol).
type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };
const TOOL_ERR = { notWritable: "LAYER_NOT_WRITABLE", notFound: "NOT_FOUND", io: "IO_ERROR" } as const;

const LAYER_IDS = V1_MEMORY_LAYERS.map((layer) => layer.id) as [string, ...string[]];
const LayerEnum = z.enum(LAYER_IDS);
// The automatic write tool's layer set — derived from the registry via the Q11-1 policy, never listed here.
const AutoLayerEnum = z.enum(AUTO_LAYER_CHOICES);
// Content sensed from the outside world (a VLM's screen description) is open-world text wherever it renders (Q8/D47).
const OBSERVED_ORIGIN: MemoryOrigin = "observed";

/** Reads the timeline seq the current turn is at, so a memory event can be joined back to the turn that caused it. */
export type TurnSeqGetter = () => number | undefined;

/** One write request for the engine's file-first-then-index path; the tool path fills only the first four fields. */
export interface MemoryWriteRequest {
  characterId: string;
  type: string;
  content: string;
  importance: number;
  disclosure?: string;
  /** Defaults to "self"; the image-description bridge writes "observed" (T5 Q8). */
  origin?: MemoryOrigin;
  /** Timeline seq this write belongs to — recorded on the R9 reinforce event when the caller knows it. */
  turnSeq?: number;
}

/** The high-level memory operations the tools delegate to (the engine implements this). */
export interface MemoryToolOps {
  writeEntry(input: MemoryWriteRequest): { id: string; layer: string };
  archiveEntry(input: { characterId: string; id: string }): boolean;
  search(input: { characterId: string; query: string; layer?: string }): RankedEntry[];
  /** 其四: one row per memory_search so under- and over-searching are both observable. Counts only, never the query. */
  recordSearch(input: { characterId: string; turnSeq?: number; count: number }): void;
}

export function createMemoryTools(ops: MemoryToolOps, characterId: string, seq?: TurnSeqGetter): ToolSet {
  return {
    memory_write: writeTool(ops, characterId),
    memory_search: searchTool(ops, characterId, seq),
    memory_archive: archiveTool(ops, characterId),
  };
}

/**
 * The set handed to an AUTOMATIC pass (the flush turn today). Same tool NAMES — the prompts and the caller's write
 * count key off `memory_write` — but the write tool cannot reach the always-visible rung: Q11-1's accepted cost of a
 * misjudged background write is "one more searchable row", and that only holds if EVERY automatic path is clamped.
 */
export function createBackgroundMemoryTools(ops: MemoryToolOps, characterId: string, seq?: TurnSeqGetter): ToolSet {
  return {
    memory_write: backgroundWriteTool(ops, characterId),
    memory_search: searchTool(ops, characterId, seq),
    memory_archive: archiveTool(ops, characterId),
  };
}

function writeTool(ops: MemoryToolOps, characterId: string): Tool {
  return tool({
    description:
      "Save one lasting memory that you have deliberately decided to keep. This is your own act, so it is the only " +
      "path that may reach the always-visible tier — the background writer never can. " +
      "Layers and importance: 'relationship' for promises, rules, or milestones (the user saying 记住/我们约定 → " +
      "relationship, importance 10); 'profile' for stable facts, preferences, or taboos about the user — use " +
      "importance 9 or 10 when the fact is identity-level (their name, how they want to be addressed, an allergy, a " +
      "hard boundary) so it stays in front of you, and 5-8 for an ordinary preference; 'episodes' for a notable " +
      "moment (3-7); 'intentions' for a private thought to raise later. " +
      "Do NOT use this for fleeting chit-chat, for something your memory already holds (correct the old entry with " +
      "memory_archive plus a fresh write instead of appending a second version), or to look something up — that is " +
      "memory_search. " +
      "`disclosure` is a short phrase describing WHEN this should come back to you, worded the way the question " +
      "would be asked ('用户问自己叫什么').",
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

// The AUTOMATIC pass's write tool. The layer enum is the ENFORCEMENT (a provider treats an enum as a hint, so the
// client-side zod parse is what actually rejects `relationship`); the model reads the resulting tool-error and retries
// with a permitted layer inside the step cap, so a promise still gets saved — just below the pin line, where R16
// pin-on-repeat or the tidy pass can promote it deliberately.
function backgroundWriteTool(ops: MemoryToolOps, characterId: string): Tool {
  return tool({
    description:
      "Save one lasting memory from the stretch of conversation you are reviewing. Choose the layer that fits what " +
      `you are keeping: ${autoLayerGuidance()}. Importance is your 1-10 judgement of how much it should shape your ` +
      "later replies; it is held inside the background range, so a high number here will not put the memory in " +
      "front of you permanently. Do NOT use this for fleeting chit-chat, for something your memory already holds, " +
      "or to look something up — that is memory_search. `disclosure` is a short phrase describing WHEN this should " +
      "come back to you, worded the way the question would be asked ('用户问自己叫什么').",
    inputSchema: z.object({
      type: AutoLayerEnum,
      content: z.string().min(1),
      importance: z.int().min(1).max(10),
      disclosure: z.string().optional(),
    }),
    execute: ({ type, content, importance, disclosure }): ToolResult => {
      try {
        const entry = ops.writeEntry({
          characterId,
          type,
          content,
          importance: clampAutoImportance(type, importance),
          disclosure,
        });
        return { ok: true, id: entry.id, layer: entry.layer };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function searchTool(ops: MemoryToolOps, characterId: string, seq?: TurnSeqGetter): Tool {
  return tool({
    description: "Search your long-term memory for something you may have forgotten. Optionally restrict to one layer.",
    inputSchema: z.object({ query: z.string().min(1), layer: LayerEnum.optional() }),
    execute: ({ query, layer }): ToolResult => {
      try {
        const hits = ops.search({ characterId, query, layer });
        ops.recordSearch({ characterId, turnSeq: seq?.(), count: hits.length });
        return { ok: true, results: hits.map(toHit) };
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

/**
 * `disclosure` rides along so she can see WHY a hit came back (and fix a bad trigger on the spot, T5-R17); `origin`
 * so the fence below is legible rather than mysterious. Observed content is fenced HERE because the search path is a
 * second way memory reaches the prompt — the assembler's row sites fence on the same rule (Q8/D47).
 */
function toHit(entry: RankedEntry): Record<string, unknown> {
  const content =
    entry.origin === OBSERVED_ORIGIN ? fenceUntrusted({ source: "memory", content: entry.content }) : entry.content;
  return {
    id: entry.id,
    layer: entry.layer,
    content,
    importance: entry.importance,
    created: entry.created,
    disclosure: entry.disclosure,
    origin: entry.origin,
  };
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
