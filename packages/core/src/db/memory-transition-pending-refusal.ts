/**
 * INPUT:  the original Core Pending row identity and its actual tracked-native status
 * OUTPUT: storage-validated original state and positive non-dispatch or zero-effect cancellation proof
 * POS:    core/db — shared healthy source-disposition and target-error evidence; partial writes remain unknown
 */
import { PendingMemoryStateSchema, type PendingMemoryRecord, type PendingMemoryRef } from "@taki/shared";
import { readPendingMemory } from "./pending-memory-store.ts";
import type { Database } from "./sqlite.ts";

export function readTransitionPendingState(db: Database, ref: PendingMemoryRef) {
  const record = readPendingMemory(db, ref);
  // The ordinary store verifies row keys, hashes, version and native dispatch binding before this projection.
  // Remove its storage-only sequence to retain the existing immutable transition evidence hash format.
  return record ? PendingMemoryStateSchema.strip().parse(record) : undefined;
}

export function transitionPendingRefusal(row: Omit<PendingMemoryRecord, "sequence">): "not-dispatched" | "refused" | undefined {
  if (!["failed", "cancelled"].includes(row.phase) || row.nativeReceipt !== null || row.nativeResultReceipt != null
    || row.terminalAt === null) return undefined;
  if (row.dispatchedAt === null && row.acceptedAt === null && row.dispatch === undefined) return "not-dispatched";
  const status = row.nativeStatus;
  if (row.phase === "cancelled" && row.dispatch?.protocol === "tracked_native_v1" && status?.status === "cancelled"
    && status.request_hash === row.dispatch.requestHash && status.progress?.committed_parts === 0
    && status.progress.completed_inputs === 0 && status.result === null) return "refused";
  return undefined;
}
