/**
 * INPUT:  TidyToolOps (engine-backed row/block maintenance) + the bound characterId + LLM-supplied tool args
 * OUTPUT: createTidyTools(ops, characterId) -> ToolSet { memory_reinforce, memory_archive_supersede,
 *         memory_set_disclosure, memory_refile, block_rethink, memory_finish_edits }; FINISH_TOOL_NAME
 * POS:    core/memory — the tidy pass's maintenance verbs; the FOREGROUND agent never gets these (Letta tool
 *         asymmetry, rc A2); thin, characterId-closured, execute NEVER throws (memory-tools envelope conventions).
 *         All tools are closed-world; row ops are idempotent-safe, block_rethink replaces a whole file
 */
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { V1_BLOCKS } from "./block-registry.ts";
import type { BlockWriteResult } from "./block-store.ts";
import { WRITABLE_LAYER_IDS } from "./layer-registry.ts";
import type { MemoryWriteRequest } from "./memory-tools.ts";

// The structural loop terminator (rc A2: Letta enforces exit via TerminalToolRule, never "the model just stops").
// The pass's stopWhen keys off this exact name — the two must agree, so it is exported from here.
export const FINISH_TOOL_NAME = "memory_finish_edits";

type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };
const TOOL_ERR = { notFound: "NOT_FOUND", refused: "REFUSED", io: "IO_ERROR" } as const;

const WritableLayerEnum = z.enum(WRITABLE_LAYER_IDS as [string, ...string[]]);
const BlockIdEnum = z.enum(V1_BLOCKS.map((block) => block.id) as [string, ...string[]]);

/** The engine-backed maintenance operations (the engine implements this — same seam shape as MemoryToolOps). */
export interface TidyToolOps {
  /** Refresh recency + reinforce count on the existing row; false = id unknown in this character's scope. */
  reinforce(input: { characterId: string; id: string }): boolean;
  archive(input: { characterId: string; id: string }): boolean;
  writeEntry(input: MemoryWriteRequest): { id: string; layer: string };
  setDisclosure(input: { characterId: string; id: string; disclosure: string }): boolean;
  refile(input: { characterId: string; id: string; layer: string }): { id: string; layer: string } | undefined;
  rethinkBlock(input: { id: string; characterId: string; content: string }): BlockWriteResult;
}

export function createTidyTools(ops: TidyToolOps, characterId: string): ToolSet {
  return {
    memory_reinforce: reinforceTool(ops, characterId),
    memory_archive_supersede: archiveSupersedeTool(ops, characterId),
    memory_set_disclosure: setDisclosureTool(ops, characterId),
    memory_refile: refileTool(ops, characterId),
    block_rethink: blockRethinkTool(ops, characterId),
    [FINISH_TOOL_NAME]: finishTool(),
  };
}

function reinforceTool(ops: TidyToolOps, characterId: string): Tool {
  return tool({
    description:
      "Mark an existing memory as still alive: refreshes its recency and reinforcement count so it stops reading " +
      "as stale. Use it when a flagged entry is fine exactly as it stands. It changes neither content nor " +
      "importance — to correct content use memory_archive_supersede, to fix only the recall trigger use " +
      "memory_set_disclosure.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: ({ id }): ToolResult => {
      try {
        return ops.reinforce({ characterId, id })
          ? { ok: true, id }
          : { ok: false, code: TOOL_ERR.notFound, message: `no memory with id '${id}'` };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function archiveSupersedeTool(ops: TidyToolOps, characterId: string): Tool {
  return tool({
    description:
      "Archive one memory and optionally write its corrected replacement in the same act — the way to fix " +
      "outdated or wrong content: never leave two conflicting versions live. The replacement is a fresh entry in " +
      "any writable layer at any importance 1-10 (this pass MAY deliberately place identity-level facts at 9-10, " +
      "where they stay always visible). Omit `replacement` to only archive. For a trigger-only fix use " +
      "memory_set_disclosure; for a wrong layer only, memory_refile.",
    inputSchema: z.object({
      id: z.string().min(1),
      replacement: z
        .object({
          layer: WritableLayerEnum,
          content: z.string().min(1),
          importance: z.int().min(1).max(10),
          disclosure: z.string().optional(),
        })
        .optional(),
    }),
    execute: ({ id, replacement }): ToolResult => {
      try {
        if (!ops.archive({ characterId, id })) {
          return { ok: false, code: TOOL_ERR.notFound, message: `no memory with id '${id}'` };
        }
        if (!replacement) return { ok: true, archived: id };
        // The archive lands FIRST, so R9 dedupe can never bounce the replacement off the row it supersedes. It stays
        // live against OTHER rows on purpose: a replacement that duplicates a third row should reinforce it, not mint
        // a second copy — the returned id then names that existing row.
        const written = ops.writeEntry({
          characterId,
          type: replacement.layer,
          content: replacement.content,
          importance: replacement.importance,
          disclosure: replacement.disclosure,
        });
        return { ok: true, archived: id, replacement: written };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function setDisclosureTool(ops: TidyToolOps, characterId: string): Tool {
  return tool({
    description:
      "Set or replace a memory's recall trigger — the short phrase, worded the way the question would be asked " +
      "('用户问自己叫什么'), that lets one search find it. This is the repair for entries flagged with no trigger, " +
      "and for triggers that never fire. The memory's content stays untouched.",
    inputSchema: z.object({ id: z.string().min(1), disclosure: z.string().min(1) }),
    execute: ({ id, disclosure }): ToolResult => {
      try {
        return ops.setDisclosure({ characterId, id, disclosure })
          ? { ok: true, id }
          : { ok: false, code: TOOL_ERR.notFound, message: `no memory with id '${id}'` };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function refileTool(ops: TidyToolOps, characterId: string): Tool {
  return tool({
    description:
      "Move a memory into the layer it belongs in; its id, content, importance and dates stay unchanged. Use it " +
      "for an entry filed in the wrong layer — for content problems use memory_archive_supersede instead.",
    inputSchema: z.object({ id: z.string().min(1), layer: WritableLayerEnum }),
    execute: ({ id, layer }): ToolResult => {
      try {
        const moved = ops.refile({ characterId, id, layer });
        return moved
          ? { ok: true, id: moved.id, layer: moved.layer }
          : { ok: false, code: TOOL_ERR.notFound, message: `no memory with id '${id}'` };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function blockRethinkTool(ops: TidyToolOps, characterId: string): Tool {
  return tool({
    description:
      "Rewrite one always-visible memory block wholesale — for sweeping changes only (recomputing the memory " +
      "index, consolidating the user model), never for a small row fix (the memory_* tools cover those). The new " +
      "content REPLACES the whole block file, so include everything that should survive. Blocks the user maintains " +
      "themselves (the identity card) are refused.",
    inputSchema: z.object({ id: BlockIdEnum, content: z.string().min(1) }),
    execute: ({ id, content }): ToolResult => {
      try {
        const result = ops.rethinkBlock({ id, characterId, content });
        // A writer-policy refusal is the batch-2 store seam doing its job — surfaced as a result the model can read.
        return result.ok ? { ok: true, id } : { ok: false, code: TOOL_ERR.refused, message: result.reason };
      } catch (error) {
        return { ok: false, code: TOOL_ERR.io, message: readable(error) };
      }
    },
  });
}

function finishTool(): Tool {
  return tool({
    description:
      "Call this when the review is complete — including immediately, when nothing needed an edit. It is the only " +
      "way the pass ends before the step cap; never stop by just writing text.",
    inputSchema: z.object({}),
    execute: (): ToolResult => ({ ok: true }),
  });
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
