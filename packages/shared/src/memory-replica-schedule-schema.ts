/**
 * INPUT:  Core-owned replica scheduler configuration and bounded diagnostic state
 * OUTPUT: validated per-Bank scheduling/status contracts for automatic and manual sync
 * POS:    shared protocol — durable replica scheduling and recovery diagnostics; no provider payloads or secrets
 */
import { z } from "zod";
import { HindsightErrorCodeSchema } from "./hindsight-connection-schema.ts";
import { MemoryReplicaCheckpointSchema, MemoryReplicaLeaseSchema } from "./memory-replica-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const AutoInterval = z.int().min(60_000).max(31 * 24 * 60 * 60 * 1_000);
const FullInterval = z.int().min(60_000).max(90 * 24 * 60 * 60 * 1_000);

export const REPLICA_AUTO_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const REPLICA_FULL_RECONCILIATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
export const REPLICA_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

export const MemoryReplicaBankSchema = z.strictObject({
  bankId: Id,
  scope: z.enum(["global", "character"]),
  characterId: Id.nullable(),
}).refine((bank) => (bank.scope === "character") === (bank.characterId !== null), "Bank scope and Character binding disagree");
export type MemoryReplicaBank = z.infer<typeof MemoryReplicaBankSchema>;

export const MemoryReplicaScheduleConfigSchema = z.strictObject({
  automatic: z.boolean().default(true),
  autoIntervalMs: AutoInterval.default(REPLICA_AUTO_INTERVAL_MS),
  fullReconciliationIntervalMs: FullInterval.default(REPLICA_FULL_RECONCILIATION_INTERVAL_MS),
});
export type MemoryReplicaScheduleConfig = z.infer<typeof MemoryReplicaScheduleConfigSchema>;

export const MemoryReplicaRunKindSchema = z.enum(["incremental", "full"]);
export type MemoryReplicaRunKind = z.infer<typeof MemoryReplicaRunKindSchema>;
export const MemoryReplicaScheduledRunSchema = z.strictObject({
  lease: MemoryReplicaLeaseSchema,
  kind: MemoryReplicaRunKindSchema,
  trigger: z.enum(["manual", "catch_up", "retry", "interval"]),
  predecessor: MemoryReplicaCheckpointSchema.nullable(),
  manualRequestId: z.uuid().optional(),
}).refine((run) => run.predecessor === null || run.predecessor.bankId === run.lease.bankId, "run predecessor belongs to another Bank")
  .refine((run) => !run.manualRequestId || run.trigger === "manual", "manual identity requires a manual claim");
export type MemoryReplicaScheduledRun = z.infer<typeof MemoryReplicaScheduledRunSchema>;

export const MemoryReplicaRunResultSchema = z.strictObject({
  checkpoint: MemoryReplicaCheckpointSchema,
  observedCursor: z.int().min(0),
}).refine((result) => result.observedCursor >= result.checkpoint.endCursor, "observed cursor precedes the checkpoint");
export type MemoryReplicaRunResult = z.infer<typeof MemoryReplicaRunResultSchema>;

// Only registered codes cross the status boundary; arbitrary exception text is never normalized into a code.
export const MemoryReplicaErrorCodeSchema = z.enum([
  ...HindsightErrorCodeSchema.options,
  "HINDSIGHT_REPLICA_BUSY", "HINDSIGHT_REPLICA_LEASE_LOST", "HINDSIGHT_CHECKPOINT_MISSING",
  "HINDSIGHT_CHECKPOINT_STALE", "HINDSIGHT_REPLICA_LINEAGE_MISMATCH", "HINDSIGHT_REPLICA_GENERATION_MISMATCH",
  "HINDSIGHT_REPLICA_EPOCH_MISMATCH", "HINDSIGHT_REPLICA_BANK_MISMATCH", "HINDSIGHT_REPLICA_INTEGRITY_ERROR",
  "HINDSIGHT_REPLICA_REVISION_STALE", "HINDSIGHT_REPLICA_APPLY_FAILED", "HINDSIGHT_REPLICA_SYNC_FAILED",
  "HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED", "HINDSIGHT_REPLICA_SCHEDULE_STALE", "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH",
  "HINDSIGHT_JOURNAL_CLIENT_UNAVAILABLE", "HINDSIGHT_SNAPSHOT_CLIENT_UNAVAILABLE", "HINDSIGHT_DEADLINE_EXCEEDED",
  "HINDSIGHT_SNAPSHOT_MANIFEST_CHANGED", "HINDSIGHT_SNAPSHOT_BANK_MISMATCH", "HINDSIGHT_SNAPSHOT_LINEAGE_MISMATCH",
  "HINDSIGHT_SNAPSHOT_COUNT_MISMATCH", "HINDSIGHT_SNAPSHOT_MANIFEST_HASH_MISMATCH", "HINDSIGHT_SNAPSHOT_PAGE_ORDER_MISMATCH",
  "HINDSIGHT_SNAPSHOT_PAGE_HASH_MISMATCH", "HINDSIGHT_REPLICA_RESULT_INVALID",
  "HINDSIGHT_PENDING_IDENTITY_CONFLICT", "HINDSIGHT_PENDING_PAYLOAD_UNSAFE", "HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED",
  "HINDSIGHT_PENDING_STATE_STALE", "HINDSIGHT_PENDING_RECEIPT_INVALID", "HINDSIGHT_PENDING_OPERATION_FAILED",
  "HINDSIGHT_PENDING_OPERATION_CANCELLED", "HINDSIGHT_PENDING_OUTCOME_UNKNOWN", "HINDSIGHT_PENDING_SUPERSEDED",
  "HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_PENDING_AUTHORITY_MISMATCH", "HINDSIGHT_PENDING_CLIENT_UNAVAILABLE",
  "HINDSIGHT_DERIVED_FENCE_UNAVAILABLE", "HINDSIGHT_DERIVED_FENCE_INVALID",
  "HINDSIGHT_NATIVE_RESULT_UNAVAILABLE", "HINDSIGHT_NATIVE_RESULT_INVALID",
]);
export type MemoryReplicaErrorCode = z.infer<typeof MemoryReplicaErrorCodeSchema>;

