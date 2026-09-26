/**
 * INPUT:  backup.verify requests naming a listed backup id, the Hindsight backup service
 * OUTPUT: backupVerifyKind — synchronous side-effect-free admission (backup producer present, Hindsight marker, no open
 *         exclusive family), deferred claim, phase checkpoints, settlement from the verify outcome (pair mismatch carried in
 *         the result), pre-claim cancel, and boot observation as outcome_unknown (the manifest rewrite is atomic)
 * POS:    core/memory/operations — family hindsight-backup; local re-verification of a sealed pair, never a restore
 */
import type { MemoryOperationRequest } from "@taki/shared";
import { refuseWhileExclusiveFamilyBusy, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";
import {
  admitOnHindsightMarker, backupRef, cancelBeforeClaim, claimDeferred, HINDSIGHT_BACKUP_FAMILY, interrupted, requireBackup, settleBackup,
} from "./memory-operation-kind-backup.ts";

type VerifyRequest = Extract<MemoryOperationRequest, { kind: "backup.verify" }>;

export const backupVerifyKind: MemoryOperationKindHandler<VerifyRequest> = {
  family: () => HINDSIGHT_BACKUP_FAMILY,
  admit: (request, ctx) => {
    const backup = requireBackup(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    admitOnHindsightMarker(backup);
    return { kind: "backup", backupId: request.backupId, phase: "reserved" };
  },
  execute: async (execution) => {
    const backup = requireBackup(execution.ctx);
    const ref = backupRef(execution.producer);
    if (!await claimDeferred(execution)) return null;
    return settleBackup(execution, { ref, run: (checkpoint) => backup.verify({ backupId: ref.backupId, checkpoint }) });
  },
  observeBoot: (operation, ctx) => ctx.backup ? interrupted(operation) : null,
  cancel: cancelBeforeClaim,
};
