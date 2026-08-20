/**
 * INPUT:  revisioned invalidation callback and one target identity
 * OUTPUT: reversible invalidate_memory AI tool
 * POS:    core/memory/canonical-tools — dormant thin lifecycle adapter
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { ExpectedRevisionSchema, MemoryIdSchema, MUTATION_DESCRIPTION, MutationScopeSchema } from "./mutation-tool.ts";

export interface InvalidateMemoryToolInput { scope: "global" | "character"; memoryId: string; expectedRevision: number; reason: string | null }
export function createInvalidateMemoryTool(execute: (input: InvalidateMemoryToolInput, signal?: AbortSignal) => Promise<unknown>): Tool {
  return tool({ description: `Reversibly invalidate a memory that is no longer true or useful. ${MUTATION_DESCRIPTION}`, inputSchema: z.strictObject({ scope: MutationScopeSchema, memoryId: MemoryIdSchema, expectedRevision: ExpectedRevisionSchema, reason: z.string().max(512).nullable().describe("Bounded reason for invalidation, or null when no reason is needed.") }), execute: (input, options) => execute(input, options.abortSignal) });
}
