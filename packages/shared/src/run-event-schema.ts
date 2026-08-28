/**
 * INPUT:  bounded Core Run, Effect, model, tool, context, governance, and recovery facts
 * OUTPUT: strict versioned Run Event schemas for durable replay and read-only projections
 * POS:    shared/protocol — canonical observability vocabulary; protected raw payloads are unrepresentable
 */
import { z } from "zod";
import {
  EffectSourceRefSchema,
  InputTokenDetailsSchema,
  OutputTokenDetailsSchema,
  UsageQualitySchema,
} from "./effect-lifecycle-schema.ts";

const ID = z.string().trim().min(1).max(200);
const BOUNDED = z.string().max(1_000);
const SAFE_BOUNDED = BOUNDED.refine(
  (value) => !/(<\/?prompt|authorization\s*[:=]|bearer\s+[a-z0-9._-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|token\s*[:=]|raw[_ -]?(prompt|completion|tool|host|mcp|sensor|payload))/i.test(value),
  "canonical event text contains forbidden raw content",
);
const ERROR_CODE = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/, "invalid bounded error code");
const SHA = z.string().regex(/^[a-f0-9]{64}$/);
const COUNT = z.number().int().nonnegative().max(1_000_000_000);
const DURATION = z.number().int().nonnegative().max(86_400_000);
const TIMESTAMP = z.string().datetime({ offset: true });
const EFFECT_OUTCOME = z.enum([
  "completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown", "reconciliation_required",
]);
const TOOL_OUTCOME = z.enum(["completed", "failed", "cancelled", "outcome_unknown"]);
const FINISH_REASON = z.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"]);

export const RUN_EVENT_SCHEMA_VERSION = "run-event.v1" as const;
export const RunEventCategorySchema = z.enum([
  "lifecycle", "effect", "usage", "model", "tool", "context", "governance", "recovery",
]);
export const RunEventKindSchema = z.enum([
  "run.admitted", "attempt.prepared", "run.started", "attempt.started", "attempt.settled",
  "run.cancel_requested", "run.deadline_exceeded", "run.budget_exceeded", "run.settled",
  "recovery.classified", "effect.intent_committed", "effect.waiting", "effect.settled", "usage.settled",
  "model.request.started", "model.stream.first", "model.response.settled",
  "tool.call.started", "tool.result.settled", "context.snapshot", "governance.evaluated",
  "approval.requested", "approval.decided", "run.retry",
]);
export const RunEventSourceSchema = z.enum([
  "core.run-repo", "core.recovery-repo", "core.effect-lifecycle", "core.model-observer",
  "core.tool-observer", "core.context-observer", "core.governance-policy", "core.approval-authority",
]);