export const MemoryReplicaSyncStateSchema = z.strictObject({
  bankId: Id,
  scope: z.enum(["global", "character"]),
  characterId: Id.nullable(),
  automatic: z.boolean(),
  autoIntervalMs: AutoInterval,
  fullReconciliationIntervalMs: FullInterval,
  mode: z.enum(["idle", "running", "failed"]),
  run: MemoryReplicaScheduledRunSchema.nullable(),
  fullReconciliationState: z.enum(["idle", "running", "succeeded", "failed"]),
  nextDueAt: Timestamp.nullable(),
  nextFullDueAt: Timestamp.nullable(),
  retryAttempt: z.int().min(0).max(5),
  retryKind: MemoryReplicaRunKindSchema.nullable(),
  retryDueAt: Timestamp.nullable(),
  pendingManualKind: MemoryReplicaRunKindSchema.nullable(),
  pendingManualRequestId: z.uuid().nullable().optional(),
  catchUpRequested: z.boolean(),
  lastAttemptAt: Timestamp.nullable(),
  lastSuccessAt: Timestamp.nullable(),
  lastFullReconciliationAt: Timestamp.nullable(),
  lastObservedCursor: z.int().min(0).nullable(),
  lastObservedLineageId: z.string().uuid().nullable(),
  lastObservedBankGeneration: z.string().uuid().nullable(),
  consecutiveFailures: z.int().min(0),
  errorCode: MemoryReplicaErrorCodeSchema.nullable(),
  nextAction: z.enum(["automatic_retry_scheduled", "explicit_retry_required"]).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).superRefine((state, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if ((state.scope === "character") !== (state.characterId !== null)) fail("Bank scope and Character binding disagree");
  if ((state.mode === "running") !== (state.run !== null)) fail("running state requires its lease-bound run");
  if (state.run && state.run.lease.bankId !== state.bankId) fail("run belongs to another Bank");
  if (state.pendingManualRequestId && state.pendingManualKind === null) fail("manual identity requires a queued request");
  if (state.retryDueAt === null ? state.retryKind !== null || state.retryAttempt !== 0 : state.retryKind === null || state.retryAttempt === 0) fail("retry fields disagree");
  if ((state.errorCode === null) !== (state.nextAction === null)) fail("diagnostic fields disagree");
  if ((state.fullReconciliationState === "running") !== (state.run?.kind === "full")) fail("full reconciliation state requires its running claim");
  if (!state.automatic && (state.nextDueAt !== null || state.nextFullDueAt !== null || state.retryDueAt !== null || state.catchUpRequested)) {
    fail("manual mode cannot schedule background work");
  }
  const observation = [state.lastObservedCursor, state.lastObservedLineageId, state.lastObservedBankGeneration];
  if (!observation.every((value) => value === null) && observation.some((value) => value === null)) fail("cursor observation requires lineage and generation");
});
export type MemoryReplicaSyncState = z.infer<typeof MemoryReplicaSyncStateSchema>;

export const MemoryReplicaSyncStatusSchema = MemoryReplicaSyncStateSchema.safeExtend({
  checkpoint: MemoryReplicaCheckpointSchema.nullable(),
  lag: z.int().min(0).nullable(),
}).superRefine((state, context) => {
  if (state.checkpoint !== null && state.checkpoint.bankId !== state.bankId) {
    context.addIssue({ code: "custom", message: "status checkpoint belongs to another Bank" });
  }
  if (state.lag === null) return;
  if (state.checkpoint === null || state.lastObservedCursor === null || state.lastObservedLineageId !== state.checkpoint.providerLineageId
    || state.lastObservedBankGeneration !== state.checkpoint.bankGeneration || state.lag !== state.lastObservedCursor - state.checkpoint.endCursor) {
    context.addIssue({ code: "custom", message: "known lag requires matching checkpoint and observation evidence" });
  }
});
export type MemoryReplicaSyncStatus = z.infer<typeof MemoryReplicaSyncStatusSchema>;
