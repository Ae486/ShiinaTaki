/**
 * INPUT:  actual copied Core scope, authoritative application namespaces and verified original lifecycle history
 * OUTPUT: complete template attestation, selected original requests and all required template receipt membership keys
 * POS:    Core backup producer; no inferred Native generation, hold clearance or selection publication
 */
import { HindsightTemplateBackupAttestationSchema, HindsightBackupNativeRequestV2Schema,
  hindsightTemplateBackupReceiptsValue, hindsightTemplateBackupRequestValue, normalizeHindsightBackupRequestV2,
  type HindsightBackupBank, type HindsightBackupNativeRequestV2, type HindsightTemplateBackupBankAttestation,
  type HindsightTemplateReceipt } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readTemplateEmergencyEffects } from "../../db/hindsight-template-emergency-evidence.ts";
import type { Database } from "../../db/sqlite.ts";
import { TemplateBankIdentitySchema, type TemplateBankIdentity } from "../hindsight/template-lifecycle/template-overlay-schema.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { templateDocument } from "../hindsight/template-lifecycle/template-store-documents.ts";
import { readHindsightTemplateBackupHistory, readHindsightTemplateBackupDefaults, hasHindsightTemplateHistory } from "./hindsight-template-backup-history.ts";
import { readHindsightTemplateBackupExecution } from "./hindsight-template-backup-execution.ts";
import { hindsightBackupHash, hindsightBackupProjectionHashes, readHindsightBackupRequest } from "./hindsight-template-backup-integrity.ts";

export interface HindsightTemplateBackupScope { epochId: string; providerLineageId: string; banks: HindsightBackupBank[] }

export function readHindsightTemplateBackupState(db: Database, scope: HindsightTemplateBackupScope) {
  if (readTemplateEmergencyEffects(db, scope.epochId).length) unpublished();
  const identities = scope.banks.map((bank) => {
    const checkpoint = readApplicationCheckpoint(db, bank.nativeBankId);
    if (!checkpoint || checkpoint.bankDeleted || checkpoint.authorityEpochId !== scope.epochId
      || checkpoint.namespace.provider_lineage !== scope.providerLineageId
      || bank.bankGeneration !== null && bank.bankGeneration !== checkpoint.namespace.bank_generation) unproven();
    return TemplateBankIdentitySchema.parse({ scope: bank.scope, canonicalIdentity: bank.bankId,
      target: { provider_lineage: scope.providerLineageId, bank_id: bank.nativeBankId, bank_generation: checkpoint.namespace.bank_generation } });
  });
  return readHindsightTemplateAttestation(db, { ...scope, identities });
}

/** Healthy callers supply independently admitted exact targets; the backup wrapper derives them from the copied namespaces. */
export function readHindsightTemplateAttestation(db: Database, input: {
  epochId: string; providerLineageId: string; identities: TemplateBankIdentity[];
}) {
  const { body, templates, operationIds } = readHindsightTemplateComponents(db, input);
  const attestation = HindsightTemplateBackupAttestationSchema.parse({ ...body, attestationHash: hindsightBackupHash("attestation", body) });
  return { attestation, templates, operationIds };
}