const CorrelationSchema = z.strictObject({
  triggerRequestId: ID.optional(), taskId: ID.optional(), parentRunId: ID.optional(),
});
const RunAdmittedPayloadSchema = z.strictObject({
  kind: z.literal("run.admitted"), state: z.literal("queued"), initiator: ID,
  deliveryClass: ID, attemptOrdinal: z.literal(1),
});
const AttemptPreparedPayloadSchema = z.strictObject({
  kind: z.literal("attempt.prepared"), state: z.literal("prepared"),
  attemptOrdinal: z.number().int().min(1).max(10_000),
});
const RunStartedPayloadSchema = z.strictObject({
  kind: z.literal("run.started"), state: z.literal("running"), operationPhase: z.literal("executing"),
});
const AttemptStartedPayloadSchema = z.strictObject({
  kind: z.literal("attempt.started"), state: z.literal("effect_running"),
  attemptOrdinal: z.number().int().min(1).max(10_000),
});
const AttemptSettledPayloadSchema = z.strictObject({
  kind: z.literal("attempt.settled"),
  state: z.enum(["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"]),
  outcome: z.enum(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]),
  attemptOrdinal: z.number().int().min(1).max(10_000),
  retryability: z.enum(["retryable", "not_retryable", "unknown"]),
  summary: SAFE_BOUNDED.optional(), errorCode: ERROR_CODE.optional(),
});
const CancelRequestedPayloadSchema = z.strictObject({
  kind: z.literal("run.cancel_requested"), state: z.literal("cancel_requested"), reason: SAFE_BOUNDED,
});
const DeadlineExceededPayloadSchema = z.strictObject({
  kind: z.literal("run.deadline_exceeded"), state: z.literal("deadline_exceeded"), reason: SAFE_BOUNDED,
});
const BudgetExceededPayloadSchema = z.strictObject({
  kind: z.literal("run.budget_exceeded"), state: z.literal("failed"), reason: SAFE_BOUNDED,
  used: z.number().int().nonnegative().max(10_000_000),
  limit: z.number().int().nonnegative().max(10_000_000).optional(),
});
const RunSettledPayloadSchema = z.strictObject({
  kind: z.literal("run.settled"),
  state: z.enum(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]),
  outcome: z.enum(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]),
  retryability: z.enum(["retryable", "not_retryable", "unknown"]),
  summary: SAFE_BOUNDED.optional(), errorCode: ERROR_CODE.optional(),
});
const RecoveryClassifiedPayloadSchema = z.strictObject({
  kind: z.literal("recovery.classified"),
  state: z.enum(["recovering", "queued", "waiting", "cancel_requested", "completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"]),
  classification: z.enum(["resumable_preparation", "waiting_for_authority", "safe_replay", "reconciliation_required", "outcome_unknown", "cancelled", "deadline_exceeded", "budget_exceeded", "failed", "completed"]),
  reason: SAFE_BOUNDED.optional(), errorCode: ERROR_CODE.optional(),
});

