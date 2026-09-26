/**
 * INPUT:  backup.admit requests (a staged route-b backup id + a plain inbox file name), the Hindsight backup service
 * OUTPUT: backupAdmitKind — synchronous side-effect-free admission (backup producer present, Hindsight marker at the expected
 *         epoch, no open exclusive family) carrying the staged backup id, deferred claim, phase checkpoints, settlement from
 *         the admit outcome (pair mismatch carried in the result), pre-claim cancel, and boot observation that settles a
 *         sealed pair as completed or returns a claimed ZIP to the inbox as outcome_unknown
 * POS:    core/memory/operations — family hindsight-backup; route b (PR02 fallback) admission of an operator-produced native ZIP
 */
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import { refuseWhileExclusiveFamilyBusy, type MemoryOperationKindHandler, type MemoryOperationSettlement } from "./memory-operation-contract.ts";
import {
  admitOnHindsightMarker, backupRef, cancelBeforeClaim, claimDeferred, HINDSIGHT_BACKUP_FAMILY, interrupted, requireBackup, settleBackup,
} from "./memory-operation-kind-backup.ts";

type AdmitRequest = Extract<MemoryOperationRequest, { kind: "backup.admit" }>;

export const backupAdmitKind: MemoryOperationKindHandler<AdmitRequest> = {
  family: () => HINDSIGHT_BACKUP_FAMILY,
  admit: (request, ctx) => {
    const backup = requireBackup(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    admitOnHindsightMarker(backup, request.expectedEpochId);
    return { kind: "backup", backupId: request.backupId, phase: "reserved" };
  },
  execute: async (execution) => {
    const backup = requireBackup(execution.ctx);
    const ref = backupRef(execution.producer);
    if (!await claimDeferred(execution)) return null;
    const { request } = execution;
    return settleBackup(execution, { ref, run: (checkpoint) => backup.admit({ backupId: ref.backupId, fileName: request.fileName,
      expectedEpochId: request.expectedEpochId, checkpoint }) });
  },
  observeBoot: (operation, ctx) => ctx.backup ? observeBoot(ctx.backup, operation) : null,
  cancel: cancelBeforeClaim,
};

/** The rename into the sealed dir is the commit point: sealed means admitted, anything earlier goes back to the operator. */
function observeBoot(backup: HindsightBackupService, operation: MemoryOperation): MemoryOperationSettlement {
  const ref = backupRef(operation.producer);
  const sealed = backup.sealed(ref.backupId);
  if (sealed?.route === "operator-artifact") {
    return { state: "completed", reason: null, errorCode: null, producer: { ...ref, phase: "completed" },
      result: { kind: "backup", backupId: ref.backupId, verifiedAt: sealed.verifiedAt, mismatch: null } };
  }
  if (operation.request.kind === "backup.admit") {
    try { backup.returnInbox(ref.backupId, operation.request.fileName); }
    catch { /* the ZIP stays in the staged dir, where a later admit refuses it rather than judging a half-moved file */ }
  }
  return interrupted(operation);
}
