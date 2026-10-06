/**
 * INPUT:  owned W3 SQLite candidate fixture and its exact native proof envelopes
 * OUTPUT: genuine W1 repository receipt/resolution plus a new fenced Local re-entry intent for W3 tests
 * POS:    core/testing — narrow authority fixture, explicitly not a W4 custody/runtime acceptance journey
 */
import { randomUUID } from "node:crypto";
import type { MemoryTransitionFinalProof, MemoryTransitionIntent, MemoryTransitionReceipt, MemoryTransitionResolution } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { createTransitionCandidateFixture, admitFixtureTransition, W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { persistTransitionNativeEvidence } from "../db/memory-transition-candidate-repo.ts";
import { buildTransitionLocalCandidate } from "../memory/transitions/transition-local-candidate.ts";
import { installTransitionLocalCandidate } from "../db/memory-transition-local-staging.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { recordTransitionProof, recordTransitionReceipt } from "../db/memory-transition-evidence-repo.ts";
import { readTransitionAttempt, updateTransitionAttempt } from "../db/memory-transition-repo.ts";
import { resolveTransition } from "../db/memory-transition-recovery-repo.ts";
import { createMemoryOperationRepo } from "../db/memory-operation-repo.ts";
import { signHindsightTransitionAcquire, hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";

function commitCandidateFixture(db: Database, options: NonNullable<Parameters<typeof createTransitionCandidateFixture>[1]>) {
  const fixture = createTransitionCandidateFixture(db, options);
  for (const evidence of fixture.proofs) persistTransitionNativeEvidence(db, { ...fixture.input, evidence });
  const candidate = buildTransitionLocalCandidate(db, { ...fixture.input, evidenceIds: fixture.proofs.map((row) => row.evidenceId) });
  const proof: MemoryTransitionFinalProof = { version: 1, transitionId: fixture.intent.transitionId,
    attemptId: fixture.lease.attemptId, generation: fixture.lease.generation, identity: fixture.intent.request.expected,
    fencedManifestHash: candidate.stateHash, mappingHash: candidate.mappingHash, custodyBoundaryHash: "a".repeat(64), cutoffSequence: 0,
    unresolvedSourceHash: "a".repeat(64), incidentId: null, incidentHash: null, backupId: null, recordedAt: W3_AT,
    banks: fixture.proofs.map((entry) => ({ sourceBankId: entry.status.bank_id, manifestHash: entry.evidenceId, mappingHash: candidate.mappingHash,
      native: { protocol: "taki-transition-v1", fenceId: entry.status.executor.fence_token, holderGeneration: 1,
        certificateId: fixture.intent.transitionId, nativeSnapshotId: entry.status.proof!.native_snapshot.snapshot_id,
        nativeCursor: entry.status.proof!.native_snapshot.manifest.end_cursor, applicationSnapshotId: entry.status.proof!.application_snapshot.snapshot_id,
        applicationCursor: entry.status.proof!.application_snapshot.checkpoint.state_cursor, nativeGeneration: entry.status.request.bank_generation,
        maintenanceInputHash: entry.status.proof!.maintenance_input_hash, maintenanceOutcomeHash: entry.status.proof!.maintenance_outcome_hash,
        proofHash: entry.status.proof!.proof_hash } })) };
  const proofId = recordTransitionProof(db, { ...fixture.input, proof });
  const lease = updateTransitionAttempt(db, { lease: readTransitionAttempt(db, fixture.intent.transitionId)!, now: W3_AT, patch: { phase: "proven" } });
  const body = { version: 1 as const, transitionId: fixture.intent.transitionId, operationId: fixture.intent.operationId,
    requestId: fixture.intent.request.requestId, kind: fixture.intent.request.kind, identity: fixture.intent.request.expected,
    newEpochId: candidate.targetEpochId, proofId, mappingHash: candidate.mappingHash, custodyAssignmentHash: "a".repeat(64), cutoffSequence: 0, committedAt: W3_AT };
  const receipt: MemoryTransitionReceipt = { ...body, receiptId: canonicalPayloadHash(["taki-transition-receipt.v1", body]) };
  db.transaction(() => {
    db.prepare("INSERT INTO canonical_memory_authority_epochs VALUES(:id,'local',:lineage,'closed',:prior,:at,:at,'planned-switch')")
      .run({ id: candidate.targetEpochId, prior: candidate.predecessorEpochId, lineage: fixture.intent.request.expected.targetLineageId, at: W3_AT });
    installTransitionLocalCandidate(db, candidate.candidateId);
    db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id=:id").run({ at: W3_AT, id: candidate.predecessorEpochId });
    db.prepare("UPDATE canonical_memory_authority_epochs SET status='active',ended_at=NULL WHERE epoch_id=:id").run({ id: candidate.targetEpochId });
    db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:id WHERE singleton=1").run({ id: candidate.targetEpochId });
    recordTransitionReceipt(db, { lease, now: W3_AT, receipt });
  });
  const current = readTransitionAttempt(db, fixture.intent.transitionId)!;
  const result = { kind: "transition" as const, transitionId: fixture.intent.transitionId, receiptId: receipt.receiptId,
    authorityCommitted: true, runtime: "ready" as const, queue: "settled" as const, outcome: "completed" as const, errorCode: null };
  const resolutionBody = { version: 1 as const, operationId: fixture.intent.operationId, transitionId: fixture.intent.transitionId, result,
    release: { protocol: "taki-transition-v1" as const, attemptId: current.attemptId, generation: current.generation, disposition: "source-retired" as const,
      proofHash: "a".repeat(64), incidentId: null, recordedAt: W3_AT, banks: proof.banks.map((bank) => ({ sourceBankId: bank.sourceBankId,
        nativeGeneration: bank.native!.nativeGeneration, fenceId: bank.native!.fenceId, outcomeReceiptId: "fixture-outcome", proofHash: bank.native!.proofHash })) } };
  const resolution: MemoryTransitionResolution = { ...resolutionBody, resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", resolutionBody]) };
  resolveTransition(db, { lease: current, now: W3_AT, resolution });
  createMemoryOperationRepo(db).transition({ operationId: fixture.intent.operationId, expectedState: "running", patch: { state: "completed", result } });
  return { fixture, candidate, receipt };
}
export function createTransitionReentryFixture(db: Database, options: NonNullable<Parameters<typeof createTransitionCandidateFixture>[1]> & { newScope?: boolean } = {}) {
  const { fixture, candidate, receipt } = commitCandidateFixture(db, options);
  const baselineId = String(db.prepare("SELECT id FROM memory_transition_baselines WHERE transition_id=:id").get({ id: fixture.intent.transitionId })!.id);
  if (options.newScope) createCanonicalMemoryAuthorityRepo(db).createBank({ ...candidate.state.banks[0]!, bankId: "new-local-bank",
    scope: { kind: "character", characterId: "new-character" } });
  const expected = { ...fixture.intent.request.expected, predecessorEpochId: candidate.targetEpochId,
    sourceProvider: "local" as const, sourceLineageId: fixture.intent.request.expected.targetLineageId,
    targetProvider: "hindsight" as const, targetLineageId: fixture.intent.request.expected.sourceLineageId,
    baselineReceiptId: receipt.receiptId, baselineHash: baselineId,
    banks: candidate.scopes.map((scope) => ({ ...fixture.intent.request.expected.banks.find((bank) => bank.nativeBankId === scope.nativeBankId)!,
      sourceBankId: scope.localBankId, targetBankId: scope.nativeBankId })) };
  if (options.newScope) expected.banks.push({ ...expected.banks[0]!, scope: { kind: "character", characterId: "new-character" },
    sourceBankId: "new-local-bank", targetBankId: "new-native-bank", nativeBankId: null, nativeGeneration: null });
  const intent: MemoryTransitionIntent = { ...fixture.intent, transitionId: randomUUID(), operationId: randomUUID(),
    request: { ...fixture.intent.request, kind: "transition.reenter-hindsight", confirmation: "healthy-switch", requestId: randomUUID(), expected,
      previewHash: canonicalPayloadHash(["taki-transition-preview.v1", "transition.reenter-hindsight", expected]) } };
  const nextLease = admitFixtureTransition(db, intent);
  const targets = fixture.proofs.map((entry) => {
    const request = signHindsightTransitionAcquire(entry.status.bank_id, { ...entry.status.request, transition_id: intent.transitionId,
      attempt_id: randomUUID(), direction: "reenter-hindsight", baseline_transition_id: fixture.intent.transitionId,
      baseline_proof_hash: entry.status.proof!.proof_hash });
    const target = { ...entry.status, request, phase: "fenced" as const, proof: null,
      executor: { ...entry.status.executor, transition_id: intent.transitionId, attempt_id: request.attempt_id, fence_token: randomUUID() } };
    const outcome = { request: { executor: entry.status.executor, disposition: "retire" as const, decision_id: randomUUID(), decision_hash: "a".repeat(64),
      core_receipt_id: receipt.receiptId, proof_hash: entry.status.proof!.proof_hash }, bank_id: entry.status.bank_id,
      provider_lineage: entry.status.request.provider_lineage, bank_generation: entry.status.request.bank_generation,
      phase: "retired" as const, resolution: "committed" as const, restored_baseline_hash: null, recorded_at: W3_AT };
    return { target, retired: { ...entry.status, phase: "retired" as const,
      outcome: { ...outcome, outcome_hash: hindsightTransitionHash(outcome) } } };
  });
  return { ...fixture, candidate, receipt, baselineId, intent, targets, lease: nextLease,
    input: { lease: nextLease, now: W3_AT, assertConfiguration: () => undefined } };
}
