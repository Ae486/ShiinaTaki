/**
 * INPUT:  Core-owned Local migration commands and durable producer evidence
 * OUTPUT: strict Local command, progress, producer, result and error schemas
 * POS:    shared/protocol — operation arms kept separate from onboarding reads to avoid protocol cycles
 */
import { z } from "zod";

const Id = z.string().min(1).max(256);
export const MemoryLocalErrorCodeSchema = z.enum([
  "MIGRATION_NOT_FOUND", "MIGRATION_BUSY", "MIGRATION_NOT_READY", "MIGRATION_SUPERSEDED",
  "MIGRATION_CANDIDATE_CONFLICT", "MIGRATION_EXCLUSION_CONFLICT", "MIGRATION_SOURCE_RESOLVED",
  "SNAPSHOT_CHANGED", "INTEGRITY_MISMATCH", "IMPORT_CONFLICT", "MEMORY_AUTHORITY_MISMATCH",
  "MEMORY_RUNTIME_UNAVAILABLE", "MEMORY_INGESTION_SOURCE_UNPROVEN", "MIGRATION_PRODUCER_RUNNING",
  "MIGRATION_INTERRUPTED", "MIGRATION_INTERNAL_ERROR",
]);
export type MemoryLocalErrorCode = z.infer<typeof MemoryLocalErrorCodeSchema>;
export const MemoryLocalPrepareSourceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("new"), previewId: Id, replaceRunId: Id.optional() }),
  z.strictObject({ mode: z.literal("resume"), runId: Id }),
  z.strictObject({ mode: z.literal("retry"), operationId: z.uuid() }),
]);
export const MemoryLocalPrepareRequestSchema = z.strictObject({
  kind: z.literal("local.onboard.prepare"), source: MemoryLocalPrepareSourceSchema,
});
export const MemoryLocalActivateRequestSchema = z.strictObject({ kind: z.literal("local.onboard.activate"), runId: Id });
export const MemoryLocalProgressSchema = z.strictObject({
  phase: z.enum(["reserved", "snapshot", "converting", "verifying", "blocked", "ready", "reconciling", "activating", "binding", "completed"]),
  sourceCount: z.int().nonnegative().nullable(),
  resolvedCount: z.int().nonnegative().nullable(),
  blockingCount: z.int().nonnegative().nullable(),
});
export type MemoryLocalProgress = z.infer<typeof MemoryLocalProgressSchema>;
export const MemoryLocalProducerRefSchema = z.strictObject({
  kind: z.literal("local"), runId: Id, previewId: Id.nullable(), snapshotId: Id.nullable(),
  activationTransactionId: Id.nullable(), progress: MemoryLocalProgressSchema,
});
export const MemoryLocalResultSchema = z.strictObject({
  kind: z.literal("local"), runId: Id,
  outcome: z.enum(["source_blocked", "ready", "activated", "binding_unavailable"]),
  epochId: Id.nullable(), runtimeAvailable: z.boolean(),
});
export type MemoryLocalPrepareRequest = z.infer<typeof MemoryLocalPrepareRequestSchema>;
export type MemoryLocalActivateRequest = z.infer<typeof MemoryLocalActivateRequestSchema>;
export type MemoryLocalPrepareSource = z.infer<typeof MemoryLocalPrepareSourceSchema>;
export type MemoryLocalProducerRef = z.infer<typeof MemoryLocalProducerRefSchema>;
export type MemoryLocalResult = z.infer<typeof MemoryLocalResultSchema>;
