/**
 * INPUT:  a historical copied-Core file and its recorded versioned identity/request
 * OUTPUT: exact reconstructed v2 identity, rejecting edited metadata, omitted history or unpublished effects
 * POS:    shared capture/admit/verify/restore read-back; never substitutes today's live selections
 */
import type { HindsightBackupNativeRequest } from "@taki/shared";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { inspectHindsightBackupCopy, type HindsightBackupCopiedIdentity } from "./hindsight-backup-copied-identity.ts";
import type { HindsightBackupStagedRecord } from "./hindsight-backup-staging.ts";
import { readHindsightBackupRequest } from "./hindsight-template-backup-integrity.ts";

type Core = HindsightBackupStagedRecord["core"];
export function readHindsightBackupCopy(path: string, core: Core, request?: HindsightBackupNativeRequest) {
  const copied = inspectHindsightBackupCopy(path, { version: core.version, backupId: core.backupId, createdAt: core.createdAt,
    epochId: core.authority.epochId, configFingerprint: core.authority.configFingerprint, deploymentMode: core.authority.deploymentMode });
  assertHindsightCopiedBackupIdentity(copied, core);
  if (request && !templateEqual(readHindsightBackupRequest(request), copied.request)) invalid();
  return copied;
}
export function assertHindsightCopiedBackupIdentity(copied: HindsightBackupCopiedIdentity, core: Core): void {
  const identity = copied.identity;
  if (copied.version !== core.version || identity.migrationHead !== core.core.migrationHead
    || !templateEqual(identity.core.authority, core.authority) || !templateEqual(identity.core.terminalOperations, core.terminalOperations)
    || !templateEqual(sortedBanks(identity.core.banks), sortedBanks(core.banks))) invalid();
  if (core.version === 2 && (copied.version !== 2 || copied.request.requestHash !== core.requestHash
    || !templateEqual(copied.state.attestation, core.templates))) invalid();
}
function sortedBanks(banks: Core["banks"]) { return [...banks].sort((a, b) => Buffer.compare(Buffer.from(a.nativeBankId), Buffer.from(b.nativeBankId))); }
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_READBACK_MISMATCH"); }
