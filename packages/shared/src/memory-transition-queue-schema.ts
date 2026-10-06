/**
 * INPUT:  normalized transition-owned writes and immutable original caller provenance
 * OUTPUT: strict durable queue intent, execution identity and distinct caller outcome schemas
 * POS:    shared/protocol — queue custody is separate from Pending and from Run/Effect authority
 */
import { z } from "zod";
import { MemoryBankScopeSchema, MemoryErrorCodeSchema } from "./memory-provider-domain-schema.ts";
import { MutationRequestSchema, RetainCompletedResultSchema, RetainRequestSchema } from "./memory-provider-operation-schema.ts";
import { HindsightMemoryRetainCompletedResultV1Schema } from "./hindsight-memory-consumer-schema.ts";
import { MemoryTransitionErrorCodeSchema } from "./memory-transition-schema.ts";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Time = z.iso.datetime({ offset: true });
export const MemoryTransitionCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("retain"), request: RetainRequestSchema }),
  z.strictObject({ kind: z.literal("mutation"), request: MutationRequestSchema }),
]);
export const MemoryTransitionQueuedIntentSchema = z.strictObject({
  version: z.literal(1), intentId: z.uuid(), transitionId: z.uuid(), sequence: z.int().min(1),
  sourceEpochId: Id, callerRequestId: Id, replayId: z.uuid(), commandHash: Hash,
  provenance: z.strictObject({ callerId: Id, runId: Id.nullable(), attemptId: Id.nullable(), effectId: Id.nullable() }),
  scope: MemoryBankScopeSchema, logicalTargetId: Id, expectedRevision: z.int().min(1).nullable(),
  command: MemoryTransitionCommandSchema, admittedAt: Time,
}).superRefine((value, ctx) => {
  if (value.command.kind === "mutation" && (value.expectedRevision !== value.command.request.expectedRevision || value.logicalTargetId !== value.command.request.memoryId)) {
    ctx.addIssue({ code: "custom", message: "mutation logical target/revision must match the captured command" });
  }
  const p = value.provenance;
  if ((p.runId === null) !== (p.attemptId === null) || (p.effectId !== null && p.runId === null)) ctx.addIssue({ code: "custom", message: "Run provenance is incomplete" });
});
export type MemoryTransitionQueuedIntent = z.infer<typeof MemoryTransitionQueuedIntentSchema>;
export const MemoryTransitionQueueExecutionSchema = z.strictObject({
  intentId: z.uuid(), replayId: z.uuid(), targetRequestId: z.uuid(), targetEpochId: Id, targetBankId: Id,
  targetLogicalId: Id, expectedRevision: z.int().min(1).nullable(), mappingHash: Hash, preparedAt: Time,
});
export type MemoryTransitionQueueExecution = z.infer<typeof MemoryTransitionQueueExecutionSchema>;
export const MemoryTransitionQueueOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("queued"), transitionId: z.uuid(), intentId: z.uuid(), sequence: z.int().min(1) }),
  z.strictObject({ status: z.literal("completed"), intentId: z.uuid(), targetRequestId: z.uuid(), receiptId: Id,
    result: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("retain"), value: z.union([RetainCompletedResultSchema, HindsightMemoryRetainCompletedResultV1Schema]) }),
      z.strictObject({ kind: z.literal("mutation"), memoryId: Id, revision: z.int().min(1) }),
    ]), settledAt: Time }),
  z.strictObject({ status: z.literal("conflict"), intentId: z.uuid(), errorCode: z.literal("MEMORY_TRANSITION_CONFLICT"), settledAt: Time }),
  z.strictObject({ status: z.literal("failed"), intentId: z.uuid(), targetRequestId: z.uuid(), receiptId: Id, errorCode: MemoryErrorCodeSchema, settledAt: Time }),
  z.strictObject({ status: z.literal("cancelled"), intentId: z.uuid(), settledAt: Time }),
  z.strictObject({ status: z.literal("refused"), intentId: z.uuid().nullable(), errorCode: MemoryTransitionErrorCodeSchema, retryable: z.boolean(), settledAt: Time }),
  z.strictObject({ status: z.literal("outcome_unknown"), intentId: z.uuid(), targetRequestId: z.uuid(), settledAt: Time }),
]);
export type MemoryTransitionQueueOutcome = z.infer<typeof MemoryTransitionQueueOutcomeSchema>;
