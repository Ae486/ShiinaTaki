/**
 * INPUT: final dispatched request estimates and canonical model Effect usage.
 * OUTPUT: bounded composition, dispatch windows and latest-primary requested/response model identities.
 * POS: shared/protocol — counts and machine identity only; never transcripts or billing authority.
 */
import { z } from "zod";
import { CharacterIdSchema } from "./character-schema.ts";

const Count = z.int().nonnegative().max(1_000_000_000);
const Id = z.string().trim().min(1).max(200);
const Timestamp = z.iso.datetime({ offset: true });
export const CONTEXT_CATEGORIES = ["instructions", "persona", "injected_memory", "runtime_context", "summary",
  "conversation", "tool_definitions", "tool_interactions", "other"] as const;
export const ContextCategorySchema = z.enum(CONTEXT_CATEGORIES);
export type ContextCategory = z.infer<typeof ContextCategorySchema>;
export const CONTEXT_CONTENT_ORIGINS = ["builtin", "mcp", "skill", "unknown"] as const;
export const ContextContentOriginSchema = z.enum(CONTEXT_CONTENT_ORIGINS);
export type ContextContentOrigin = z.infer<typeof ContextContentOriginSchema>;

export const ContextWindowSnapshotSchema = z.strictObject({
  declaredRealTokens: Count.positive(), effectiveRealTokens: Count.positive(),
  estimatorWindowUnits: Count.positive(), factor: z.number().finite().positive().max(1_000),
}).refine((value) => value.effectiveRealTokens <= value.declaredRealTokens,
  "effective window cannot exceed declared window");
export type ContextWindowSnapshot = z.infer<typeof ContextWindowSnapshotSchema>;

const OriginCounts = z.strictObject({ builtin: Count, mcp: Count, skill: Count, unknown: Count });
const Categories = z.strictObject({ instructions: Count, persona: Count, injected_memory: Count,
  runtime_context: Count, summary: Count, conversation: Count, tool_definitions: Count, tool_interactions: Count, other: Count });
const Origins = z.strictObject({ instructions: OriginCounts, persona: OriginCounts, injected_memory: OriginCounts,
  runtime_context: OriginCounts, summary: OriginCounts, conversation: OriginCounts, tool_definitions: OriginCounts,
  tool_interactions: OriginCounts, other: OriginCounts });
export const RequestCompositionSchema = z.strictObject({
  estimator: z.literal("heuristic-v1"), totalUnits: Count, categories: Categories, origins: Origins,
  coverage: z.strictObject({ status: z.enum(["complete", "partial"]), unestimatedParts: Count,
    unknownOriginUnits: Count, hasHeuristicMedia: z.boolean() }),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (CONTEXT_CATEGORIES.reduce((sum, category) => sum + value.categories[category], 0) !== value.totalUnits) {
    issue("category estimates must reconcile to total units");
  }
  for (const category of CONTEXT_CATEGORIES) {
    if (CONTEXT_CONTENT_ORIGINS.reduce((sum, origin) => sum + value.origins[category][origin], 0) !== value.categories[category]) {
      issue("origin estimates must reconcile within each category");
    }
  }
  const unknown = CONTEXT_CATEGORIES.reduce((sum, category) => sum + value.origins[category].unknown, 0);
  if (unknown !== value.coverage.unknownOriginUnits) issue("unknown-origin coverage must match the matrix");
  if (value.coverage.status === "complete" && (value.coverage.unestimatedParts > 0 || unknown > 0)) {
    issue("complete coverage cannot contain unknown attribution or unestimated content");
  }
});
export type RequestComposition = z.infer<typeof RequestCompositionSchema>;

export const ContextRequestMeasuredPayloadSchema = z.strictObject({
  kind: z.literal("context.request.measured"), state: z.literal("captured"), effectId: Id,
  provider: Id, modelId: Id, population: z.enum(["primary", "initiative", "worker", "other"]),
  primaryInputSeq: Count.positive().optional(), stepNumber: Count, dispatchedAt: Timestamp,
  window: ContextWindowSnapshotSchema.optional(), composition: RequestCompositionSchema,
}).refine((value) => value.population !== "primary" || value.primaryInputSeq !== undefined,
  "primary requests require their canonical input sequence");
export type ContextRequestMeasuredPayload = z.infer<typeof ContextRequestMeasuredPayloadSchema>;
export const CONTEXT_REQUEST_SCHEMA_VERSION = "context-request.v1" as const;
export const ContextRequestMeasuredEventSchema = z.strictObject({
  eventId: Id, runId: Id, attemptId: Id, seq: z.int().positive().max(2_000_000_000),
  schemaVersion: z.literal(CONTEXT_REQUEST_SCHEMA_VERSION), category: z.literal("context"),
  kind: z.literal("context.request.measured"), occurredAt: Timestamp, source: z.literal("core.context-observer"),
  payload: ContextRequestMeasuredPayloadSchema,
});
export type ContextRequestMeasuredEvent = z.infer<typeof ContextRequestMeasuredEventSchema>;

const Request = z.strictObject({
  runId: Id, effectId: Id, primaryInputSeq: Count.positive(), stepNumber: Count.nullable(),
  // The window belongs to requested modelId; usage retains the SDK response name or requested-model fallback.
  provider: Id, modelId: Id, responseModelId: Id.optional(), dispatchedAt: Timestamp, completedAt: Timestamp,
  outcome: z.enum(["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown", "reconciliation_required"]),
  inputTokens: Count.nullable(), window: ContextWindowSnapshotSchema.nullable(), composition: RequestCompositionSchema.nullable(),
});
export const LatestPrimaryRequestSnapshotSchema = z.strictObject({
  scope: z.literal("latest-primary-request"), characterId: CharacterIdSchema, computedAt: Timestamp,
  status: z.enum(["ready", "partial", "empty", "unavailable"]),
  reason: z.enum(["measurement-missing", "usage-missing", "data-inconsistent", "scan-exhausted", "read-failed", "monitor-disabled"]).nullable(),
  request: Request.nullable(),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (value.status === "empty" && (value.request !== null || value.reason !== null)) issue("empty has no request or reason");
  if (value.status === "unavailable" && (value.request !== null || value.reason === null)) issue("unavailable requires reason without a request");
  if ((value.status === "ready" || value.status === "partial") && value.request === null) issue("available requires a request");
  if (value.status === "ready" && (value.reason !== null || value.request?.inputTokens === null
      || value.request?.window === null || value.request?.composition?.coverage.status !== "complete")) {
    issue("ready requires reported usage, window and complete accounting coverage");
  }
});
export type LatestPrimaryRequestSnapshot = z.infer<typeof LatestPrimaryRequestSnapshotSchema>;
