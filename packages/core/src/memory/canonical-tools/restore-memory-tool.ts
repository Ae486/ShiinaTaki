/**
 * INPUT:  revisioned restoration callback and one target identity
 * OUTPUT: conditional restore_memory AI tool
 * POS:    core/memory/canonical-tools — dormant thin lifecycle adapter
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { ExpectedRevisionSchema, MemoryIdSchema, MUTATION_DESCRIPTION, MutationScopeSchema } from "./mutation-tool.ts";

export interface RestoreMemoryToolInput { scope: "global" | "character"; memoryId: string; expectedRevision: number }
export function createRestoreMemoryTool(execute: (input: RestoreMemoryToolInput, options?: unknown) => Promise<unknown>): Tool {
  return tool({ description: `Restore one previously invalidated memory. ${MUTATION_DESCRIPTION}`, inputSchema: z.strictObject({ scope: MutationScopeSchema, memoryId: MemoryIdSchema, expectedRevision: ExpectedRevisionSchema }), execute });
}
