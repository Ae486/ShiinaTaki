/**
 * INPUT:  complete operator per-Bank schedule edits and Core configuration invalidations
 * OUTPUT: strict memory.replica.configure request/result and memory.replica.changed notification
 * POS:    shared protocol — immediate configuration over the existing scheduler; no durable operation
 */
import { z } from "zod";
import { MemoryReplicaScheduleConfigSchema, MemoryReplicaSyncStatusSchema } from "./memory-replica-schedule-schema.ts";

export const MEMORY_REPLICA_METHODS = { configure: "memory.replica.configure", changed: "memory.replica.changed" } as const;
export const MemoryReplicaConfigureParamsSchema = z.strictObject({
  bankId: z.string().min(1).max(256),
  config: z.strictObject({
    automatic: MemoryReplicaScheduleConfigSchema.shape.automatic.removeDefault(),
    autoIntervalMs: MemoryReplicaScheduleConfigSchema.shape.autoIntervalMs.removeDefault(),
    fullReconciliationIntervalMs: MemoryReplicaScheduleConfigSchema.shape.fullReconciliationIntervalMs.removeDefault(),
  }),
});
export const MemoryReplicaConfigureResultSchema = z.strictObject({ status: MemoryReplicaSyncStatusSchema });
export const MemoryReplicaChangedSchema = z.strictObject({ bankId: z.string().min(1).max(256) });
export type MemoryReplicaConfigureParams = z.infer<typeof MemoryReplicaConfigureParamsSchema>;
export type MemoryReplicaConfigureResult = z.infer<typeof MemoryReplicaConfigureResultSchema>;
export type MemoryReplicaChanged = z.infer<typeof MemoryReplicaChangedSchema>;