const EffectPayloadBase = {
  effectId: ID,
  effectKind: z.enum(["model", "tool", "host", "mcp", "approval", "memory"]),
  sourceRef: EffectSourceRefSchema,
  capturedGenerationRef: ID.optional(),
  replayPosture: z.enum(["safe", "never"]),
  approvalId: ID.optional(),
  policyGeneration: z.number().int().positive().max(2_000_000_000).optional(),
  approvalGeneration: z.number().int().positive().max(2_000_000_000).optional(),
  bindingDigest: SHA.optional(),
  expiresAt: TIMESTAMP.optional(),
  summary: SAFE_BOUNDED.optional(),
  errorCode: ERROR_CODE.optional(),
} as const;
const EffectIntentPayloadSchema = z.strictObject({
  kind: z.literal("effect.intent_committed"), state: z.literal("intent_committed"), ...EffectPayloadBase,
});
const EffectWaitingPayloadSchema = z.strictObject({
  kind: z.literal("effect.waiting"), state: z.literal("waiting"), ...EffectPayloadBase,
});
const EffectSettledPayloadSchema = z.strictObject({
  kind: z.literal("effect.settled"), state: z.literal("terminal"), outcome: EFFECT_OUTCOME, ...EffectPayloadBase,
});
const UsageSettledPayloadSchema = z.strictObject({
  kind: z.literal("usage.settled"), state: z.literal("settled"), effectId: ID, usageId: ID,
  quality: UsageQualitySchema, inputTokens: COUNT.optional(), inputTokenDetails: InputTokenDetailsSchema.optional(),
  outputTokens: COUNT.optional(), outputTokenDetails: OutputTokenDetailsSchema.optional(), totalTokens: COUNT.optional(),
});
const ModelRequestStartedPayloadSchema = z.strictObject({
  kind: z.literal("model.request.started"), state: z.literal("running"), effectId: ID, callId: ID,
  provider: ID, modelId: ID, startedAt: TIMESTAMP,
});
const ModelStreamFirstPayloadSchema = z.strictObject({
  kind: z.literal("model.stream.first"), state: z.literal("streaming"), effectId: ID, callId: ID,
  firstOutputAt: TIMESTAMP, outputKind: z.enum(["text", "reasoning", "tool"]),
});
const ModelResponseSettledPayloadSchema = z.strictObject({
  kind: z.literal("model.response.settled"),
  state: z.enum(["completed", "failed", "cancelled", "outcome_unknown"]),
  effectId: ID, callId: ID, provider: ID, modelId: ID,
  outcome: z.enum(["completed", "failed", "cancelled", "outcome_unknown"]),
  finishReason: FINISH_REASON.optional(), responseId: ID.optional(),
  durationMs: DURATION.optional(), timeToFirstOutputMs: DURATION.optional(), errorCode: ERROR_CODE.optional(),
});
const ToolCallStartedPayloadSchema = z.strictObject({
  kind: z.literal("tool.call.started"), state: z.enum(["running", "validation_failed"]),
  effectId: ID.optional(), callId: ID.optional(), toolName: ID, toolCallId: ID,
  validationState: z.enum(["accepted", "failed"]),
});
const ToolResultSettledPayloadSchema = z.strictObject({
  kind: z.literal("tool.result.settled"), state: TOOL_OUTCOME,
  effectId: ID.optional(), callId: ID.optional(), toolName: ID, toolCallId: ID,
  outcome: TOOL_OUTCOME, durationMs: DURATION.optional(),
  errorClass: z.enum(["validation", "execution", "governance", "stale", "unknown"]).optional(),
  errorCode: ERROR_CODE.optional(), summary: SAFE_BOUNDED.optional(),
});
const ContextSnapshotPayloadSchema = z.strictObject({
  kind: z.literal("context.snapshot"), state: z.literal("captured"),
  sourceCategories: z.array(ID).max(32), accountingQuality: UsageQualitySchema,
  contextWindowTokens: COUNT.optional(), inputTokens: COUNT.optional(),
});
const GovernanceEvaluatedPayloadSchema = z.strictObject({
  kind: z.literal("governance.evaluated"), state: z.enum(["allowed", "denied", "approval_required"]),
  capabilityId: ID, toolCallId: ID.optional(), decision: z.enum(["allow", "deny", "ask"]),
  reasonCode: ERROR_CODE.optional(),
});
const ApprovalRequestedPayloadSchema = z.strictObject({
  kind: z.literal("approval.requested"), state: z.literal("pending"), approvalId: ID, capabilityId: ID,
});
const ApprovalDecidedPayloadSchema = z.strictObject({
  kind: z.literal("approval.decided"),
  state: z.enum(["approved", "denied", "expired", "cancelled", "operator_unavailable", "notification_failed", "operator_disconnected", "invalidated"]),
  approvalId: ID.optional(), capabilityId: ID,
  scope: z.enum(["once", "session", "always"]).optional(), reasonCode: ERROR_CODE.optional(),
});
const RetryPayloadSchema = z.strictObject({
  kind: z.literal("run.retry"), state: z.literal("retrying"),
  attemptOrdinal: z.number().int().positive().max(10_000),
  retryOrdinal: z.number().int().positive().max(10_000), reasonCode: ERROR_CODE,
});

export const RunEventPayloadSchema = z.discriminatedUnion("kind", [
  RunAdmittedPayloadSchema, AttemptPreparedPayloadSchema, RunStartedPayloadSchema, AttemptStartedPayloadSchema,
  AttemptSettledPayloadSchema, CancelRequestedPayloadSchema, DeadlineExceededPayloadSchema,
  BudgetExceededPayloadSchema, RunSettledPayloadSchema, RecoveryClassifiedPayloadSchema,
  EffectIntentPayloadSchema, EffectWaitingPayloadSchema, EffectSettledPayloadSchema, UsageSettledPayloadSchema,
  ModelRequestStartedPayloadSchema, ModelStreamFirstPayloadSchema, ModelResponseSettledPayloadSchema,
  ToolCallStartedPayloadSchema, ToolResultSettledPayloadSchema, ContextSnapshotPayloadSchema,
  GovernanceEvaluatedPayloadSchema, ApprovalRequestedPayloadSchema, ApprovalDecidedPayloadSchema, RetryPayloadSchema,
]);

