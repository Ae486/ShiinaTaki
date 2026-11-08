/**
 * INPUT:  admitted runtime/compatibility, live Core and a completed immutable backup copy
 * OUTPUT: versioned capture identity and synchronous epoch/template/hold read-back guards
 * POS:    Core capture boundary; complete template evidence comes from the copied database after backupTo finishes
 */
import type { Database } from "../../db/sqlite.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { hindsightTemplateBackupAvailable } from "../hindsight/hindsight-template-backup-capability.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { readHindsightBackupIdentity, type HindsightBackupRuntimeIdentity } from "./hindsight-backup-identity.ts";
import { inspectHindsightBackupCopy, type HindsightBackupCopyInput } from "./hindsight-backup-copied-identity.ts";
import { assertHindsightLegacyTemplateEmpty, readHindsightTemplateBackupState } from "./hindsight-template-backup-attestation.ts";
import { readHindsightCaptureConnection } from "./hindsight-backup-capture-connection.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";

export function readHindsightCaptureState(db: Database, runtime: HindsightBackupRuntimeIdentity & Pick<MemoryOperationsRuntime, "verifySelectedAuthority">) {
  const identity = readHindsightBackupIdentity(db, runtime, runtime.verifySelectedAuthority);
  const admitted = createHindsightRuntimeAdmissionRepo(db).read({ authorityEpochId: runtime.epochId, configFingerprint: runtime.configFingerprint });
  if (admitted && hindsightTemplateBackupAvailable(admitted.manifest)) {
    const templates = readHindsightTemplateBackupState(db, { epochId: runtime.epochId,
      providerLineageId: identity.core.authority.providerLineageId, banks: identity.core.banks });
    return { version: 2 as const, identity, templates, connectionHash: readHindsightCaptureConnection(db, runtime) };
  }
  assertHindsightLegacyTemplateEmpty(db, { epochId: runtime.epochId, providerLineageId: identity.core.authority.providerLineageId });
  return { version: 1 as const, identity };
}
export type HindsightCaptureState = ReturnType<typeof readHindsightCaptureState>;

export function readHindsightCapturedCopy(path: string, input: HindsightBackupCopyInput, admitted: HindsightCaptureState) {
  const copied = inspectHindsightBackupCopy(path, input);
  if (copied.version !== admitted.version || !templateEqual(copied.identity.core.authority, admitted.identity.core.authority)
    || copied.version === 2 && (admitted.version !== 2
      || copied.state.attestation.attestationHash !== admitted.templates.attestation.attestationHash
      || copied.connectionHash !== admitted.connectionHash)) changed();
  return copied;
}

export function assertHindsightCaptureCurrent(db: Database, runtime: HindsightBackupRuntimeIdentity & Pick<MemoryOperationsRuntime, "verifySelectedAuthority">, admitted: HindsightCaptureState): void {
  const current = readHindsightCaptureState(db, runtime);
  if (current.version !== admitted.version || !templateEqual(current.identity.core.authority, admitted.identity.core.authority)
    || current.version === 2 && (admitted.version !== 2
      || current.templates.attestation.attestationHash !== admitted.templates.attestation.attestationHash
      || current.connectionHash !== admitted.connectionHash)) changed();
}
function changed(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN"); }
