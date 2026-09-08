/**
 * INPUT:  canonical write requests bound to one Hindsight authority epoch and Bank generation
 * OUTPUT: durable Pending Memory intents, native receipts, recovery phases, and unconfirmed projections
 * POS:    shared memory contract — independent of Run Effects and confirmed replica records
 */
import { z } from "zod";
import { MutationRequestSchema, RetainRequestSchema } from "./memory-provider-operation-schema.ts";
import { MemoryReplicaBankSchema, MemoryReplicaErrorCodeSchema } from "./memory-replica-schedule-schema.ts";
import { MemoryReplicaLeaseSchema } from "./memory-replica-schema.ts";
import {
  HindsightNativeResultStatusSchema, PendingMemoryDispatchSchema, PendingMemoryNativeResultReceiptSchema,
} from "./hindsight-native-result-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const Digest = z.string().regex(/^[0-9a-f]{64}$/);

export const PendingMemoryOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retain"), request: RetainRequestSchema, zeroResultAllowed: z.boolean() }),
  z.strictObject({ kind: z.literal("mutation"), request: MutationRequestSchema }),
]);
export type PendingMemoryOperation = z.infer<typeof PendingMemoryOperationSchema>;

export const PendingMemoryRefSchema = z.strictObject({ authorityEpochId: Id, bankId: Id, operationId: Id });
export type PendingMemoryRef = z.infer<typeof PendingMemoryRefSchema>;
export const PendingMemoryIntentSchema = z.strictObject({
  schemaVersion: z.literal(1), authorityEpochId: Id, providerId: z.literal("hindsight"),
  providerLineageId: z.uuid(), bankGeneration: z.uuid(), bank: MemoryReplicaBankSchema,
  operationId: Id, originalAt: Timestamp, baseCursor: z.int().min(0), operation: PendingMemoryOperationSchema,
}).refine((intent) => intent.operation.request.bankId === intent.bank.bankId, "pending request belongs to another Bank");
export type PendingMemoryIntent = z.infer<typeof PendingMemoryIntentSchema>;

export const PendingMemoryNativeReceiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("retain"), operationId: z.uuid(), documentId: Id,
    memories: z.array(z.strictObject({ memoryId: Id, revision: z.int().min(1) })).max(256),
    resultMetadataHash: Digest, completedAt: Timestamp,
  }).refine((value) => new Set(value.memories.map((memory) => memory.memoryId)).size === value.memories.length,
    "native retain receipt contains duplicate memories"),
  z.strictObject({
    kind: z.literal("mutation"), operationId: z.uuid(), memoryId: Id, revision: z.int().min(1),
    state: z.enum(["valid", "invalidated"]), outcome: z.enum(["applied", "unchanged"]),
    resultHash: Digest, completedAt: Timestamp,
  }),
]);
export type PendingMemoryNativeReceipt = z.infer<typeof PendingMemoryNativeReceiptSchema>;

// This is the consumer's required evidence, not an assertion that the admitted provider exposes a fence API.
export const MemoryDerivedCompletionEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1), evidenceId: Id, authorityEpochId: Id, bankId: Id,
  providerLineageId: z.uuid(), bankGeneration: z.uuid(), operationId: z.uuid(),
  nativeReceiptHash: Digest, throughCursor: z.int().min(0), completedAt: Timestamp,
});
export type MemoryDerivedCompletionEvidence = z.infer<typeof MemoryDerivedCompletionEvidenceSchema>;
export const MemoryDerivedCompletionRequestSchema = MemoryDerivedCompletionEvidenceSchema.omit({
  evidenceId: true, throughCursor: true, completedAt: true,
}).extend({ afterCursor: z.int().min(0), receipt: PendingMemoryNativeReceiptSchema })
  .refine((value) => value.receipt.operationId === value.operationId, "derived request receipt identity disagrees");
export type MemoryDerivedCompletionRequest = z.infer<typeof MemoryDerivedCompletionRequestSchema>;
export const MemoryDerivedCompletionResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({ status: z.literal("completed"), evidence: MemoryDerivedCompletionEvidenceSchema }),
]);
export type MemoryDerivedCompletionResult = z.infer<typeof MemoryDerivedCompletionResultSchema>;

