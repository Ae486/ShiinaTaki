/**
 * INPUT:  original offline incident, verified surviving candidate and current exact primary custody
 * OUTPUT: emergency final evidence and the W4 atomic authority/custody/queue/receipt publication
 * POS:    core/db — separate typed emergency join; healthy native proof requirements remain unchanged
 */
import { MemoryEmergencyPublicationSchema, MemoryTransitionFinalProofSchema,
  MemoryTransitionReceiptSchema, type MemoryEmergencyCandidate, type MemoryEmergencyPublication,
  type MemoryTransitionReceipt } from "@taki/shared";
import { readVerifiedEmergencyCandidate } from "./memory-transition-emergency-candidate.ts";
import { readEmergencyIncident } from "./memory-transition-emergency-repo.ts";
import { readTransitionIntent, requireTransitionLease, assertTransitionPredecessor } from "./memory-transition-repo.ts";
import { readTransitionProof, readTransitionReceipt, recordTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readEmergencyTransitionCustody, transferTransitionCustody, verifyTransitionCustodyAssignment } from "./memory-transition-custody.ts";
import { readTransitionQueue } from "./memory-transition-queue-repo.ts";
import { installEmergencyLocalCandidate } from "./memory-transition-local-staging.ts";
import { publishTransitionBlocks } from "./memory-transition-representation.ts";
import { allocateTransitionEpoch, selectTransitionEpoch, publishTransitionMarker, verifyInstalledTransitionLocal } from "./memory-transition-publication-repo.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import type { Database } from "./sqlite.ts";
import { assertEmergencyConfiguration } from "../memory/transitions/transition-current-identity.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";

type Input = TransitionCaptureInput & { candidateId: string };
function boundary(db: Database, input: Input, verification: TransitionEvidenceContext) {
  const attempt = requireTransitionLease(db, input); const intent = readTransitionIntent(db, attempt.transitionId);
  if (!intent || intent.request.kind !== "transition.emergency-local" || !intent.incidentId
    || !["fenced", "proven"].includes(attempt.phase) || attempt.cutoffSequence === null) invalid();
  assertTransitionPredecessor(db, intent); input.assertConfiguration();
  const candidate = readVerifiedEmergencyCandidate(db, input.candidateId, verification);
  const incident = readEmergencyIncident(db, intent.transitionId);
  if (!incident?.transition || candidate.transitionId !== intent.transitionId) invalid();
  const custody = readEmergencyTransitionCustody(db, candidate.predecessorEpochId);
  const queue = queueBoundary(db, intent.transitionId);
  if (queue.length !== attempt.cutoffSequence || queue.some((row, index) => row.sequence !== index + 1)) invalid();
  const proof = MemoryTransitionFinalProofSchema.parse({ version: 1, transitionId: intent.transitionId,
    attemptId: attempt.attemptId, generation: attempt.generation, identity: intent.request.expected,
    fencedManifestHash: candidate.stateHash, mappingHash: candidate.mappingHash, custodyBoundaryHash: transitionLocalHash(custody),
    cutoffSequence: attempt.cutoffSequence, unresolvedSourceHash: transitionLocalHash({ unknownEffects: incident.transition.unknownEffects,
      pendingSources: candidate.pendingSources }), banks: proofBanks(candidate),
    incidentId: incident.incidentId, incidentHash: candidate.incidentHash, backupId: incident.lastVerifiedBackupId, recordedAt: input.now });
  return { attempt, intent, candidate, incident, custody, queue, proof };
}
export function buildEmergencyPublicationProof(db: Database, input: Input) {
  return withTransitionEvidenceContext(db, (verification) => {
    let result: ReturnType<typeof boundary>["proof"] | undefined;
    db.transaction(() => { result = boundary(db, input, verification).proof; });
    return result ?? invalid();
  });
}

