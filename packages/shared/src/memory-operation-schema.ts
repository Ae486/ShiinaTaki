/**
 * INPUT:  operator requests for durable memory operations and the Core-owned operation rows they produce
 * OUTPUT: MEMORY_OPERATION_METHODS plus strict operation identity/state/request/result and method schemas
 * POS:    shared/protocol — operator-only operation channel; Core mints identity, the client never fabricates state
 */
import { z } from "zod";
import { HindsightSetupErrorSchema } from "./hindsight-connection-schema.ts";
import { HindsightManagedDeploymentReceiptSchema, HindsightSetupPhaseSchema } from "./hindsight-setup-schema.ts";
import { MemoryReplicaErrorCodeSchema, MemoryReplicaRunKindSchema } from "./memory-replica-schedule-schema.ts";
import { MemoryTidyOutcomeSchema, MemoryTidyProgressSchema } from "./memory-tidy-outcome-schema.ts";

export const MEMORY_OPERATION_METHODS = {
  submit: "memory.operations.submit",
  status: "memory.operations.status",
  list: "memory.operations.list",
  cancel: "memory.operations.cancel",
  subscribe: "memory.operations.subscribe",
  changed: "memory.operations.changed",
} as const;

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const revision = z.number().int().nonnegative();

export const MemoryOperationKindSchema = z.enum(["setup.validate", "setup.apply", "replica.sync", "tidy", "index.rebuild"]);
export type MemoryOperationKind = z.infer<typeof MemoryOperationKindSchema>;
export const MemoryOperationStateSchema = z.enum(["admitted", "running", "completed", "failed", "cancelled", "outcome_unknown"]);
export type MemoryOperationState = z.infer<typeof MemoryOperationStateSchema>;
export const MEMORY_OPERATION_TERMINAL_STATES: readonly MemoryOperationState[] = ["completed", "failed", "cancelled", "outcome_unknown"];
export const MemoryOperationReasonSchema = z.enum([
  "core_restart", "producer_refused", "producer_failed", "cancelled_before_claim", "runtime_unavailable",
]);
export type MemoryOperationReason = z.infer<typeof MemoryOperationReasonSchema>;
export const MemoryOperationRefusalReasonSchema = z.enum([
  "MEMORY_OPERATION_NOT_FOUND", "MEMORY_OPERATION_BUSY", "MEMORY_OPERATION_RUNNING", "MEMORY_OPERATION_SETTLED",
  "MEMORY_OPERATION_UNSUPPORTED", "MEMORY_OPERATION_BANK_UNKNOWN",
]);
export type MemoryOperationRefusalReason = z.infer<typeof MemoryOperationRefusalReasonSchema>;

export const MemoryOperationRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup.validate"), expectedRevision: revision }),
  z.strictObject({
    kind: z.literal("setup.apply"), expectedRevision: revision, characterId: z.string().min(1).max(160),
    managedReceipt: HindsightManagedDeploymentReceiptSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("replica.sync"), bankId: Id, syncKind: MemoryReplicaRunKindSchema }),
  z.strictObject({ kind: z.literal("tidy"), characterId: z.string().min(1).max(160) }),
  z.strictObject({ kind: z.literal("index.rebuild"), stoplist: z.boolean() }),
]);
export type MemoryOperationRequest = z.infer<typeof MemoryOperationRequestSchema>;

export const MemoryOperationProducerRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup"), attemptId: Id.nullable(), revisionBefore: revision, revisionAfter: revision.nullable() }),
  z.strictObject({ kind: z.literal("replica"), bankId: Id, admittedAt: Timestamp }),
  z.strictObject({ kind: z.literal("tidy"), characterId: z.string().min(1).max(160),
    authorityEpochId: Id.nullable(), progress: MemoryTidyProgressSchema }),
  z.strictObject({ kind: z.literal("index"), stoplist: z.boolean(), authorityEpochId: Id.nullable() }),
]);
export type MemoryOperationProducerRef = z.infer<typeof MemoryOperationProducerRefSchema>;