export const PendingMemoryPhaseSchema = z.enum([
  "queued", "submitted", "awaiting_derived", "awaiting_pull", "completed", "superseded", "failed", "outcome_unknown", "cancelled",
]);
export type PendingMemoryPhase = z.infer<typeof PendingMemoryPhaseSchema>;
const PendingMemoryStateBase = z.strictObject({
  intent: PendingMemoryIntentSchema, intentHash: Digest, remoteOperationId: z.uuid(), documentId: Id.nullable(),
  preparedMutation: MutationRequestSchema.nullable(), preparedMutationHash: Digest.nullable(), phase: PendingMemoryPhaseSchema,
  version: z.int().min(1), attempts: z.int().min(0), lastAttemptAt: Timestamp.nullable(),
  nextRetryAt: Timestamp.nullable(), dispatchedAt: Timestamp.nullable(), acceptedAt: Timestamp.nullable(),
  nativeReceipt: PendingMemoryNativeReceiptSchema.nullable(), derivedEvidence: MemoryDerivedCompletionEvidenceSchema.nullable(),
  // Omission is the old-row contract, not a default promotion to tracked replay.
  dispatch: PendingMemoryDispatchSchema.optional(), nativeResultReceipt: PendingMemoryNativeResultReceiptSchema.nullable().optional(),
  nativeResultReceiptHash: Digest.nullable().optional(),
  nativeStatus: HindsightNativeResultStatusSchema.nullable().optional(),
  lease: MemoryReplicaLeaseSchema.nullable(), diagnosticCode: MemoryReplicaErrorCodeSchema.nullable(),
  currentRevision: z.int().min(1).nullable(), createdAt: Timestamp, updatedAt: Timestamp, terminalAt: Timestamp.nullable(),
});
export const PendingMemoryStateSchema = PendingMemoryStateBase.superRefine(validatePendingState);
export type PendingMemoryState = z.infer<typeof PendingMemoryStateSchema>;
export const PendingMemoryRecordSchema = PendingMemoryStateSchema.safeExtend({ sequence: z.int().min(1) });
export type PendingMemoryRecord = z.infer<typeof PendingMemoryRecordSchema>;

export const PendingMemorySummarySchema = z.strictObject({
  pendingCount: z.int().min(0), nativeConfirmedCount: z.int().min(0), completedCount: z.int().min(0),
  supersededCount: z.int().min(0), failedCount: z.int().min(0), unknownCount: z.int().min(0), cancelledCount: z.int().min(0),
});
export type PendingMemorySummary = z.infer<typeof PendingMemorySummarySchema>;

export const PendingMemoryOverlayEntrySchema = z.strictObject({
  confirmed: z.literal(false), authorityEpochId: Id, bankId: Id, operationId: Id, originalAt: Timestamp,
  phase: z.enum(["queued", "submitted", "awaiting_derived", "awaiting_pull", "outcome_unknown"]),
  operation: PendingMemoryOperationSchema,
}).refine((entry) => entry.operation.request.bankId === entry.bankId, "overlay belongs to another Bank");
export type PendingMemoryOverlayEntry = z.infer<typeof PendingMemoryOverlayEntrySchema>;

function validatePendingState(value: z.infer<typeof PendingMemoryStateBase>, context: z.RefinementCtx): void {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const terminal = ["completed", "superseded", "failed", "outcome_unknown", "cancelled"].includes(value.phase);
  if (terminal !== (value.terminalAt !== null) || (terminal && (value.lease !== null || value.nextRetryAt !== null))) fail("pending terminal state disagrees");
  if ((value.attempts === 0) !== (value.lastAttemptAt === null)) fail("pending attempt timestamps disagree");
  if (value.lease && value.lease.bankId !== value.intent.bank.bankId) fail("pending lease belongs to another Bank");
  if ((value.intent.operation.kind === "retain") !== (value.documentId !== null)) fail("pending document identity disagrees");
  if ((value.preparedMutation === null) !== (value.preparedMutationHash === null)) fail("prepared mutation integrity disagrees");
  if (value.preparedMutation && (value.intent.operation.kind !== "mutation"
    || value.preparedMutation.kind !== value.intent.operation.request.kind || value.preparedMutation.bankId !== value.intent.bank.bankId
    || value.preparedMutation.memoryId !== value.intent.operation.request.memoryId
    || value.preparedMutation.expectedRevision !== value.intent.operation.request.expectedRevision)) fail("prepared mutation target disagrees");
  if (value.phase === "queued" && (value.dispatchedAt !== null || value.nativeReceipt !== null)) fail("queued intent cannot have dispatched");
  if (value.phase === "submitted" && (value.dispatchedAt === null || value.nativeReceipt !== null)) fail("submitted intent cannot have a terminal native receipt");
  if (value.intent.operation.kind === "mutation" && value.dispatchedAt !== null && value.preparedMutation === null) fail("dispatched mutation requires its frozen replay payload");
  const nativeConfirmed = value.nativeReceipt !== null || !!value.nativeResultReceipt;
  if (["awaiting_derived", "awaiting_pull", "completed"].includes(value.phase) && !nativeConfirmed) fail("native completion evidence is required");
  if (["awaiting_pull", "completed"].includes(value.phase) && value.derivedEvidence === null && !value.nativeResultReceipt) fail("completion boundary evidence is required");
  if (value.nativeReceipt && (value.dispatchedAt === null || value.acceptedAt === null
    || value.nativeReceipt.operationId !== value.remoteOperationId || value.nativeReceipt.kind !== value.intent.operation.kind)) fail("native receipt identity disagrees");
  if (nativeConfirmed && ["failed", "superseded", "outcome_unknown", "cancelled"].includes(value.phase)) fail("known native success cannot be relabelled as an unapplied intent");
  if (value.acceptedAt !== null && value.dispatchedAt === null) fail("acceptance requires prior dispatch");
  if (value.nativeReceipt?.kind === "retain") {
    if (value.nativeReceipt.documentId !== value.documentId) fail("retain receipt document disagrees");
    if (value.nativeReceipt.memories.length === 0 && value.intent.operation.kind === "retain" && !value.intent.operation.zeroResultAllowed) fail("zero-result retain was not allowed");
  }
  if (value.nativeReceipt?.kind === "mutation" && value.intent.operation.kind === "mutation") {
    const request = value.intent.operation.request;
    if (value.nativeReceipt.memoryId !== request.memoryId) fail("mutation receipt target disagrees");
    const increment = value.nativeReceipt.outcome === "applied" ? 1 : 0;
    if (value.nativeReceipt.revision !== request.expectedRevision + increment) fail("mutation receipt revision disagrees");
    if ((request.kind === "invalidate" && value.nativeReceipt.state !== "invalidated")
      || (request.kind === "restore" && value.nativeReceipt.state !== "valid")) fail("mutation receipt lifecycle disagrees");
  }
  if (value.derivedEvidence && (value.nativeReceipt === null || value.derivedEvidence.operationId !== value.remoteOperationId
    || value.derivedEvidence.authorityEpochId !== value.intent.authorityEpochId || value.derivedEvidence.bankId !== value.intent.bank.bankId
    || value.derivedEvidence.providerLineageId !== value.intent.providerLineageId || value.derivedEvidence.bankGeneration !== value.intent.bankGeneration
    || value.derivedEvidence.throughCursor < value.intent.baseCursor)) fail("derived evidence belongs to another operation or lineage");
  validateNativeResultState(value, context);
}

