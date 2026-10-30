/**
 * INPUT: provider-neutral trigger and execution lifecycle data
 * OUTPUT: strict Shared Harness schemas for admission, Run/Attempt state, immutable snapshots, receipts, and status
 * POS:    shared/protocol — additive contracts consumed by Core and future trigger adapters
 */
import { z } from "zod";
import { ExtensionCallModeSchema, ExtensionKindSchema } from "./extension-discovery-schema.ts";
import { MemoryProviderCapabilitiesSchema } from "./memory-provider-domain-schema.ts";
import { InitiativeContextManifestSchema } from "./initiative-schema.ts";

const Id = z.string().min(1).max(200);
const Timestamp = z.string().datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedText = z.string().max(1000);

export const RUN_METHODS = { status: "run.status", queue: "run.queue" } as const;

export const RunInitiatorSchema = z.enum(["primary", "scheduled", "heartbeat", "flush", "subagent", "webhook"]);
export type RunInitiator = z.infer<typeof RunInitiatorSchema>;
export const RunProvenanceSchema = z.object({
  provider: z.string().min(1).max(80),
  triggerRequestId: Id.optional(),
  taskId: Id.optional(),
  parentRunId: Id.optional(),
  sourceRef: Id.optional(),
}).strict();
export type RunProvenance = z.infer<typeof RunProvenanceSchema>;
export const DeliveryClassSchema = z.enum(["class_a", "class_b", "internal"]);
export type DeliveryClass = z.infer<typeof DeliveryClassSchema>;
export const ContextModeSchema = z.enum(["primary", "autonomous", "maintenance"]);
export type ContextMode = z.infer<typeof ContextModeSchema>;
export const RunStateSchema = z.enum(["queued", "running", "waiting", "recovering", "cancel_requested", "completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]);
export type RunState = z.infer<typeof RunStateSchema>;
export const AttemptStateSchema = z.enum(["prepared", "intent_committed", "effect_running", "settling", "completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"]);
export type AttemptState = z.infer<typeof AttemptStateSchema>;
export const RunOutcomeSchema = z.enum(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;
export const RetryabilitySchema = z.enum(["retryable", "not_retryable", "unknown"]);
export type Retryability = z.infer<typeof RetryabilitySchema>;
export const RunOperationPhaseSchema = z.enum(["admitted", "executing", "waiting", "recovering", "cancelling", "terminal"]);
export type RunOperationPhase = z.infer<typeof RunOperationPhaseSchema>;

export const TriggerRequestSchema = z.object({
  triggerRequestId: Id,
  idempotencyKey: Id,
  characterId: Id,
  initiator: RunInitiatorSchema,
  provenance: RunProvenanceSchema,
  deliveryClass: DeliveryClassSchema,
  contextMode: ContextModeSchema,
  deadlineAt: Timestamp.optional(),
  budgetHint: z.number().int().nonnegative().max(10_000_000).optional(),
  payloadRef: Id.optional(),
}).strict();
export type TriggerRequest = z.infer<typeof TriggerRequestSchema>;

export const SnapshotReferenceSchema = z.object({
  snapshotId: Id,
  manifestDigest: Digest,
  schemaVersion: z.string().min(1).max(32),
}).strict();
export type SnapshotReference = z.infer<typeof SnapshotReferenceSchema>;

export const RunHostReferenceSchema = z.object({
  hostId: Id,
  available: z.boolean(),
  connectionGeneration: z.number().int().positive(),
  catalogGeneration: z.number().int().positive(),
}).strict();
export type RunHostReference = z.infer<typeof RunHostReferenceSchema>;

export const RunExtensionReferenceSchema = z.object({
  extensionId: Id,
  kind: ExtensionKindSchema,
  ownerHostId: Id,
  subjectId: Id,
  subjectRevision: Id,
  connectionGeneration: z.number().int().positive(),
  catalogGeneration: z.number().int().positive(),
  callMode: ExtensionCallModeSchema,
  available: z.boolean(),
}).strict();
export type RunExtensionReference = z.infer<typeof RunExtensionReferenceSchema>;

export const RunGovernanceReferenceSchema = z.object({
  policyGeneration: z.number().int().positive(),
  registryRevision: z.number().int().positive(),
  approvalGeneration: z.number().int().positive(),
}).strict();
export type RunGovernanceReference = z.infer<typeof RunGovernanceReferenceSchema>;

export const RunMemoryReferenceSchema = z.object({
  providerId: Id,
  providerLineageId: Id.optional(),
  authorityEpochId: Id.optional(),
  contractVersion: z.number().int().positive(),
  capabilities: MemoryProviderCapabilitiesSchema,
  capabilityDigest: Digest,
}).strict();
export type RunMemoryReference = z.infer<typeof RunMemoryReferenceSchema>;

export const RunContextDecisionSchema = z.object({
  sourceCategories: z.array(z.string().min(1).max(64)).max(32),
  tokenAccounting: z.enum(["unknown", "estimated", "provider_reported"]),
}).strict();
export type RunContextDecision = z.infer<typeof RunContextDecisionSchema>;

export const RunReplayDecisionSchema = z.object({
  status: z.enum(["not_captured", "captured"]),
  windowStart: z.number().int().nonnegative().optional(),
  summaryRevision: Id.optional(),
}).strict();
export type RunReplayDecision = z.infer<typeof RunReplayDecisionSchema>;

export const RunBudgetReferenceSchema = z.object({
  deadlineAt: Timestamp.optional(),
  budgetHint: z.number().int().nonnegative().max(10_000_000).optional(),
}).strict();
export type RunBudgetReference = z.infer<typeof RunBudgetReferenceSchema>;

export const RunImplementationReferenceSchema = z.object({
  runtimeVersion: Id,
  schemaVersion: Id,
}).strict();
export type RunImplementationReference = z.infer<typeof RunImplementationReferenceSchema>;

export const RunSnapshotSchema = z.object({
  snapshotId: Id,
  runId: Id,
  capturedAt: Timestamp,
  schemaVersion: z.string().min(1).max(32),
  characterId: Id,
  initiator: RunInitiatorSchema,
  provenance: RunProvenanceSchema,
  deliveryClass: DeliveryClassSchema,
  contextMode: ContextModeSchema,
  modelProvider: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  primaryHostId: Id,
  hosts: z.array(RunHostReferenceSchema).max(64),
  extensions: z.array(RunExtensionReferenceSchema).max(512),
  extensionSnapshotDigest: Digest,
  governance: RunGovernanceReferenceSchema,
  memory: RunMemoryReferenceSchema,
  contextDecision: RunContextDecisionSchema,
  initiativeContext: InitiativeContextManifestSchema.optional(),
  replayDecision: RunReplayDecisionSchema,
  budget: RunBudgetReferenceSchema,
  implementation: RunImplementationReferenceSchema,
  sourceRefs: z.array(Digest).max(32),
  manifestDigest: Digest,
}).strict();
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const AttemptSchema = z.object({
  attemptId: Id,
  runId: Id,
  ordinal: z.number().int().positive().max(10_000),
  state: AttemptStateSchema,
  stateVersion: z.number().int().nonnegative(),
  provider: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  snapshot: SnapshotReferenceSchema,
  retryReason: BoundedText.optional(),
  startedAt: Timestamp.optional(),
  deadlineAt: Timestamp.optional(),
  settledAt: Timestamp.optional(),
  outcome: RunOutcomeSchema.optional(),
  retryability: RetryabilitySchema.optional(),
  resultSummary: BoundedText.optional(),
  errorCode: z.string().min(1).max(100).optional(),
}).strict();
export type Attempt = z.infer<typeof AttemptSchema>;

export const RunReceiptSchema = z.object({
  receiptId: Id,
  runId: Id,
  state: RunOutcomeSchema,
  outcome: RunOutcomeSchema.optional(),
  retryability: RetryabilitySchema.optional(),
  reason: BoundedText.optional(),
  action: BoundedText.optional(),
  attemptCount: z.number().int().nonnegative().max(10_000),
  snapshot: SnapshotReferenceSchema,
  summary: BoundedText.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).strict();
export type RunReceipt = z.infer<typeof RunReceiptSchema>;

export const RunSchema = z.object({
  runId: Id,
  characterId: Id,
  triggerRequestId: Id,
  idempotencyKey: Id,
  initiator: RunInitiatorSchema,
  provenance: RunProvenanceSchema,
  taskId: Id.optional(),
  parentRunId: Id.optional(),
  deliveryClass: DeliveryClassSchema,
  state: RunStateSchema,
  stateVersion: z.number().int().nonnegative(),
  operationPhase: RunOperationPhaseSchema,
  snapshot: SnapshotReferenceSchema,
  activeAttemptId: Id.optional(),
  queuedAt: Timestamp,
  budgetLimit: z.number().int().nonnegative().max(10_000_000).optional(),
  budgetUsed: z.number().int().nonnegative().max(10_000_000).default(0),
  startedAt: Timestamp.optional(),
  deadlineAt: Timestamp.optional(),
  terminalAt: Timestamp.optional(),
  outcome: RunOutcomeSchema.optional(),
  retryability: RetryabilitySchema.optional(),
  receiptId: Id.optional(),
}).strict().superRefine((run, ctx) => {
  const expected = run.state === "queued" ? "admitted"
    : run.state === "running" ? "executing"
      : run.state === "waiting" ? "waiting"
        : run.state === "recovering" ? "recovering"
          : run.state === "cancel_requested" ? "cancelling" : "terminal";
  if (run.operationPhase !== expected) {
    ctx.addIssue({ code: "custom", path: ["operationPhase"], message: `operation phase must be ${expected}` });
  }
});
export type Run = z.infer<typeof RunSchema>;

export const RunStatusParamsSchema = z.object({ runId: Id }).strict();
export type RunStatusParams = z.infer<typeof RunStatusParamsSchema>;
export const RunStatusResultSchema = z.object({
  run: RunSchema,
  attempts: z.array(AttemptSchema).max(10_000),
  receipt: RunReceiptSchema.optional(),
}).strict();
export type RunStatusResult = z.infer<typeof RunStatusResultSchema>;

export const QueueStateSchema = z.enum(["queued", "running", "waiting", "recovering", "cancel_requested"]);
export type QueueState = z.infer<typeof QueueStateSchema>;
export const QueueListParamsSchema = z.object({
  characterId: Id.optional(), state: QueueStateSchema.optional(), limit: z.number().int().min(1).max(100).default(50),
  cursor: Id.optional(),
}).strict();
export type QueueListParams = z.infer<typeof QueueListParamsSchema>;
export const QueueEntrySchema = z.object({
  runId: Id, characterId: Id, state: QueueStateSchema, queuedAt: Timestamp, deadlineAt: Timestamp.optional(),
  initiator: RunInitiatorSchema, attemptId: Id.optional(), ageMs: z.number().int().nonnegative().max(86_400_000_000),
  provenance: RunProvenanceSchema,
}).strict();
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
export const QueueListResultSchema = z.object({ entries: z.array(QueueEntrySchema).max(100), nextCursor: Id.optional() }).strict();
export type QueueListResult = z.infer<typeof QueueListResultSchema>;

export const RecoveryClassificationSchema = z.enum([
  "resumable_preparation", "waiting_for_authority", "safe_replay", "reconciliation_required",
  "outcome_unknown", "cancelled", "deadline_exceeded", "budget_exceeded", "failed", "completed",
]);
export type RecoveryClassification = z.infer<typeof RecoveryClassificationSchema>;
export const RecoveryReportSchema = z.object({
  processGeneration: Id, scanned: z.number().int().nonnegative().max(10_000),
  classified: z.number().int().nonnegative().max(10_000), terminal: z.number().int().nonnegative().max(10_000),
}).strict();
export type RecoveryReport = z.infer<typeof RecoveryReportSchema>;
