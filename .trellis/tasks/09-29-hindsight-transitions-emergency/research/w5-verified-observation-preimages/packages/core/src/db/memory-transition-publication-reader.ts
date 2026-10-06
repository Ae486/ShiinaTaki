/**
 * INPUT:  persisted explicit transition receipt marker and immutable publication dependencies
 * OUTPUT: receipt-proven boot/recovery validation without old activation receipts or candidate reinstallation
 * POS:    core/db — selected transition history reader; ordinary post-publication edits remain legal
 */
import { MemoryTransitionPublicationSchema, MemoryTransitionCommonBaselineSchema, type MemoryTransitionPublication } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readVerifiedTransitionCandidate } from "../memory/transitions/transition-final-mapping.ts";
import { readTransitionProof, readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readTransitionDocument } from "./memory-transition-document-repo.ts";
import { readTransitionQueue } from "./memory-transition-queue-repo.ts";
import { readTransitionAttempt } from "./memory-transition-repo.ts";
import { readTransitionNativeEvidence } from "./memory-transition-candidate-repo.ts";
import { readApplicationCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { transitionPublicationBanks } from "./memory-transition-publication-proof.ts";
import { verifyTransitionCustodyAssignment } from "./memory-transition-custody.ts";
import { classifyTransitionSources } from "./memory-transition-source-disposition.ts";
import type { Database } from "./sqlite.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";

export function readVerifiedTransitionPublication(db: Database, receiptId: string, context?: TransitionEvidenceContext): MemoryTransitionPublication {
  return withTransitionEvidenceContext(db, (verification) => readVerifiedPublication(db, receiptId, verification), context);
}
function readVerifiedPublication(db: Database, receiptId: string, verification: TransitionEvidenceContext): MemoryTransitionPublication {
  const row = db.prepare("SELECT * FROM memory_transition_publications WHERE receipt_id=:id").get({ id: receiptId });
  if (!row) invalid();
  const value = MemoryTransitionPublicationSchema.parse(JSON.parse(String(row.publication_json)));
  const { publicationId, ...body } = value;
  if (value.receiptId !== receiptId || value.receiptId !== row.receipt_id || value.transitionId !== row.transition_id
    || value.candidateId !== row.candidate_id || publicationId !== row.publication_id
    || publicationId !== transitionLocalHash(["taki-transition-publication.v1", body])) invalid();
  const receipt = readTransitionReceipt(db, value.transitionId); const proof = readTransitionProof(db, value.proofId);
  const candidate = readVerifiedTransitionCandidate(db, value.candidateId, verification);
  const baseline = readTransitionDocument(db, "baselines", { id: value.baselineId, schema: MemoryTransitionCommonBaselineSchema });
  const attempt = readTransitionAttempt(db, value.transitionId);
  if (!receipt || !proof || !baseline || !attempt || receipt.receiptId !== receiptId || receipt.proofId !== value.proofId
    || candidate.transitionId !== value.transitionId || candidate.targetEpochId !== receipt.newEpochId
    || receipt.mappingHash !== candidate.mappingHash || proof.fencedManifestHash !== candidate.stateHash
    || baseline.candidateId !== candidate.candidateId || baseline.targetEpochId !== candidate.targetEpochId
    || baseline.mappingHash !== candidate.mappingHash || baseline.stateHash !== candidate.stateHash
    || receipt.custodyAssignmentHash !== value.custodyAssignmentHash
    || value.custodyAssignmentHash !== transitionLocalHash({ source: value.sourceCustody, targetEpochId: receipt.newEpochId })
    || proof.custodyBoundaryHash !== transitionLocalHash(value.sourceCustody) || value.sourceCustody.epochId !== receipt.identity.predecessorEpochId
    || proof.unresolvedSourceHash !== transitionLocalHash(value.sourceDispositions)
    || transitionLocalHash(proof.banks) !== transitionLocalHash(transitionPublicationBanks(db, candidate, { identity: receipt.identity, verification }))
    || transitionLocalHash(classifyTransitionSources(db, candidate)) !== transitionLocalHash(value.sourceDispositions)) invalid();
  const queue = readTransitionQueue(db, value.transitionId).map(({ intentId, replayId, sequence, commandHash }) => ({ intentId, replayId, sequence, commandHash }));
  if (transitionLocalHash(queue) !== transitionLocalHash(value.queue) || queue.length !== receipt.cutoffSequence
    || attempt.cutoffSequence !== receipt.cutoffSequence || attempt.cutoffAt === null || value.checkpoints.length !== candidate.scopes.length) invalid();
  for (const scope of candidate.scopes) {
    const checkpoint = value.checkpoints.find((entry) => entry.bankId === scope.nativeBankId);
    const native = readTransitionNativeEvidence(db, scope.evidenceId, verification).status.proof!;
    if (!checkpoint || checkpoint.evidenceId !== scope.evidenceId || checkpoint.nativeSnapshotId !== native.native_snapshot.snapshot_id
      || checkpoint.applicationSnapshotId !== native.application_snapshot.snapshot_id
      || checkpoint.nativeCursor !== native.native_snapshot.manifest.end_cursor
      || checkpoint.applicationCursor !== native.application_snapshot.checkpoint.state_cursor
      || (checkpoint.checkpointHash === null) !== (receipt.identity.targetProvider === "local")) invalid();
  }
  validateSelectedPublication(db, value, verification);
  return value;
}

function validateSelectedPublication(db: Database, value: MemoryTransitionPublication, verification: TransitionEvidenceContext): void {
  const receipt = readTransitionReceipt(db, value.transitionId)!;
  const marker = db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get();
  const epoch = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: receipt.newEpochId });
  const previous = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: receipt.identity.predecessorEpochId });
  if (!epoch || epoch.predecessor_epoch_id !== receipt.identity.predecessorEpochId || epoch.reason !== "planned-switch"
    || epoch.provider_id !== receipt.identity.targetProvider || epoch.provider_lineage_id !== receipt.identity.targetLineageId
    || !previous || previous.status !== "closed" || previous.ended_at !== receipt.committedAt
    || previous.provider_id !== receipt.identity.sourceProvider || previous.provider_lineage_id !== receipt.identity.sourceLineageId) invalid();
  if (marker?.transition_receipt_id !== receipt.receiptId) return;
  const active = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
  if (marker.active_epoch_id !== receipt.newEpochId || active?.active_epoch_id !== receipt.newEpochId || epoch.status !== "active"
    || marker.mode !== (receipt.identity.targetProvider === "local" ? "canonical-local" : "hindsight")
    || marker.provider_lineage_id !== receipt.identity.targetLineageId
    || marker.replica_checkpoint_digest !== transitionLocalHash(value.checkpoints)) invalid();
  verifyTransitionCustodyAssignment(db, { source: value.sourceCustody, targetEpochId: receipt.newEpochId });
  if (receipt.identity.targetProvider !== "hindsight") return;
  for (const saved of value.checkpoints) {
    const current = readApplicationCheckpoint(db, saved.bankId);
    const native = readTransitionNativeEvidence(db, saved.evidenceId, verification).status.proof!;
    if (!current || current.authorityEpochId !== receipt.newEpochId || current.checkpoint.native_cursor < saved.nativeCursor
      || current.checkpoint.state_cursor < saved.applicationCursor || current.bankDeleted
      || transitionLocalHash(current.namespace) !== transitionLocalHash(native.application_snapshot.namespace)
      || transitionLocalHash(current.native) !== transitionLocalHash(readReplicaCheckpoint(db, saved.bankId))) invalid();
  }
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
