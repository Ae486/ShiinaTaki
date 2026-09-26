/**
 * INPUT:  backup.capture requests, the published Hindsight runtime view and the Hindsight backup service
 * OUTPUT: backupCaptureKind — synchronous side-effect-free admission (backup producer present, Hindsight marker, clean runtime,
 *         expected epoch, no open exclusive family) minting the backup id, deferred claim, phase checkpoints, settlement from
 *         the producer outcome (route b completes with `verifiedAt: null` and a staged Core half), pre-claim cancel, and boot
 *         observation that quarantines the partial dir as outcome_unknown
 * POS:    core/memory/operations — family hindsight-backup (exclusive with setup / local-onboarding / activation / lifecycle)
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperationRequest } from "@taki/shared";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import {
  MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationContext, type MemoryOperationKindHandler,
} from "./memory-operation-contract.ts";
import {
  admitOnHindsightMarker, backupFailure, backupRef, cancelBeforeClaim, claimDeferred, HINDSIGHT_BACKUP_FAMILY, interrupted, requireBackup,
  settleBackup,
} from "./memory-operation-kind-backup.ts";

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
    if (!await claimDeferred(execution)) return null;
    const runtime = execution.ctx.live();
    if (!runtime) return backupFailure("MEMORY_RUNTIME_UNAVAILABLE", ref);
    if (runtime.epochId !== execution.request.expectedEpochId) return backupFailure("MEMORY_AUTHORITY_MISMATCH", ref);
    return settleBackup(execution, { ref, run: (checkpoint) => backup.capture({ operationId: execution.operationId, backupId: ref.backupId,
      route: execution.request.route ?? "native-endpoint", runtime, checkpoint }) });
  },
  // The fence was in-memory and died with the process; whatever the dead capture left partial is set aside, never listed.
  observeBoot: (operation, ctx) => {
    if (!ctx.backup) return null;
    ctx.backup.quarantine(backupRef(operation.producer).backupId);
    return interrupted(operation);
  },
  cancel: cancelBeforeClaim,
};

/** The marker names Hindsight at the expected epoch and the published runtime serves it without drift. */
function admissibleRuntime(ctx: MemoryOperationContext, input: { backup: HindsightBackupService; expectedEpochId: string }): void {
  admitOnHindsightMarker(input.backup, input.expectedEpochId);
  const runtime = ctx.live();
  let admissible: boolean;
  try { admissible = runtime !== null && runtime.epochId === input.expectedEpochId && runtime.driftReason() === "none"; }
  catch { admissible = false; }
  if (!admissible) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
}