/** Called by publishMemoryTransition inside its same outer synchronous transaction. */
export function publishEmergencyTransition(db: Database, input: Input & { currentTime(): string }, verification: TransitionEvidenceContext): MemoryTransitionReceipt {
  verification.assertOwner(db); verification.assertIndependent();
  const current = boundary(db, input, verification); const { attempt, intent, candidate, incident, custody, queue } = current;
  const proof = attempt.lastEvidenceId ? readTransitionProof(db, attempt.lastEvidenceId) : undefined;
  if (attempt.phase !== "proven" || !proof || transitionLocalHash(proof) !== transitionLocalHash({ ...current.proof, recordedAt: proof.recordedAt })) invalid();
  const custodyAssignmentHash = transitionLocalHash({ source: custody, targetEpochId: candidate.targetEpochId });
  const receiptBody = { version: 1 as const, transitionId: intent.transitionId, operationId: intent.operationId,
    requestId: intent.request.requestId, kind: intent.request.kind, identity: intent.request.expected,
    newEpochId: candidate.targetEpochId, proofId: attempt.lastEvidenceId!, mappingHash: candidate.mappingHash,
    custodyAssignmentHash, cutoffSequence: attempt.cutoffSequence!, committedAt: input.now };
  const receipt = MemoryTransitionReceiptSchema.parse({ ...receiptBody, receiptId: canonicalPayloadHash(["taki-transition-receipt.v1", receiptBody]) });
  allocateTransitionEpoch(db, receipt, "emergency-takeover");
  installEmergencyLocalCandidate(db, candidate.candidateId, verification);
  selectTransitionEpoch(db, receipt); publishTransitionBlocks(db, candidate); verifyInstalledTransitionLocal(db, candidate);
  transferTransitionCustody(db, { source: custody, targetEpochId: receipt.newEpochId, now: input.now });
  recordTransitionReceipt(db, { ...input, receipt });
  const body = { version: 2 as const, kind: "emergency-surviving" as const, transitionId: intent.transitionId,
    receiptId: receipt.receiptId, candidateId: candidate.candidateId, baselineId: null, proofId: receipt.proofId,
    sourceCustody: custody, custodyAssignmentHash, sourceDispositions: [], queue, checkpoints: checkpoints(db, candidate, verification),
    incidentId: incident.incidentId, incidentHash: candidate.incidentHash, captureId: candidate.captureId,
    unknownEffects: incident.transition!.unknownEffects };
  const publication = MemoryEmergencyPublicationSchema.parse({ ...body, publicationId: transitionLocalHash(["taki-transition-emergency-publication.v1", body]) });
  db.prepare("INSERT INTO memory_transition_publications VALUES(:id,:transition,:receipt,:candidate,:json)")
    .run({ id: publication.publicationId, transition: intent.transitionId, receipt: receipt.receiptId,
      candidate: candidate.candidateId, json: JSON.stringify(publication) });
  db.prepare("INSERT INTO memory_transition_foreign_branches VALUES(:epoch,:lineage,:transition,:target,:incident,:receipt)")
    .run({ epoch: receipt.identity.predecessorEpochId, lineage: receipt.identity.sourceLineageId,
      transition: intent.transitionId, target: receipt.newEpochId, incident: incident.incidentId, receipt: receipt.receiptId });
  publishTransitionMarker(db, receipt, publication);
  readVerifiedEmergencyPublication(db, receipt.receiptId, verification);
  assertEmergencyConfiguration(db, intent.request.expected);
  // Receipt insertion is the only attempt mutation in this transaction. Preserve the captured executor identity,
  // accepting exactly that revision step; an expired/replaced executor must roll back before the outer COMMIT.
  requireTransitionLease(db, { lease: { ...input.lease, revision: attempt.revision + 1 }, now: input.currentTime() });
  return receipt;
}

