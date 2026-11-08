/**
 * INPUT:  the per-kind handler modules (setup validate/apply, replica sync, local prepare/activate, hindsight activate,
 *         bank provision, connection revalidate, the backup kinds)
 * OUTPUT: MEMORY_OPERATION_KINDS — the closed kind registry the service dispatches through
 * POS:    core/memory/operations — one handler module per kind; later stages add a row here, never a branch in the service
 */
import type { MemoryOperationKind, MemoryOperationRequest } from "@taki/shared";
import type { MemoryOperationKindHandler } from "./memory-operation-contract.ts";
import { backupAdmitKind } from "./memory-operation-kind-backup-admit.ts";
import { backupCaptureKind } from "./memory-operation-kind-backup-capture.ts";
import { backupVerifyKind } from "./memory-operation-kind-backup-verify.ts";
import { bankProvisionKind } from "./memory-operation-kind-bank.ts";
import { connectionRevalidateKind } from "./memory-operation-kind-connection.ts";
import { hindsightActivateKind } from "./memory-operation-kind-hindsight.ts";
import { localActivateKind, localPrepareKind } from "./memory-operation-kind-local.ts";
import { replicaSyncKind } from "./memory-operation-kind-replica.ts";
import { setupApplyKind, setupValidateKind } from "./memory-operation-kind-setup.ts";
import { transitionKind } from "./memory-operation-kind-transition.ts";
import { templateKind } from "./memory-operation-kind-template.ts";
import { candidateKind } from "./memory-operation-kind-candidate.ts";

export type MemoryOperationKindRegistry = {
  [K in MemoryOperationKind]: MemoryOperationKindHandler<Extract<MemoryOperationRequest, { kind: K }>>;
};

export const MEMORY_OPERATION_KINDS: MemoryOperationKindRegistry = {
  "setup.validate": setupValidateKind,
  "setup.apply": setupApplyKind,
  "replica.sync": replicaSyncKind,
  "local.onboard.prepare": localPrepareKind,
  "local.onboard.activate": localActivateKind,
  "hindsight.activate": hindsightActivateKind,
  "bank.provision": bankProvisionKind,
  "connection.revalidate": connectionRevalidateKind,
  "backup.capture": backupCaptureKind,
  "backup.admit": backupAdmitKind,
  "backup.verify": backupVerifyKind,
  "transition.return-local": transitionKind,
  "transition.reenter-hindsight": transitionKind,
  "transition.emergency-local": transitionKind,
  "template.apply": templateKind,
  "template.recover": templateKind,
  "candidate.prepare": candidateKind,
  "candidate.inspect": candidateKind,
  "candidate.resume": candidateKind,
};

/** Erases the per-kind request narrowing at the dispatch boundary; the service only ever passes a request of the matching kind. */
export function memoryOperationHandler(registry: MemoryOperationKindRegistry, kind: MemoryOperationKind): MemoryOperationKindHandler {
  return registry[kind] as unknown as MemoryOperationKindHandler;
}