export const MemoryReplicaNextActionSchema = z.enum(["automatic_retry_scheduled", "explicit_retry_required"]);
export const MemoryOperationResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup"), phase: HindsightSetupPhaseSchema, revision, latestError: HindsightSetupErrorSchema.nullable() }),
  z.strictObject({
    kind: z.literal("replica"), errorCode: MemoryReplicaErrorCodeSchema.nullable(),
    nextAction: MemoryReplicaNextActionSchema.nullable(), lastSuccessAt: Timestamp.nullable(),
  }),
  z.strictObject({ kind: z.literal("tidy"), outcome: MemoryTidyOutcomeSchema }),
  z.strictObject({ kind: z.literal("index"), indexed: z.int().nonnegative() }),
]);
export type MemoryOperationResult = z.infer<typeof MemoryOperationResultSchema>;

const MemoryOperationBase = z.strictObject({
  operationId: z.uuid(),
  kind: MemoryOperationKindSchema,
  state: MemoryOperationStateSchema,
  reason: MemoryOperationReasonSchema.nullable(),
  authorityEpochId: Id.nullable(),
  request: MemoryOperationRequestSchema,
  producer: MemoryOperationProducerRefSchema.nullable(),
  result: MemoryOperationResultSchema.nullable(),
  // Only closed producer codes cross this boundary; free-form exception text never does.
  errorCode: MemoryReplicaErrorCodeSchema.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  terminalAt: Timestamp.nullable(),
});
export const MemoryOperationSchema = MemoryOperationBase.superRefine((operation, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const terminal = MEMORY_OPERATION_TERMINAL_STATES.includes(operation.state);
  if (terminal !== (operation.terminalAt !== null)) fail("terminal state and terminalAt disagree");
  if (!terminal && operation.result !== null) fail("a non-terminal operation has no result");
  if ((operation.state === "outcome_unknown" || operation.state === "cancelled") && operation.reason === null) fail("unknown/cancelled outcomes require a reason");
  if (operation.state === "completed" && (operation.reason !== null || operation.errorCode !== null)) fail("a completed operation carries no failure diagnostics");
  if (operation.kind !== operation.request.kind) fail("operation kind and request disagree");
});
export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

export const MemoryOperationSubmitParamsSchema = z.strictObject({ request: MemoryOperationRequestSchema });
export const MemoryOperationSubmitResultSchema = z.strictObject({ operation: MemoryOperationSchema });
export const MemoryOperationStatusParamsSchema = z.strictObject({ operationId: z.uuid() });
export const MemoryOperationStatusResultSchema = z.strictObject({ operation: MemoryOperationSchema });
export const MemoryOperationListParamsSchema = z.strictObject({
  includeTerminal: z.boolean().default(false),
  limit: z.int().min(1).max(50).default(20),
  kind: MemoryOperationKindSchema.optional(),
  characterId: z.string().min(1).max(160).optional(),
});
export const MemoryOperationListResultSchema = z.strictObject({ operations: z.array(MemoryOperationSchema).max(50) });
export const MemoryOperationCancelParamsSchema = z.strictObject({ operationId: z.uuid() });
export const MemoryOperationCancelResultSchema = z.strictObject({ operation: MemoryOperationSchema });
export const MemoryOperationSubscribeParamsSchema = z.strictObject({});
export const MemoryOperationSubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export const MemoryOperationChangedSchema = z.strictObject({ operation: MemoryOperationSchema });

export type MemoryOperationSubmitParams = z.infer<typeof MemoryOperationSubmitParamsSchema>;
export type MemoryOperationSubmitResult = z.infer<typeof MemoryOperationSubmitResultSchema>;
export type MemoryOperationStatusParams = z.infer<typeof MemoryOperationStatusParamsSchema>;
export type MemoryOperationStatusResult = z.infer<typeof MemoryOperationStatusResultSchema>;
export type MemoryOperationListParams = z.infer<typeof MemoryOperationListParamsSchema>;
export type MemoryOperationListResult = z.infer<typeof MemoryOperationListResultSchema>;
export type MemoryOperationCancelParams = z.infer<typeof MemoryOperationCancelParamsSchema>;
export type MemoryOperationCancelResult = z.infer<typeof MemoryOperationCancelResultSchema>;
export type MemoryOperationSubscribeResult = z.infer<typeof MemoryOperationSubscribeResultSchema>;
export type MemoryOperationChanged = z.infer<typeof MemoryOperationChangedSchema>;
