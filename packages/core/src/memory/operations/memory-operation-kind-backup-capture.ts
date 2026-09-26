/**
 * INPUT:  backup.capture requests, the published Hindsight runtime view and the Hindsight backup service
 * OUTPUT: backupCaptureKind — synchronous side-effect-free admission (backup producer present, Hindsight marker, clean runtime,
 *         expected epoch, no open exclusive family) minting the backup id, deferred claim, phase checkpoints, settlement from
 *         the producer outcome, pre-claim cancel, and boot observation that quarantines the partial dir as outcome_unknown
 * POS:    core/memory/operations — family hindsight-backup (exclusive with setup / local-onboarding / activation / lifecycle)
 */
import { randomUUID } from "node:crypto";
import type {
  MemoryBackupErrorCode, MemoryBackupProducerRef, MemoryOperation, MemoryOperationProducerRef, MemoryOperationReason, MemoryOperationRequest,
} from "@taki/shared";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import {
  MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationContext, type MemoryOperationExecution,
  type MemoryOperationKindHandler, type MemoryOperationSettlement, type MemoryOperationsRuntime,
} from "./memory-operation-contract.ts";
import { HINDSIGHT_BACKUP_FAMILY } from "./memory-operation-kind-backup.ts";

type CaptureRequest = Extract<MemoryOperationRequest, { kind: "backup.capture" }>;

export const backupCaptureKind: MemoryOperationKindHandler<CaptureRequest> = {
  family: () => HINDSIGHT_BACKUP_FAMILY,
  admit: (request, ctx) => {
    const backup = requireBackup(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    admissibleRuntime(ctx, { backup, expectedEpochId: request.expectedEpochId });
    return { kind: "backup", backupId: randomUUID(), phase: "reserved" };
  },
  execute: async (execution) => {
    const backup = requireBackup(execution.ctx);
    const ref = backupRef(execution.producer);
    // One macrotask lets the admitted row be read or cancelled first; a lost CAS never pauses anything.
    await new Promise<void>((done) => setImmediate(done));
    if (!execution.tryClaim()) return null;
    const runtime = execution.ctx.live();
    if (!runtime) return failure("MEMORY_RUNTIME_UNAVAILABLE", ref);
    if (runtime.epochId !== execution.request.expectedEpochId) return failure("MEMORY_AUTHORITY_MISMATCH", ref);
    return capture(backup, execution, { ref, runtime });
  },
  observeBoot: (operation, ctx) => ctx.backup ? observeBoot(ctx.backup, operation) : null,
  cancel: (operation) => { if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING"); },
};

function requireBackup(ctx: MemoryOperationContext): HindsightBackupService {
  if (!ctx.backup) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return ctx.backup;
}

/** The marker names Hindsight at the expected epoch and the published runtime serves it without drift. */
function admissibleRuntime(ctx: MemoryOperationContext, input: { backup: HindsightBackupService; expectedEpochId: string }): void {
  const runtime = ctx.live();
  let admissible: boolean;
  try {
    admissible = runtime !== null && input.backup.markerEpochId() === input.expectedEpochId
      && runtime.epochId === input.expectedEpochId && runtime.driftReason() === "none";
  } catch { admissible = false; }
  if (!admissible) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
}

function backupRef(producer: MemoryOperationProducerRef | null): MemoryBackupProducerRef {
  if (!producer || producer.kind !== "backup") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

async function capture(backup: HindsightBackupService, execution: MemoryOperationExecution<CaptureRequest>,
  input: { ref: MemoryBackupProducerRef; runtime: MemoryOperationsRuntime }): Promise<MemoryOperationSettlement> {
  const { ref } = input; let latest = ref;
  const outcome = await backup.capture({ operationId: execution.operationId, backupId: ref.backupId, runtime: input.runtime,
    checkpoint: (phase) => { latest = { ...latest, phase }; execution.checkpoint(latest); } });
  if (!outcome.ok) {
    return { ...failure(outcome.code, latest), result: outcome.mismatch
      ? { kind: "backup", backupId: ref.backupId, verifiedAt: null, mismatch: outcome.mismatch } : null };
  }
  return { state: "completed", reason: null, errorCode: null, producer: { ...latest, phase: "completed" },
    result: { kind: "backup", backupId: ref.backupId, verifiedAt: outcome.manifest.verifiedAt, mismatch: null } };
}

/** The fence was in-memory and died with the process; whatever the dead capture staged is set aside, never listed or resumed. */
function observeBoot(backup: HindsightBackupService, operation: MemoryOperation): MemoryOperationSettlement {
  const ref = backupRef(operation.producer);
  backup.quarantine(ref.backupId);
  return { state: "outcome_unknown", reason: "producer_incomplete", errorCode: null, result: null, producer: ref };
}

function failure(code: MemoryBackupErrorCode, producer: MemoryBackupProducerRef): MemoryOperationSettlement {
  return { state: "failed", reason: failureReason(code), errorCode: code, result: null, producer };
}

function failureReason(code: MemoryBackupErrorCode): MemoryOperationReason {
  if (code === "MEMORY_RUNTIME_UNAVAILABLE") return "runtime_unavailable";
  return code === "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE" || code === "MEMORY_AUTHORITY_MISMATCH" ? "producer_refused" : "producer_failed";
}
