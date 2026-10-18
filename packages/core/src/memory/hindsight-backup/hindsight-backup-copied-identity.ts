/**
 * INPUT:  a completed immutable Core copy and the capture's exact authority/configuration/request stamp
 * OUTPUT: Core identity and v2 template evidence reconstructed from that copy, never the earlier live cursor read
 * POS:    operator backup/restore inspection; opens only the owned completed file and never migrates or starts writers
 */
import { HindsightBackupNativeRequestV1Schema, type HindsightDeploymentMode } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { openReadonlyDatabase, type Database } from "../../db/sqlite.ts";
import { readHindsightBackupIdentity } from "./hindsight-backup-identity.ts";
import { hindsightBackupOperationDigest } from "./hindsight-backup-pair.ts";
import { readHindsightTerminalOperations } from "./hindsight-backup-receipts.ts";
import { readHindsightTemplateBackupState, createHindsightTemplateBackupRequest } from "./hindsight-template-backup-attestation.ts";
import { readHindsightCaptureConnection } from "./hindsight-backup-capture-connection.ts";

export interface HindsightBackupCopyInput {
  version: 1 | 2; backupId: string; createdAt: string; epochId: string;
  configFingerprint: string; deploymentMode: HindsightDeploymentMode;
}
export function inspectHindsightBackupCopy(path: string, input: HindsightBackupCopyInput) {
  const db = openReadonlyDatabase(path);
  try { return readHindsightBackupCopyIdentity(db, input); }
  finally { db.close(); }
}
export function readHindsightBackupCopyIdentity(db: Database, input: HindsightBackupCopyInput) {
  const rows = createHindsightBankSetupRepo(db).list();
  const banks = rows.map((row) => ({ bankId: row.externalBankId, scope: row.scope,
    characterId: row.scope === "global" ? null : row.canonicalIdentity.slice(10) }));
  const connection = db.prepare("SELECT config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get();
  if (connection?.config_fingerprint !== input.configFingerprint) invalid();
  const original = readHindsightBackupIdentity(db, { ...input, banks: () => banks });
  if (original.core.version !== 1) invalid();
  if (input.version === 1) {
    const request = HindsightBackupNativeRequestV1Schema.parse({ version: 1, backupId: input.backupId, createdAt: input.createdAt,
      providerLineageId: original.core.authority.providerLineageId, nativeBankIds: original.core.banks.map((bank) => bank.nativeBankId),
      operationIds: original.operationIds });
    return { version: 1 as const, identity: { ...original, core: original.core }, request };
  }
  const state = readHindsightTemplateBackupState(db, { epochId: input.epochId,
    providerLineageId: original.core.authority.providerLineageId, banks: original.core.banks });
  const operationIds = readHindsightTerminalOperations(db, { epochId: input.epochId,
    providerLineageId: original.core.authority.providerLineageId, includeTemplates: true,
    generations: new Map(state.templates.map((bank) => [bank.target.bank_id, bank.target.bank_generation])) });
  const request = createHindsightTemplateBackupRequest({ ...input, providerLineageId: original.core.authority.providerLineageId,
    operationIds, state });
  const core = { ...original.core, version: 2 as const, requestHash: request.requestHash, templates: state.attestation,
    terminalOperations: { count: request.operationIds.length, digest: hindsightBackupOperationDigest(request.operationIds) } };
  return { version: 2 as const, identity: { ...original, core, operationIds: request.operationIds }, request, state,
    connectionHash: readHindsightCaptureConnection(db, { ...input, banks: () => banks }) };
}
export type HindsightBackupCopiedIdentity = ReturnType<typeof readHindsightBackupCopyIdentity>;
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_READBACK_MISMATCH"); }
