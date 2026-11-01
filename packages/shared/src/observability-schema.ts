/**
 * INPUT:  operator monitor queries, durable Run projections, and committed-event notifications
 * OUTPUT: strict bounded observability, independent history cursors, and typed semantic Inspector contracts
 * POS:    shared/protocol — disposable read models; canonical Run/Event authority remains in Core
 */
import { z } from "zod";
import { DeliveryClassSchema, RunInitiatorSchema, RunOutcomeSchema, RunStateSchema } from "./harness-schema.ts";
import { InputTokenDetailsSchema, OutputTokenDetailsSchema, UsageQualitySchema } from "./effect-lifecycle-schema.ts";
import { RunEventCategorySchema, RunEventKindSchema, RunEventSurfaceSchema } from "./run-event-schema.ts";

const Id = z.string().trim().min(1).max(200);
const Timestamp = z.string().datetime({ offset: true });
const Summary = z.string().trim().min(1).max(1_000);
const Label = z.string().trim().min(1).max(120);
const Count = z.number().int().nonnegative().max(1_000_000_000);
const Sequence = z.number().int().nonnegative().max(2_000_000_000);
const DisplayName = z.string().min(1).max(240).refine((value) => value.trim().length > 0);

export const MONITOR_MODE_CONFIG_KEY = "TAKI_MONITOR_MODE" as const;
export const OBSERVABILITY_METHODS = {
  state: "observability.state", list: "observability.list", trajectory: "observability.trajectory",
  inspect: "observability.inspect", subscribe: "observability.subscribe",
  unsubscribe: "observability.unsubscribe", event: "observability.event",
  auxiliaryUsage: "observability.auxiliaryUsage",
} as const;
export const MonitorModeSchema = z.enum(["DISABLED", "FEEDBACK_ONLY", "FULL_LOCAL"]);
export type MonitorMode = z.infer<typeof MonitorModeSchema>;
export const MonitorStateParamsSchema = z.strictObject({});
export const MonitorStateResultSchema = z.strictObject({
  mode: MonitorModeSchema, enabled: z.boolean(), detail: z.enum(["none", "lifecycle", "safe-local"]),
});
export type MonitorStateResult = z.infer<typeof MonitorStateResultSchema>;
export const RunMonitorCursorSchema = z.strictObject({ queuedAt: Timestamp, key: Id });
export type RunMonitorCursor = z.infer<typeof RunMonitorCursorSchema>;

export const RunMonitorListParamsSchema = z.strictObject({
  characterId: Id,
  initiators: z.array(RunInitiatorSchema).max(8).optional(),
  states: z.array(RunStateSchema).max(16).optional(),
  outcomes: z.array(RunOutcomeSchema).max(8).optional(),
  deliveryClasses: z.array(DeliveryClassSchema).max(3).optional(),
  categories: z.array(RunEventCategorySchema).max(8).optional(),
  kinds: z.array(RunEventKindSchema).max(32).optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  modelId: Id.optional(),
  toolName: Id.optional(),
  errorCode: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/).optional(),
  hasRetry: z.boolean().optional(),
  hasFailure: z.boolean().optional(),
  taskId: Id.optional(),
  parentRunId: Id.optional(),
  from: Timestamp.optional(),
  to: Timestamp.optional(),
  text: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(25),
  cursor: RunMonitorCursorSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "from must not be later than to" });
  }
});
export type RunMonitorListParams = z.infer<typeof RunMonitorListParamsSchema>;

const UsageSchema = z.strictObject({
  inputTokens: Count.optional(), inputTokenDetails: InputTokenDetailsSchema.optional(),
  outputTokens: Count.optional(), outputTokenDetails: OutputTokenDetailsSchema.optional(),
  totalTokens: Count.optional(), quality: UsageQualitySchema.optional(),
});
export const RunMonitorSummarySchema = z.strictObject({
  key: Id,
  characterId: Id,
  title: Label,
  initiator: RunInitiatorSchema,
  initiatorLabel: Label,
  triggerLabel: Label,
  deliveryClass: DeliveryClassSchema,
  deliveryLabel: Label,
  state: RunStateSchema,
  outcome: RunOutcomeSchema.optional(),
  queuedAt: Timestamp,
  startedAt: Timestamp.optional(),
  terminalAt: Timestamp.optional(),
  durationMs: Count.optional(),
  attemptCount: Count,
  effectCount: Count,
  modelRequestCount: Count,
  toolCallCount: Count,
  toolResultCount: Count,
  toolSuccessCount: Count,
  toolFailureCount: Count,
  failureCount: Count,
  retryCount: Count,
  usage: UsageSchema,
  provider: z.string().max(100).optional(),
  modelId: z.string().max(200).optional(),
  lineageLabel: Label.optional(),
  summary: Summary.optional(),
});
export type RunMonitorSummary = z.infer<typeof RunMonitorSummarySchema>;
export const RunMonitorListResultSchema = z.strictObject({
  runs: z.array(RunMonitorSummarySchema).max(50), nextCursor: RunMonitorCursorSchema.optional(),
});
export type RunMonitorListResult = z.infer<typeof RunMonitorListResultSchema>;

