/**
 * INPUT:  internal adapter/repository failures at the replica execution boundary
 * OUTPUT: closed diagnostic codes and ownership/reset classifications without provider text
 * POS:    core/memory/hindsight — privacy boundary for durable scheduler status and supervisor diagnostics
 */
import { MemoryReplicaErrorCodeSchema, type MemoryReplicaErrorCode } from "@taki/shared";

export function replicaErrorCode(error: unknown): MemoryReplicaErrorCode {
  const candidate = typeof error === "object" && error !== null && "code" in error ? error.code
    : error instanceof Error ? error.message : undefined;
  const parsed = MemoryReplicaErrorCodeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : "HINDSIGHT_REPLICA_SYNC_FAILED";
}

export function replicaOwnershipLost(error: unknown): boolean {
  const code = replicaErrorCode(error);
  return code === "HINDSIGHT_REPLICA_LEASE_LOST" || code === "HINDSIGHT_REPLICA_SCHEDULE_STALE";
}

export function replicaResetRequired(error: unknown): boolean {
  return ["HINDSIGHT_CURSOR_RESET_REQUIRED", "HINDSIGHT_REPLICA_LINEAGE_MISMATCH",
    "HINDSIGHT_REPLICA_GENERATION_MISMATCH", "HINDSIGHT_SNAPSHOT_LINEAGE_MISMATCH"].includes(replicaErrorCode(error));
}