/** Healthy transitions retain their existing 1024-Bank bound; only the backup wire wrapper imposes 256. */
export function readHindsightTemplateComponents(db: Database, input: {
  epochId: string; providerLineageId: string; identities: TemplateBankIdentity[];
}) {
  const identities = input.identities.map((value) => TemplateBankIdentitySchema.parse(value))
    .sort((left, right) => Buffer.compare(Buffer.from(left.canonicalIdentity, "utf8"), Buffer.from(right.canonicalIdentity, "utf8")));
  if (new Set(identities.map((value) => value.canonicalIdentity)).size !== identities.length
    || new Set(identities.map((value) => value.target.bank_id)).size !== identities.length
    || identities.some((value) => value.target.provider_lineage !== input.providerLineageId)) unproven();
  const histories = identities.map((identity) => readHindsightTemplateBackupHistory(db, identity));
  const execution = readHindsightTemplateBackupExecution(db, { epochId: input.epochId, histories });
  const receipts = new Map<string, HindsightTemplateReceipt>();
  for (const receipt of [...histories.flatMap((history) => history.selections.map((selection) => selection.receipt)), ...execution.receipts]) {
    const previous = receipts.get(receipt.request_id);
    if (previous && !templateEqual(previous, receipt)) unproven();
    receipts.set(receipt.request_id, receipt);
  }
  const banks: HindsightTemplateBackupBankAttestation[] = histories.map((history) => {
    const { identity, selected } = history;
    for (const selection of history.selections) {
      const historical = execution.publications.get(selection.request.request_id);
      const pointer = historical?.publication.selections.find((value) => templateEqual(value.identity, identity));
      if (!historical || pointer?.revision !== selection.revision || !templateEqual(historical.receipt, selection.receipt)) unproven();
    }
    const tuples = [...receipts.values()].filter((receipt) => templateEqual(receipt.target, identity.target)).map((receipt) => ({
      request_id: receipt.request_id, request_hash: receipt.request_hash, receipt_hash: receipt.receipt_hash }));
    const receiptInventory = { count: tuples.length, digest: hindsightBackupHash("receipts", hindsightTemplateBackupReceiptsValue(identity.target, tuples)) };
    const base = { target: identity.target, canonicalIdentity: identity.canonicalIdentity, scope: identity.scope,
      characterId: identity.scope === "global" ? null : identity.canonicalIdentity.slice(10), historyHash: history.historyHash, receiptInventory };
    if (!selected) { if (tuples.length) unpublished(); return { ...base, selected: null }; }
    const reference = execution.publications.get(selected.request.request_id);
    const publicationSelection = reference?.publication.selections.find((value) => templateEqual(value.identity, identity));
    if (!reference || !publicationSelection || publicationSelection.revision !== selected.revision
      || !templateEqual(reference.receipt, selected.receipt)) unproven();
    return { ...base, selected: { selectionRevision: selected.revision, selectionHash: templateDocument(selected).hash,
      templateRevision: selected.templateRevision, enrollmentRevision: selected.enrollmentRevision, userRevision: selected.userRevision,
      requestId: selected.request.request_id, requestHash: selected.request.request_hash, receiptHash: selected.receipt.receipt_hash,
      publication: { publicationId: reference.publication.publicationId, planId: reference.plan.planId, planHash: reference.plan.planHash,
        operationId: reference.plan.originalOperationId, selectionIdentity: reference.publication.selectionIdentity },
      ...hindsightBackupProjectionHashes(selected.projection) } };
  });
  const body = { version: 1 as const, authorityEpochId: input.epochId, providerLineageId: input.providerLineageId,
    defaultsHash: readHindsightTemplateBackupDefaults(db, input.providerLineageId).defaultsHash, hold: execution.hold, banks };
  const templates: HindsightBackupNativeRequestV2["templates"] = histories.map((history) => ({ target: history.identity.target,
    selected: history.selected ? { request: history.selected.request, receiptHash: history.selected.receipt.receipt_hash } : null }));
  return { body, templates, receipts: [...receipts.values()],
    operationIds: [...receipts.keys()].map((id) => "template-receipt:" + id).concat(execution.refreshKeys).sort() };
}
export type HindsightTemplateBackupState = ReturnType<typeof readHindsightTemplateAttestation>;

export function createHindsightTemplateBackupRequest(input: {
  backupId: string; createdAt: string; providerLineageId: string; operationIds: string[];
  state: Pick<HindsightTemplateBackupState, "templates" | "operationIds">;
}): HindsightBackupNativeRequestV2 {
  const request = normalizeHindsightBackupRequestV2(HindsightBackupNativeRequestV2Schema.parse({ version: 2,
    backupId: input.backupId, createdAt: input.createdAt, providerLineageId: input.providerLineageId,
    nativeBankIds: input.state.templates.map((bank) => bank.target.bank_id), operationIds: [...new Set([...input.operationIds, ...input.state.operationIds])],
    templates: input.state.templates, requestHash: "0".repeat(64) }));
  request.requestHash = hindsightBackupHash("request", hindsightTemplateBackupRequestValue(request));
  const verified = readHindsightBackupRequest(request); if (verified.version !== 2) unproven(); return verified;
}

export function assertHindsightLegacyTemplateEmpty(db: Database, input: { epochId: string; providerLineageId: string }): void {
  if (readTemplateEmergencyEffects(db, input.epochId).length) unpublished();
  if (!hasHindsightTemplateHistory(db)) return;
  const params = { lineage: input.providerLineageId };
  if (db.prepare("SELECT 1 FROM hindsight_template_enrollments WHERE provider_lineage=:lineage LIMIT 1").get(params)
    || db.prepare("SELECT 1 FROM hindsight_template_default_history WHERE provider_lineage=:lineage LIMIT 1").get(params)) unproven();
}
function unproven(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN"); }
function unpublished(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED"); }