const TrajectoryBaseSchema = z.strictObject({
  rowKey: Id,
  seq: Sequence.refine((value) => value > 0),
  groupKey: Id.optional(),
  // Correlation is machine-only. In particular, callId identifies a generation, not one model request.
  eventKind: RunEventKindSchema.optional(),
  effectId: Id.optional(),
  callId: Id.optional(),
  toolCallId: Id.optional(),
  modelEffectId: Id.optional(),
  invocationId: Id.optional(),
  label: Label,
  contextLabel: Label.optional(),
  phase: z.enum([
    "trigger", "run", "attempt", "effect", "model", "tool", "context", "governance", "usage",
    "recovery", "delivery", "system",
  ]),
  category: RunEventCategorySchema,
  categoryLabel: Label,
  status: Label,
  outcome: Label.optional(),
  occurredAt: Timestamp,
  startedAt: Timestamp.optional(),
  durationMs: Count.optional(),
  surface: RunEventSurfaceSchema,
  surfaceLabel: Label,
  summary: Summary.optional(),
  errorReason: Summary.optional(),
});
const AttemptOrdinal = z.number().int().positive().max(10_000);
export const TrajectoryRowSchema = z.discriminatedUnion("kind", [
  TrajectoryBaseSchema.extend({ kind: z.literal("lifecycle"), attemptOrdinal: AttemptOrdinal.optional() }),
  TrajectoryBaseSchema.extend({ kind: z.literal("attempt"), attemptOrdinal: AttemptOrdinal }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("effect"), effectKind: z.enum(["model", "tool", "host", "mcp", "approval", "memory"]),
  }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("model"), provider: Id.optional(), modelId: Id.optional(),
    finishReason: Label.optional(), timeToFirstOutputMs: Count.optional(),
    outputKind: z.enum(["text", "reasoning", "tool"]).optional(),
  }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("tool"), toolName: Id, displayName: DisplayName.optional(), errorClass: Label.optional(),
  }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("context"), sourceCategories: z.array(Label).max(32), accountingQuality: Label,
  }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("governance"), decision: Label.optional(), approvalState: Label.optional(),
  }),
  TrajectoryBaseSchema.extend({
    kind: z.literal("usage"), inputTokens: Count.optional(), inputTokenDetails: InputTokenDetailsSchema.optional(),
    outputTokens: Count.optional(), outputTokenDetails: OutputTokenDetailsSchema.optional(),
    totalTokens: Count.optional(), quality: Label,
  }),
  TrajectoryBaseSchema.extend({ kind: z.literal("recovery"), classification: Label }),
]);
export type TrajectoryRow = z.infer<typeof TrajectoryRowSchema>;

export const TrajectoryParamsSchema = z.strictObject({
  characterId: Id,
  runKey: Id,
  afterSeq: Sequence.default(0),
  beforeSeq: Sequence.refine((value) => value > 0).optional(),
  tail: z.literal(true).optional(),
  limit: z.number().int().min(1).max(200).default(100),
}).superRefine((value, ctx) => {
  if ((value.tail && value.beforeSeq !== undefined)
    || ((value.tail || value.beforeSeq !== undefined) && value.afterSeq !== 0)) {
    ctx.addIssue({ code: "custom", message: "tail, beforeSeq, and nonzero afterSeq are mutually exclusive" });
  }
});
export type TrajectoryParams = z.infer<typeof TrajectoryParamsSchema>;
const TrajectoryCursorSchema = z.strictObject({ runKey: Id, seq: Sequence });
export const TrajectoryResultSchema = z.strictObject({
  run: RunMonitorSummarySchema,
  rows: z.array(TrajectoryRowSchema).max(200),
  cursor: TrajectoryCursorSchema,
  hasMore: z.boolean(),
  hasOlder: z.boolean().optional(),
  olderCursor: TrajectoryCursorSchema.optional(),
});
export type TrajectoryResult = z.infer<typeof TrajectoryResultSchema>;
export const TrajectoryInspectParamsSchema = z.strictObject({ characterId: Id, runKey: Id, rowKey: Id });
export type TrajectoryInspectParams = z.infer<typeof TrajectoryInspectParamsSchema>;
const InspectorFieldSchema = z.strictObject({ label: Label, value: z.string().max(1_000) });
const InspectorSectionSchema = z.strictObject({
  key: z.enum(["event", "model", "tool", "usage", "context", "governance", "recovery"]),
  fields: z.array(InspectorFieldSchema).min(1).max(24),
});
export const TrajectoryInspectorSchema = z.strictObject({
  mode: MonitorModeSchema,
  title: Label,
  detail: z.array(InspectorFieldSchema).max(24),
  sections: z.array(InspectorSectionSchema).max(7).optional(),
  technical: z.array(InspectorFieldSchema).max(16),
  technicalCollapsed: z.literal(true),
  redactionNotice: Summary,
});
export type TrajectoryInspector = z.infer<typeof TrajectoryInspectorSchema>;

export const RunMonitorSubscribeParamsSchema = z.strictObject({
  characterId: Id, runKey: Id, afterSeq: Sequence.default(0),
});
export type RunMonitorSubscribeParams = z.infer<typeof RunMonitorSubscribeParamsSchema>;
export const RunMonitorSubscribeResultSchema = z.strictObject({
  status: z.literal("ok"), cursor: Sequence,
});
export const RunMonitorUnsubscribeParamsSchema = z.strictObject({});
export const RunMonitorUnsubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export const RunMonitorEventSchema = z.strictObject({
  runKey: Id,
  cursor: Sequence,
  row: TrajectoryRowSchema.optional(),
  invalidated: z.boolean().default(false),
  reason: z.enum(["overflow", "projection-failed", "mode-disabled"]).optional(),
});
export type RunMonitorEvent = z.infer<typeof RunMonitorEventSchema>;
