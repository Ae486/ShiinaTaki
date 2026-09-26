/**
 * INPUT:  backup operation rows, the operation context's Hindsight backup service and producer outcomes
 * OUTPUT: HINDSIGHT_BACKUP_FAMILY and the helpers the three backup kinds share: required service, marker-epoch admission,
 *         producer-ref narrowing, macrotask-deferred claim, outcome -> settlement (mismatch carried in the result), the
 *         restart settlement and pre-claim cancel
 * POS:    core/memory/operations — family hindsight-backup (exclusive with setup / local-onboarding / activation / lifecycle);
 *         the kinds live in memory-operation-kind-backup-{capture,admit,verify}.ts
 */
import type {
  MemoryBackupErrorCode, MemoryBackupProducerRef, MemoryOperation, MemoryOperationProducerRef, MemoryOperationReason, MemoryOperationRequest,
} from "@taki/shared";
import type { HindsightBackupOutcome } from "../hindsight-backup/hindsight-backup-failure.ts";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import {
  MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationExecution, type MemoryOperationSettlement,
} from "./memory-operation-contract.ts";

export const HINDSIGHT_BACKUP_FAMILY = "hindsight-backup";

export function requireBackup(ctx: MemoryOperationContext): HindsightBackupService {
  if (!ctx.backup) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return ctx.backup;
}

/** The marker names Hindsight (at `expectedEpochId` when given); an unreadable marker admits nothing. */
export function admitOnHindsightMarker(backup: HindsightBackupService, expectedEpochId?: string): void {
  let epochId: string | null;
  try { epochId = backup.markerEpochId(); }
  catch { epochId = null; }
  if (epochId === null || (expectedEpochId !== undefined && epochId !== expectedEpochId)) {
    throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  }
}

export function backupRef(producer: MemoryOperationProducerRef | null): MemoryBackupProducerRef {
  if (!producer || producer.kind !== "backup") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

/** One macrotask lets the admitted row be read or cancelled first; a lost CAS never starts the producer. */
export async function claimDeferred(execution: Pick<MemoryOperationExecution<MemoryOperationRequest>, "tryClaim">): Promise<boolean> {
  await new Promise<void>((done) => setImmediate(done));
  return execution.tryClaim();
}

/** Runs a producer with checkpointed phases and settles from its outcome. */
export async function settleBackup(execution: Pick<MemoryOperationExecution<MemoryOperationRequest>, "checkpoint">, input: {
  ref: MemoryBackupProducerRef; run: (checkpoint: (phase: MemoryBackupProducerRef["phase"]) => void) => Promise<HindsightBackupOutcome>;
}): Promise<MemoryOperationSettlement> {
  const { ref } = input; let latest = ref;
  const outcome = await input.run((phase) => { latest = { ...latest, phase }; execution.checkpoint(latest); });
  if (!outcome.ok) {
    return { ...backupFailure(outcome.code, latest), result: outcome.mismatch
      ? { kind: "backup", backupId: ref.backupId, verifiedAt: null, mismatch: outcome.mismatch } : null };
  }
  return { state: "completed", reason: null, errorCode: null, producer: { ...latest, phase: "completed" },
    result: { kind: "backup", backupId: ref.backupId, verifiedAt: outcome.verifiedAt, mismatch: null } };
}

export function backupFailure(code: MemoryBackupErrorCode, producer: MemoryBackupProducerRef): MemoryOperationSettlement {
  return { state: "failed", reason: failureReason(code), errorCode: code, result: null, producer };
}

/** A producer that died with the process is never resumed; what it left is judged by the caller's cleanup. */
export function interrupted(operation: MemoryOperation): MemoryOperationSettlement {
  return { state: "outcome_unknown", reason: "producer_incomplete", errorCode: null, result: null, producer: backupRef(operation.producer) };
}

export function cancelBeforeClaim(operation: MemoryOperation): void {
  if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
}

function failureReason(code: MemoryBackupErrorCode): MemoryOperationReason {
  if (code === "MEMORY_RUNTIME_UNAVAILABLE") return "runtime_unavailable";
  return code === "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE" || code === "MEMORY_AUTHORITY_MISMATCH" ? "producer_refused" : "producer_failed";
}
