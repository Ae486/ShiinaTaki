/**
 * INPUT: model-selected work, explicit context summary, addressed direction and structural result choices
 * OUTPUT: bounded tool contracts without sender, Run authority or publication grants
 * POS: shared/protocol — model input; Core supplies all execution and source identities
 */
import { z } from "zod";
import { MaterialRefSchema } from "./context-source-schema.ts";
import { SubagentCompletionPolicySchema, SubagentToolSelectionSchema } from "./subagent-schema.ts";

export const SubagentDelegateToolSchema = z.strictObject({
  label: z.string().min(1).max(200), subagentId: z.uuid().nullable(),
  direction: z.string().min(1).max(1_000_000),
  context: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("fresh") }),
    z.strictObject({ kind: z.literal("snapshot"), summary: z.string().min(1).max(1_000_000) })]),
  completionPolicy: SubagentCompletionPolicySchema.default("request_parent"),
  toolSelection: SubagentToolSelectionSchema.nullable(),
  materials: z.array(MaterialRefSchema).max(200).default([]),
});
export type SubagentDelegateTool = z.infer<typeof SubagentDelegateToolSchema>;
export const SubagentMessageTargetSchema = z.strictObject({
  subagentId: z.uuid(), workInputId: z.uuid().nullable().optional(),
  expectedRunId: z.string().min(1).max(200).nullable().optional(), expectedControlVersion: z.int().nonnegative().nullable().optional(),
});
export const SubagentMessageToolSchema = z.strictObject({
  target: SubagentMessageTargetSchema, direction: z.string().max(1_000_000), continue: z.boolean(),
  replyToEventId: z.string().min(1).max(200).nullable().optional(),
  materials: z.array(MaterialRefSchema).max(200).default([]),
});
export type SubagentMessageTool = z.infer<typeof SubagentMessageToolSchema>;
export const SubagentResultToolSchema = z.strictObject({
  text: z.string().min(1).max(1_000_000), materials: z.array(MaterialRefSchema).max(200),
});
export const ParentContinuationToolSchema = z.strictObject({
  decision: z.enum(["internal_result", "no_action", "reply"]),
  text: z.string().max(1_000_000), reason: z.string().max(1000), materials: z.array(MaterialRefSchema).max(200),
});
export const SubagentInspectToolSchema = z.strictObject({
  category: z.enum(["workers", "messages", "inputs", "results", "materials", "events", "diagnostics"]).nullable().optional()
    .describe("workers lists compact state/targets; diagnostics adds full progress/usage. Other categories read one worker's retained evidence."),
  cursor: z.string().min(1).max(2000).nullable().optional(),
  subagentId: z.uuid().nullable(), completionId: z.string().min(1).max(200).nullable(),
  afterSeq: z.int().nonnegative().optional().describe("Legacy ignored field; use cursor for pagination."),
  limit: z.int().min(1).max(100).default(20),
});
