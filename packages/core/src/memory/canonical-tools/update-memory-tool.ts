/**
 * INPUT:  revisioned update callback and a bounded list of explicit field changes
 * OUTPUT: conditional update_memory AI tool
 * POS:    core/memory/canonical-tools — dormant thin adapter; no authority identity is model supplied
 */
import type { EditableMemoryPatch } from "@taki/shared";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { ExpectedRevisionSchema, MemoryIdSchema, MUTATION_DESCRIPTION, MutationScopeSchema } from "./mutation-tool.ts";

type UpdateMemoryChange =
  | { field: "text"; value: string } | { field: "context"; value: string | null }
  | { field: "occurredStart"; value: string | null } | { field: "occurredEnd"; value: string | null }
  | { field: "factType"; value: "world" | "experience" } | { field: "entities"; value: string[] }
  | { field: "layerId"; value: string };
export interface UpdateMemoryToolInput { scope: "global" | "character"; memoryId: string; expectedRevision: number; changes: UpdateMemoryChange[] }

export function createUpdateMemoryTool(layers: [string, ...string[]], execute: (input: UpdateMemoryToolInput & { patch: EditableMemoryPatch }, options?: unknown) => Promise<unknown>): Tool {
  return tool({ description: `Update memory content, context, occurrence, fact type, entities, or Taki layer. ${MUTATION_DESCRIPTION}`, inputSchema: z.strictObject({ scope: MutationScopeSchema, memoryId: MemoryIdSchema, expectedRevision: ExpectedRevisionSchema, changes: changesSchema(layers) }), execute: (input, options) => execute({ ...input, patch: toPatch(input.changes) }, options) });
}
function toPatch(changes: UpdateMemoryToolInput["changes"]): EditableMemoryPatch { return Object.fromEntries(changes.map((change) => [change.field, change.value])) as EditableMemoryPatch; }
function changesSchema(layers: [string, ...string[]]) {
  const change = z.discriminatedUnion("field", [
    z.strictObject({ field: z.literal("text"), value: z.string().min(1).max(100_000) }), z.strictObject({ field: z.literal("context"), value: z.string().max(16_384).nullable() }),
    z.strictObject({ field: z.literal("occurredStart"), value: z.iso.datetime({ offset: true }).nullable() }), z.strictObject({ field: z.literal("occurredEnd"), value: z.iso.datetime({ offset: true }).nullable() }),
    z.strictObject({ field: z.literal("factType"), value: z.enum(["world", "experience"]) }), z.strictObject({ field: z.literal("entities"), value: z.array(z.string().min(1).max(256)).max(128) }),
    z.strictObject({ field: z.literal("layerId"), value: z.enum(layers) }),
  ]);
  return z.array(change).min(1).max(7).superRefine((changes, context) => {
    if (new Set(changes.map((item) => item.field)).size !== changes.length) context.addIssue({ code: "custom", message: "each memory field may be changed once" });
  }).describe("One or more explicit field replacements; use null only to clear a nullable field.");
}
