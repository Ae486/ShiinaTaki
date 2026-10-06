/**
 * INPUT:  actual W1 lease/proof and immutable W3 candidate with the live source boundary
 * OUTPUT: one SQLite COMMIT publishing epoch, representation, marker, custody, queue obligations and receipt
 * POS:    core/db — sole healthy repeated-transition publication; no asynchronous work or source revival
 */
import { MemoryTransitionCommonBaselineSchema, MemoryTransitionPublicationSchema, MemoryTransitionReceiptSchema,
  type MemoryTransitionPublication, type MemoryTransitionReceipt } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionPublicationBoundary } from "./memory-transition-publication-proof.ts";
import { readTransitionProof, readTransitionReceipt, recordTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { installTransitionLocalCandidate } from "./memory-transition-local-staging.ts";
import { discoverTransitionLocal, type TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import { transferTransitionCustody } from "./memory-transition-custody.ts";
import { publishTransitionRepresentations } from "./memory-transition-representation.ts";
import { readTransitionDocument } from "./memory-transition-document-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import type { Database } from "./sqlite.ts";

export function publishMemoryTransition(db: Database, input: TransitionCaptureInput & { candidateId: string }): MemoryTransitionReceipt {
  let receipt: MemoryTransitionReceipt | undefined;
  db.transaction(() => {
    const prior = readTransitionReceipt(db, input.lease.transitionId);
    if (prior) {
      const publication = readVerifiedTransitionPublication(db, prior.receiptId);
      if (publication.candidateId !== input.candidateId) invalid();
      receipt = prior; return;
    }
    const boundary = readTransitionPublicationBoundary(db, input); const { candidate, intent, attempt } = boundary;
    const proof = attempt.lastEvidenceId ? readTransitionProof(db, attempt.lastEvidenceId) : undefined;
    if (attempt.phase !== "proven" || !proof
      || transitionLocalHash(proof) !== transitionLocalHash({ ...boundary.proof, recordedAt: proof.recordedAt })) invalid();
    const baseline = readTransitionDocument(db, "baselines", { transitionId: intent.transitionId, slot: "final", schema: MemoryTransitionCommonBaselineSchema });
    if (!baseline || baseline.candidateId !== candidate.candidateId || baseline.mappingHash !== candidate.mappingHash
      || baseline.targetEpochId !== candidate.targetEpochId || baseline.stateHash !== candidate.stateHash) invalid();
    const custodyAssignmentHash = transitionLocalHash({ source: boundary.custody, targetEpochId: candidate.targetEpochId });
    const body = { version: 1 as const, transitionId: intent.transitionId, operationId: intent.operationId,
      requestId: intent.request.requestId, kind: intent.request.kind, identity: intent.request.expected,
      newEpochId: candidate.targetEpochId, proofId: attempt.lastEvidenceId!, mappingHash: candidate.mappingHash,
      custodyAssignmentHash, cutoffSequence: attempt.cutoffSequence!, committedAt: input.now };
    receipt = MemoryTransitionReceiptSchema.parse({ ...body, receiptId: canonicalPayloadHash(["taki-transition-receipt.v1", body]) });
    allocateEpoch(db, receipt);
    if (receipt.identity.targetProvider === "local") installTransitionLocalCandidate(db, candidate.candidateId);
    selectEpoch(db, receipt);
    const checkpoints = publishTransitionRepresentations(db, { candidate, provider: receipt.identity.targetProvider, now: input.now });
    if (receipt.identity.targetProvider === "local") verifyInstalledLocal(db, candidate);
    transferTransitionCustody(db, { source: boundary.custody, targetEpochId: receipt.newEpochId, now: input.now });
    recordTransitionReceipt(db, { ...input, receipt });
    const publicationBody = { version: 1 as const, transitionId: intent.transitionId, receiptId: receipt.receiptId,
      candidateId: candidate.candidateId, baselineId: baseline.baselineId, proofId: receipt.proofId,
      sourceCustody: boundary.custody, custodyAssignmentHash, sourceDispositions: boundary.sourceDispositions,
      queue: boundary.queue, checkpoints };
    const publication = MemoryTransitionPublicationSchema.parse({ ...publicationBody,
      publicationId: transitionLocalHash(["taki-transition-publication.v1", publicationBody]) });
    db.prepare("INSERT INTO memory_transition_publications VALUES(:id,:transition,:receipt,:candidate,:json)")
      .run({ id: publication.publicationId, transition: intent.transitionId, receipt: receipt.receiptId,
        candidate: candidate.candidateId, json: JSON.stringify(publication) });
    publishMarker(db, receipt, publication);
    readVerifiedTransitionPublication(db, receipt.receiptId);
  });
  if (!receipt) invalid(); return receipt;
}

function allocateEpoch(db: Database, receipt: MemoryTransitionReceipt): void {
  // Unselected staging has a closed epoch. The predecessor stays the sole active epoch until all Local rows exist.
  db.prepare(`INSERT INTO canonical_memory_authority_epochs VALUES(:epoch,:provider,:lineage,'closed',:previous,:now,:now,'planned-switch')`)
    .run({ epoch: receipt.newEpochId, provider: receipt.identity.targetProvider, lineage: receipt.identity.targetLineageId,
      previous: receipt.identity.predecessorEpochId, now: receipt.committedAt });
}
function selectEpoch(db: Database, receipt: MemoryTransitionReceipt): void {
  const params = { epoch: receipt.newEpochId, previous: receipt.identity.predecessorEpochId, now: receipt.committedAt };
  if (db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:previous AND status='active'")
    .run({ previous: params.previous, now: params.now }).changes !== 1) invalid();
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='active',ended_at=NULL WHERE epoch_id=:epoch").run({ epoch: params.epoch });
  if (db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch,updated_at=:now WHERE singleton=1 AND active_epoch_id=:previous")
    .run(params).changes !== 1) invalid();
}
function publishMarker(db: Database, receipt: MemoryTransitionReceipt, publication: MemoryTransitionPublication): void {
  const changed = db.prepare(`UPDATE memory_authority_selection SET mode=:mode,active_epoch_id=:epoch,
    verified_snapshot_id=NULL,activation_transaction_id=NULL,provider_lineage_id=:lineage,
    replica_checkpoint_digest=:digest,transition_receipt_id=:receipt,updated_at=:now
    WHERE singleton=1 AND active_epoch_id=:previous`).run({ mode: receipt.identity.targetProvider === "local" ? "canonical-local" : "hindsight",
    epoch: receipt.newEpochId, lineage: receipt.identity.targetLineageId, digest: transitionLocalHash(publication.checkpoints),
    receipt: receipt.receiptId, now: receipt.committedAt, previous: receipt.identity.predecessorEpochId });
  if (changed.changes !== 1) invalid();
}
function verifyInstalledLocal(db: Database, candidate: ReturnType<typeof readTransitionPublicationBoundary>["candidate"]): void {
  const actual = discoverTransitionLocal(db, candidate.targetEpochId).state;
  // Revision snapshots are freshly materialized by the installer, not copied receipts. Logical representations must
  // nevertheless be byte-for-byte the verified candidate before any observer can see the new authority.
  for (const key of ["banks", "sources", "records", "derived", "blocks", "historicalReferences", "sourceAliases", "sourceSets"] as const) {
    if (transitionLocalHash(actual[key]) !== transitionLocalHash(candidate.state[key])) invalid();
  }
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
