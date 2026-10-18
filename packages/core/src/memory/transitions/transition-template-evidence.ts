/**
 * INPUT:  a real authenticated template observation and the complete independently sealed W2 document
 * OUTPUT: strict association validation against W2 rows, exact Core publication and admitted template identity
 * POS:    healthy evidence integrity; an unrelated observation can never stand in for the fenced final snapshot
 */
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, MemoryTransitionTemplateAssociationSchema,
  type MemoryTransitionNativeEvidence, type MemoryTransitionTemplateAssociation,
  type HindsightTemplateBackupObservationResponse } from "@taki/shared";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { assertHindsightTemplateObservation } from "../hindsight-backup/hindsight-template-backup-observer.ts";
import { verifyHindsightTemplateBackupBank } from "../hindsight-backup/hindsight-template-backup-pair.ts";
import { readHindsightBackupRequest } from "../hindsight-backup/hindsight-template-backup-integrity.ts";
import { hindsightBackupOperationDigest } from "../hindsight-backup/hindsight-backup-pair.ts";
import { readTransitionTemplateAuxiliary } from "./transition-template-auxiliary.ts";

/** The ordinary W2 reader verifies pages/bodies first; this adds no alternative Native hash domain. */
export function verifyTransitionTemplateAssociation(evidence: MemoryTransitionNativeEvidence): void {
  if (!evidence.templateBackup) return;
  const association = MemoryTransitionTemplateAssociationSchema.parse(evidence.templateBackup);
  const { evidenceId, templateBackup, ...w2Body } = evidence; void evidenceId; void templateBackup;
  if (association.w2EvidenceId !== transitionDocumentHash("native_evidence", w2Body)
    || association.w2ProofHash !== evidence.status.proof?.proof_hash) invalid();
  compareObservation(evidence, association, association.observation);
}

/** The immutable W2/association was already verified. Fresh transport evidence is compared without replacing its saved bytes. */
export function verifyTransitionTemplateObservation(evidence: MemoryTransitionNativeEvidence,
  observation: HindsightTemplateBackupObservationResponse): void {
  if (!evidence.templateBackup) invalid();
  compareObservation(evidence, evidence.templateBackup, observation);
}

function compareObservation(evidence: MemoryTransitionNativeEvidence, association: MemoryTransitionTemplateAssociation,
  observation: HindsightTemplateBackupObservationResponse): void {
  verifyAssociationIdentity(evidence, { ...association, observation });
  const request = readHindsightBackupRequest(association.request); if (request.version !== 2) invalid();
  assertHindsightTemplateObservation({ proof: observation.proof, schema: observation.schema, requestHash: request.requestHash });
  const native = observation.proof.templates[0]; if (!native) invalid();
  const auxiliary = readTransitionTemplateAuxiliary(evidence, request);
  if (!templateEqual(auxiliary.receiptInventory, native.receiptInventory)
    || native.selected.state === "selected" && auxiliary.databaseDefinitionHash !== native.selected.databaseDefinitionHash
    || !verifyHindsightTemplateBackupBank(association.bank, native, request.requestHash).ok) invalid();
}

function verifyAssociationIdentity(evidence: MemoryTransitionNativeEvidence, association: MemoryTransitionTemplateAssociation): void {
  const proof = evidence.status.proof; if (!proof) invalid();
  const target = { provider_lineage: proof.provider_lineage, bank_id: proof.bank_id, bank_generation: proof.bank_generation };
  const { request, observation, bank } = association;
  const requested = request.templates[0]; const observed = observation.proof.templates[0]; const native = observation.proof.banks[0];
  if (!requested || !observed || !native || request.backupId !== evidence.transitionId
    || request.providerLineageId !== target.provider_lineage || observation.proof.providerLineage !== target.provider_lineage
    || observation.proof.compatibilityBuild !== HINDSIGHT_TEMPLATE_BACKUP_BUILD
    || !templateEqual(bank.target, target) || !templateEqual(requested.target, target) || !templateEqual(observed.target, target)
    || request.nativeBankIds[0] !== target.bank_id || native.bankId !== target.bank_id || native.bankGeneration !== target.bank_generation
    || native.currentCursor < proof.native_snapshot.manifest.end_cursor
    || observation.proof.receipts.count !== request.operationIds.length || observation.proof.receipts.missingCount !== 0
    || observation.proof.receipts.digest !== hindsightBackupOperationDigest(request.operationIds)) invalid();
  if (!bank.selected) { if (requested.selected !== null) invalid(); return; }
  if (!requested.selected || requested.selected.request.request_id !== bank.selected.requestId
    || requested.selected.request.request_hash !== bank.selected.requestHash || requested.selected.receiptHash !== bank.selected.receiptHash) invalid();
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