function validateNativeResultState(value: z.infer<typeof PendingMemoryStateBase>, context: z.RefinementCtx): void {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (!!value.nativeResultReceipt !== !!value.nativeResultReceiptHash) fail("native result receipt integrity is required");
  const dispatch = value.dispatch;
  if (dispatch && (value.dispatchedAt === null || value.phase === "queued")) fail("dispatch protocol requires durable dispatch intent");
  if (dispatch?.protocol === "tracked_native_v1") {
    const command = dispatch.command; const request = command.request;
    if (command.kind !== value.intent.operation.kind || request.operation_id !== value.remoteOperationId
      || request.provider_lineage !== value.intent.providerLineageId || request.bank_generation !== value.intent.bankGeneration) fail("tracked dispatch identity disagrees");
    if (command.kind === "retain" && (command.request.items.length !== 1 || command.request.items[0]?.document_id !== value.documentId)) fail("tracked retain input identity disagrees");
    if (command.kind === "mutation" && value.intent.operation.kind === "mutation" && command.memoryId !== value.intent.operation.request.memoryId) fail("tracked mutation target disagrees");
  }
  if (value.nativeStatus && (dispatch?.protocol !== "tracked_native_v1"
    || value.nativeStatus.operation_id !== value.remoteOperationId || value.nativeStatus.bank_id !== value.intent.bank.bankId
    || value.nativeStatus.operation_kind !== value.intent.operation.kind || value.nativeStatus.provider_lineage !== value.intent.providerLineageId
    || value.nativeStatus.bank_generation !== value.intent.bankGeneration
    || (value.nativeStatus.request_hash !== null && value.nativeStatus.request_hash !== dispatch.requestHash))) fail("native progress identity disagrees");
  const proof = value.nativeResultReceipt;
  if (!proof) return;
  const result = proof.result;
  if (dispatch?.protocol !== "tracked_native_v1" || dispatch.requestHash !== result.request_hash
    || value.nativeReceipt !== null || value.derivedEvidence !== null || !["awaiting_pull", "completed"].includes(value.phase)
    || value.dispatchedAt === null || value.acceptedAt === null || result.operation_id !== value.remoteOperationId
    || result.operation_kind !== value.intent.operation.kind || result.bank_id !== value.intent.bank.bankId
    || result.provider_lineage !== value.intent.providerLineageId || result.bank_generation !== value.intent.bankGeneration
    || result.native_through_cursor < value.intent.baseCursor) fail("native factual proof belongs to another intent or boundary");
  if (value.intent.operation.kind === "retain") {
    const input = result.inputs[0];
    if (result.inputs.length !== 1 || input?.document_id !== value.documentId || input.update_mode !== value.intent.operation.request.updateMode) fail("native full result input disagrees");
    if (value.phase === "completed" && input?.full_result_count === 0 && !value.intent.operation.zeroResultAllowed) fail("zero-result retain was not allowed");
  } else {
    const request = value.intent.operation.request; const mutation = result.mutation;
    if (!mutation || mutation.memory_id !== request.memoryId || mutation.revision !== request.expectedRevision + (result.native_outcome === "applied" ? 1 : 0)
      || (request.kind === "invalidate" && mutation.state !== "invalidated") || (request.kind === "restore" && mutation.state !== "valid")) fail("native mutation result disagrees");
  }
}
