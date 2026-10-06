/**
 * INPUT:  live W1 owner and persisted W3 candidate/native proof plus actual source journals
 * OUTPUT: independently reconstructed final W1 proof and exact current publication boundary
 * POS:    core/db — synchronous preparation/final COMMIT guard; caller DTOs never substitute for stored evidence
 */
import { MemoryTransitionFinalProofSchema, type MemoryTransitionCandidate, type MemoryTransitionFinalProof } from "@taki/shared";
import { readVerifiedTransitionCandidate } from "../memory/transitions/transition-final-mapping.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readMemoryAuthoritySelection, verifyCanonicalLocalReceipt } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { readTransitionNativeEvidence } from "./memory-transition-candidate-repo.ts";
import { assertTransitionLocalCurrent, readTransitionLocalCapture, type TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import { assertTransitionPredecessor, readTransitionIntent, requireTransitionLease } from "./memory-transition-repo.ts";
import { readTransitionCustody } from "./memory-transition-custody.ts";
import { classifyTransitionSources } from "./memory-transition-source-disposition.ts";
import { readTransitionQueue } from "./memory-transition-queue-repo.ts";
import type { Database } from "./sqlite.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";

export function readTransitionPublicationBoundary(db: Database, input: TransitionCaptureInput & { candidateId: string }, context?: TransitionEvidenceContext) {
  return withTransitionEvidenceContext(db, (verification) => readPublicationBoundary(db, input, verification), context);
}
function readPublicationBoundary(db: Database, input: TransitionCaptureInput & { candidateId: string }, verification: TransitionEvidenceContext) {
  db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=active_epoch_id WHERE singleton=1").run();
  const attempt = requireTransitionLease(db, input); const intent = readTransitionIntent(db, attempt.transitionId);
  if (!intent || !["fenced", "proven"].includes(attempt.phase) || attempt.cutoffSequence === null || intent.incidentId !== null) invalid();
  assertTransitionPredecessor(db, intent); input.assertConfiguration();
  const selection = readMemoryAuthoritySelection(db);
  if (selection.epochId !== intent.request.expected.predecessorEpochId) invalid();
  if (selection.mode === "canonical-local") verifyCanonicalLocalReceipt(db, selection);
  const candidate = readVerifiedTransitionCandidate(db, input.candidateId, verification);
  if (candidate.transitionId !== intent.transitionId || candidate.predecessorEpochId !== selection.epochId) invalid();
  if (candidate.localCaptureId) assertTransitionLocalCurrent(db, readTransitionLocalCapture(db, candidate.localCaptureId));
  requireTransitionConfiguration(db, intent.request.expected, candidate);
  const custody = readTransitionCustody(db, candidate.predecessorEpochId);
  const sourceDispositions = classifyTransitionSources(db, candidate);
  const queue = readTransitionQueue(db, intent.transitionId).map(({ intentId, replayId, sequence, commandHash }) => ({ intentId, replayId, sequence, commandHash }));
  if (queue.length !== attempt.cutoffSequence || queue.some((row, index) => row.sequence !== index + 1)) invalid();
  const banks = transitionPublicationBanks(db, candidate, { identity: intent.request.expected, verification });
  const proof = MemoryTransitionFinalProofSchema.parse({ version: 1, transitionId: intent.transitionId,
    attemptId: attempt.attemptId, generation: attempt.generation, identity: intent.request.expected,
    fencedManifestHash: candidate.stateHash, mappingHash: candidate.mappingHash, custodyBoundaryHash: transitionLocalHash(custody),
    cutoffSequence: attempt.cutoffSequence, unresolvedSourceHash: transitionLocalHash(sourceDispositions), banks,
    incidentId: null, incidentHash: null, backupId: null, recordedAt: input.now });
  return { intent, attempt, candidate, custody, sourceDispositions, queue, proof };
}

/** Boot reconstructs the native join too; a self-consistent Core hash cannot substitute a different native proof. */
export function transitionPublicationBanks(db: Database, candidate: MemoryTransitionCandidate,
  input: { identity: MemoryTransitionFinalProof["identity"]; verification?: TransitionEvidenceContext }) {
  const { identity, verification } = input;
  if (candidate.scopes.length !== identity.banks.length) invalid();
  return identity.banks.map((bank) => {
    const scope = candidate.scopes.find((row) => transitionLocalHash(row.scope) === transitionLocalHash(bank.scope));
    const unused = identity.sourceProvider === "local" && bank.nativeBankId === null && bank.nativeGeneration === null;
    if (!scope || (unused ? scope.origin !== "new" || scope.nativeBankId !== bank.targetBankId
      : scope.nativeBankId !== bank.nativeBankId || scope.nativeGeneration !== bank.nativeGeneration)
      || bank.sourceBankId !== (identity.sourceProvider === "local" ? scope.localBankId : scope.nativeBankId)
      || bank.targetBankId !== null && bank.targetBankId !== (identity.targetProvider === "local" ? scope.localBankId : scope.nativeBankId)) invalid();
    const evidence = readTransitionNativeEvidence(db, scope.evidenceId, verification); const proof = evidence.status.proof;
    if (!proof || unused !== (evidence.status.request.unused_scope !== null)
      || evidence.status.request.transition_id !== candidate.transitionId
      || proof.provider_lineage !== (identity.sourceProvider === "hindsight" ? identity.sourceLineageId : identity.targetLineageId)
      || evidence.status.request.direction !== (identity.targetProvider === "local" ? "return-local" : "reenter-hindsight")) invalid();
    return { sourceBankId: bank.sourceBankId,
      manifestHash: transitionLocalHash([proof.native_records_hash, proof.application_records_hash, proof.auxiliary_records_hash]),
      mappingHash: transitionLocalHash(candidate.mappings.filter((row) => row.localBankId === scope.localBankId)),
      native: { protocol: "taki-transition-v1" as const, fenceId: proof.executor.fence_token,
        holderGeneration: proof.executor.generation, certificateId: proof.certificate_id,
        nativeSnapshotId: proof.native_snapshot.snapshot_id, nativeCursor: proof.native_snapshot.manifest.end_cursor,
        applicationSnapshotId: proof.application_snapshot.snapshot_id, applicationCursor: proof.application_snapshot.checkpoint.state_cursor,
        nativeGeneration: proof.bank_generation, maintenanceInputHash: proof.maintenance_input_hash,
        maintenanceOutcomeHash: proof.maintenance_outcome_hash, proofHash: proof.proof_hash } };
  });
}

/** Call while fenced to create the W1 proof, then compare the same facts immediately before publication. */
export function buildTransitionPublicationProof(db: Database, input: TransitionCaptureInput & { candidateId: string }): MemoryTransitionFinalProof {
  let proof: MemoryTransitionFinalProof | undefined;
  db.transaction(() => { proof = readTransitionPublicationBoundary(db, input).proof; });
  if (!proof) invalid(); return proof;
}

function requireTransitionConfiguration(db: Database, expected: MemoryTransitionFinalProof["identity"], candidate: MemoryTransitionCandidate): void {
  const connection = db.prepare("SELECT revision,config_fingerprint,phase FROM hindsight_connection_state WHERE singleton=1").get();
  if (!connection || connection.revision !== expected.configRevision || connection.config_fingerprint !== expected.configFingerprint
    || connection.revision !== expected.inventoryRevision || connection.phase !== "configured") throw new Error("MEMORY_TRANSITION_STALE");
  const rows = db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all();
  if (rows.length !== candidate.scopes.length || rows.some((row) => row.status !== "verified"
    || !candidate.scopes.some((scope) => scope.nativeBankId === row.external_bank_id
      && row.canonical_identity === (scope.scope.kind === "global" ? "global" : `character:${scope.scope.characterId}`)))) {
    throw new Error("MEMORY_TRANSITION_STALE");
  }
  if (canonicalPayloadHash(rows) !== expected.inventoryHash) throw new Error("MEMORY_TRANSITION_STALE");
  // A newly imported/used Character can have primary custody without a Bank while writers are fenced. Setup rows
  // alone therefore cannot prove complete logical coverage. Refuse this attempt until its actual scope is admitted.
  const characters = db.prepare(`SELECT character_id FROM timeline_messages UNION
    SELECT character_id FROM primary_memory_groups WHERE assigned_epoch_id=:epoch UNION
    SELECT character_id FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND scope_kind='character' UNION
    SELECT character_id FROM taki_memory_blocks WHERE scope_kind='character'`).all({ epoch: expected.predecessorEpochId });
  if (characters.some((row) => !candidate.scopes.some((scope) => scope.scope.kind === "character"
    && scope.scope.characterId === row.character_id))) throw new Error("MEMORY_TRANSITION_STALE");
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
