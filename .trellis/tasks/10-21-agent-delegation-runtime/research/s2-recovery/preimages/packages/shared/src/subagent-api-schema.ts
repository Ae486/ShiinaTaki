/**
 * INPUT: authenticated operator reads and exact displayed child/work controls
 * OUTPUT: bounded disposable conversation projections and explicit mutation outcomes
 * POS: shared/protocol — Core-owned work is authoritative; reconnect never replays a mutation
 */
import { z } from "zod";
import { ContextMaterialSchema } from "./context-source-schema.ts";
import { RunMessageSchema } from "./run-message-schema.ts";
import { SubagentInputSchema, SubagentTargetSchema } from "./subagent-schema.ts";
import { SubagentResultGroupSchema } from "./subagent-result-schema.ts";

const Id = z.string().min(1).max(200);
export const SUBAGENT_METHODS = { list: "subagent.list", history: "subagent.history", result: "subagent.result",
  send: "subagent.send", stop: "subagent.stop", continue: "subagent.continue", subscribe: "subagent.subscribe", changed: "subagent.changed" } as const;
export const SubagentSummarySchema = z.strictObject({
  subagentId: z.uuid(), characterId: Id, label: z.string().min(1).max(200), createdAt: z.iso.datetime({ offset: true }),
  activeRunId: Id.nullable(), activeWorkInputId: z.uuid().nullable(), controlVersion: z.int().nonnegative(), stopOrigin: z.enum(["user", "parent"]).nullable(),
  state: z.enum(["idle", "queued", "running", "blocked_user", "blocked_parent", "deferred"]),
  latestWorkInputId: z.uuid().nullable(), latestCompletionId: Id.nullable(),
});
export type SubagentSummary = z.infer<typeof SubagentSummarySchema>;
export const SubagentListParamsSchema = z.strictObject({ characterId: Id, afterId: z.uuid().optional(), limit: z.int().min(1).max(100).default(50) });
export const SubagentListResultSchema = z.strictObject({ entries: z.array(SubagentSummarySchema).max(100), nextCursor: z.uuid().nullable() });
export const SubagentHistoryParamsSchema = z.strictObject({
  characterId: Id, subagentId: z.uuid(), workInputId: z.uuid().optional(), runId: Id.optional(),
  afterSeq: z.int().nonnegative().default(0), inputAfterSeq: z.int().nonnegative().default(0),
  afterCompletionId: Id.optional(), limit: z.int().min(1).max(100).default(50),
});
export const SubagentResultParamsSchema = z.strictObject({ characterId: Id, completionId: Id });
export const SubagentResultViewSchema = z.strictObject({
  result: SubagentResultGroupSchema,
  deliveryState: z.enum(["staged", "held", "dispatch_committed", "sent", "unknown", "no_target", "expired", "suppressed"]).nullable(),
});
export type SubagentResultView = z.infer<typeof SubagentResultViewSchema>;
export const SubagentHistoryResultSchema = z.strictObject({
  conversation: SubagentSummarySchema, inputs: z.array(SubagentInputSchema).max(100), messages: z.array(RunMessageSchema).max(100),
  results: z.array(SubagentResultViewSchema).max(100), nextMessageSeq: z.int().positive().nullable(),
  nextInputSeq: z.int().positive().nullable(), nextCompletionId: Id.nullable(),
  executions: z.array(z.strictObject({ runId: Id, workInputId: z.uuid(), throughWorkSeq: z.int().positive(),
    state: z.enum(["queued", "running", "waiting", "recovering", "cancel_requested", "completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]) })).max(100),
});
export const SubagentSendParamsSchema = z.strictObject({ characterId: Id, target: SubagentTargetSchema,
  operationKey: Id, direction: z.string().max(1_000_000), materials: z.array(ContextMaterialSchema).max(200) });
export const SubagentStopParamsSchema = z.strictObject({ characterId: Id, target: SubagentTargetSchema });
export const SubagentContinueParamsSchema = SubagentSendParamsSchema;
export const SubagentControlResultSchema = z.strictObject({
  conversation: SubagentSummarySchema, input: SubagentInputSchema.nullable(), cancellationRequested: z.boolean(),
});
export type SubagentControlResult = z.infer<typeof SubagentControlResultSchema>;
export const SubagentSubscribeParamsSchema = z.strictObject({});
export const SubagentSubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export const SubagentChangedSchema = z.strictObject({ characterId: Id, subagentId: z.uuid(), revision: z.int().positive() });
export type SubagentChanged = z.infer<typeof SubagentChangedSchema>;