const ATTEMPT_EVENT_KINDS = new Set([
  "attempt.prepared", "attempt.started", "attempt.settled", "effect.intent_committed", "effect.waiting",
  "effect.settled", "usage.settled", "model.request.started", "model.stream.first", "model.response.settled",
  "tool.call.started", "tool.result.settled", "context.snapshot", "governance.evaluated",
  "approval.requested", "approval.decided", "run.retry",
]);

export const RunEventSchema = z.strictObject({
  eventId: ID, runId: ID, attemptId: ID.optional(), seq: z.number().int().min(1).max(2_000_000_000),
  schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION), category: RunEventCategorySchema, kind: RunEventKindSchema,
  occurredAt: TIMESTAMP, source: RunEventSourceSchema, correlation: CorrelationSchema.optional(),
  payload: RunEventPayloadSchema,
}).superRefine((event, context) => {
  if (ATTEMPT_EVENT_KINDS.has(event.kind) && !event.attemptId) {
    context.addIssue({ code: "custom", path: ["attemptId"], message: "attempt-scoped events require attemptId" });
  }
  if (event.payload.kind !== event.kind) {
    context.addIssue({ code: "custom", path: ["payload", "kind"], message: "payload kind mismatch" });
  }
  const expected = expectedCategoryAndSource(event.kind);
  if (event.kind === "recovery.classified" && event.category === "lifecycle" && event.source === "core.run-repo") return;
  if (event.category !== expected.category || event.source !== expected.source) {
    context.addIssue({ code: "custom", path: ["category"], message: `${event.kind} requires ${expected.category}/${expected.source}` });
  }
});

function expectedCategoryAndSource(kind: z.infer<typeof RunEventKindSchema>): {
  category: z.infer<typeof RunEventCategorySchema>;
  source: z.infer<typeof RunEventSourceSchema>;
} {
  if (kind.startsWith("effect.")) return { category: "effect", source: "core.effect-lifecycle" };
  if (kind === "usage.settled") return { category: "usage", source: "core.effect-lifecycle" };
  if (kind.startsWith("model.")) return { category: "model", source: "core.model-observer" };
  if (kind.startsWith("tool.")) return { category: "tool", source: "core.tool-observer" };
  if (kind === "context.snapshot") return { category: "context", source: "core.context-observer" };
  if (kind === "governance.evaluated") return { category: "governance", source: "core.governance-policy" };
  if (kind.startsWith("approval.")) return { category: "governance", source: "core.approval-authority" };
  if (kind === "run.retry") return { category: "recovery", source: "core.run-repo" };
  if (kind === "recovery.classified") return { category: "recovery", source: "core.recovery-repo" };
  return { category: "lifecycle", source: "core.run-repo" };
}

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
export type RunEventKind = z.infer<typeof RunEventKindSchema>;
export type RunEventCategory = z.infer<typeof RunEventCategorySchema>;
export const RunEventCursorSchema = z.strictObject({
  runId: ID, seq: z.number().int().min(0).max(2_000_000_000),
});
export type RunEventCursor = z.infer<typeof RunEventCursorSchema>;
export const RunEventSurfaceSchema = z.enum(["current", "shadowed", "log-only"]);
export const RunEventSummarySchema = z.strictObject({
  label: z.string().max(100), phase: z.string().max(50), status: z.string().max(50),
  outcome: z.string().max(50).optional(), summary: SAFE_BOUNDED.optional(), surface: RunEventSurfaceSchema,
});
export type RunEventSummary = z.infer<typeof RunEventSummarySchema>;
export const RunEventInspectorSchema = z.strictObject({
  event: RunEventSchema,
  technical: z.strictObject({
    eventId: ID, schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION), source: RunEventSourceSchema,
    correlation: CorrelationSchema.optional(), payloadDigest: SHA.optional(),
  }),
});
export type RunEventInspector = z.infer<typeof RunEventInspectorSchema>;