export function readVerifiedEmergencyPublication(db: Database, receiptId: string, context?: TransitionEvidenceContext): MemoryEmergencyPublication {
  context?.assertIndependent();
  return withTransitionEvidenceContext(db, (verification) => readEmergencyPublication(db, receiptId, verification), context);
}
function readEmergencyPublication(db: Database, receiptId: string, verification: TransitionEvidenceContext): MemoryEmergencyPublication {
  const row = db.prepare("SELECT * FROM memory_transition_publications WHERE receipt_id=:id").get({ id: receiptId });
  if (!row) invalid();
  const value = MemoryEmergencyPublicationSchema.parse(JSON.parse(String(row.publication_json)));
  const { publicationId, ...body } = value;
  if (publicationId !== row.publication_id || value.receiptId !== receiptId || value.transitionId !== row.transition_id
    || value.candidateId !== row.candidate_id || publicationId !== transitionLocalHash(["taki-transition-emergency-publication.v1", body])) invalid();
  const receipt = readTransitionReceipt(db, value.transitionId); const proof = readTransitionProof(db, value.proofId);
  const candidate = readVerifiedEmergencyCandidate(db, value.candidateId, verification); const incident = readEmergencyIncident(db, value.transitionId);
  if (!receipt || !proof || !incident?.transition || receipt.kind !== "transition.emergency-local" || receipt.receiptId !== receiptId
    || receipt.proofId !== value.proofId || candidate.transitionId !== value.transitionId || candidate.targetEpochId !== receipt.newEpochId
    || candidate.incidentId !== value.incidentId || candidate.incidentHash !== value.incidentHash || candidate.captureId !== value.captureId
    || proof.incidentId !== value.incidentId || proof.incidentHash !== value.incidentHash || proof.fencedManifestHash !== candidate.stateHash
    || receipt.mappingHash !== candidate.mappingHash || proof.mappingHash !== candidate.mappingHash
    || proof.custodyBoundaryHash !== transitionLocalHash(value.sourceCustody)
    || value.sourceCustody.epochId !== receipt.identity.predecessorEpochId || value.sourceCustody.provider !== "hindsight"
    || value.custodyAssignmentHash !== receipt.custodyAssignmentHash
    || value.custodyAssignmentHash !== transitionLocalHash({ source: value.sourceCustody, targetEpochId: receipt.newEpochId })
    || value.sourceDispositions.length !== 0 || transitionLocalHash(value.unknownEffects) !== transitionLocalHash(incident.transition.unknownEffects)
    || proof.unresolvedSourceHash !== transitionLocalHash({ unknownEffects: value.unknownEffects, pendingSources: candidate.pendingSources })
    || transitionLocalHash(proof.banks) !== transitionLocalHash(proofBanks(candidate))
    || transitionLocalHash(value.checkpoints) !== transitionLocalHash(checkpoints(db, candidate, verification))
    || transitionLocalHash(value.queue) !== transitionLocalHash(queueBoundary(db, value.transitionId))
    || value.queue.length !== receipt.cutoffSequence) invalid();
  validateSelected(db, { value, receipt }); return value;
}

function validateSelected(db: Database, input: { value: MemoryEmergencyPublication; receipt: MemoryTransitionReceipt }): void {
  const { value, receipt } = input;
  const epoch = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: receipt.newEpochId });
  const old = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: receipt.identity.predecessorEpochId });
  const foreign = db.prepare("SELECT * FROM memory_transition_foreign_branches WHERE source_epoch_id=:id").get({ id: receipt.identity.predecessorEpochId });
  if (!epoch || epoch.reason !== "emergency-takeover" || epoch.provider_id !== "local" || epoch.provider_lineage_id !== receipt.identity.targetLineageId
    || epoch.predecessor_epoch_id !== receipt.identity.predecessorEpochId || !old || old.status !== "closed" || old.ended_at !== receipt.committedAt
    || old.provider_id !== "hindsight" || old.provider_lineage_id !== receipt.identity.sourceLineageId
    || !foreign || foreign.transition_id !== value.transitionId || foreign.receipt_id !== receipt.receiptId
    || foreign.target_epoch_id !== receipt.newEpochId || foreign.incident_id !== value.incidentId || foreign.provider_lineage_id !== old.provider_lineage_id) invalid();
  const marker = db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get();
  if (marker?.transition_receipt_id !== receipt.receiptId) return;
  const active = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
  if (epoch.status !== "active" || marker.active_epoch_id !== receipt.newEpochId || active?.active_epoch_id !== receipt.newEpochId
    || marker.mode !== "canonical-local" || marker.provider_lineage_id !== receipt.identity.targetLineageId
    || marker.replica_checkpoint_digest !== transitionLocalHash(value.checkpoints)) invalid();
  verifyTransitionCustodyAssignment(db, { source: value.sourceCustody, targetEpochId: receipt.newEpochId });
}
function proofBanks(candidate: MemoryEmergencyCandidate) {
  return candidate.scopes.map((scope) => ({ sourceBankId: scope.nativeBankId, manifestHash: scope.evidenceId,
    mappingHash: transitionLocalHash(candidate.mappings.filter((mapping) => mapping.localBankId === scope.localBankId)), native: null }));
}
function checkpoints(db: Database, candidate: MemoryEmergencyCandidate, verification: TransitionEvidenceContext) {
  return candidate.scopes.map((scope) => {
    const evidence = verification.readSurviving(db, scope.evidenceId);
    return { bankId: scope.nativeBankId, evidenceId: evidence.evidenceId, nativeSnapshotId: evidence.nativeSnapshotId,
      applicationSnapshotId: evidence.applicationSnapshotId, nativeCursor: evidence.nativeCursor,
      applicationCursor: evidence.applicationCursor, checkpointHash: null };
  });
}
function queueBoundary(db: Database, transitionId: string) {
  return readTransitionQueue(db, transitionId).map(({ intentId, replayId, sequence, commandHash }) => ({ intentId, replayId, sequence, commandHash }));
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
