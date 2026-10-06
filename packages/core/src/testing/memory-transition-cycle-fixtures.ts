/**
 * INPUT:  a real W4 publication fixture and deterministic per-Bank native evidence
 * OUTPUT: successive genuine W4 receipts, W3 candidates and positive synthetic native outcomes
 * POS:    core/testing — exercises production Core commits; native maintenance remains a separate W5 acceptance gate
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionStatusSchema, type MemoryTransitionCandidate, type MemoryTransitionIntent, type MemoryTransitionNativeEvidence, type MemoryTransitionReceipt } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { TransitionCaptureInput } from "../db/memory-transition-local-capture.ts";
import { captureTransitionLocal } from "../db/memory-transition-local-capture.ts";
import { readTransitionCustody } from "../db/memory-transition-custody.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionAttempt, updateTransitionAttempt } from "../db/memory-transition-repo.ts";
import { recordTransitionProof } from "../db/memory-transition-evidence-repo.ts";
import { recordTransitionNativeOutcome, readTransitionNativeRelease } from "../db/memory-transition-native-outcome.ts";
import { resolveTransition } from "../db/memory-transition-recovery-repo.ts";
import { createMemoryOperationRepo } from "../db/memory-operation-repo.ts";
import { readVerifiedTransitionPublication } from "../db/memory-transition-publication-reader.ts";
import { buildTransitionPublicationProof } from "../db/memory-transition-publication-proof.ts";
import { publishMemoryTransition } from "../db/memory-transition-publication-repo.ts";
import { persistTransitionNativeEvidence } from "../db/memory-transition-candidate-repo.ts";
import { prepareTransitionDelta, recordTransitionDeltaResult } from "../db/memory-transition-delta-repo.ts";
import { signHindsightTransitionAcquire, hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import { buildTransitionHindsightCandidate } from "../memory/transitions/transition-final-mapping.ts";
import { buildTransitionLocalCandidate } from "../memory/transitions/transition-local-candidate.ts";
import { sealTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { transitionFinalFixture } from "./memory-transition-final-fixtures.ts";
import { transitionOutcomeFixture } from "./memory-transition-outcome-fixtures.ts";
import { transitionUnusedFixture } from "./memory-transition-unused-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { admitFixtureTransition, W3_AT } from "./memory-transition-candidate-fixtures.ts";

export interface TransitionStageFixture {
  db: Database; intent: MemoryTransitionIntent; candidate: MemoryTransitionCandidate;
  proofs: MemoryTransitionNativeEvidence[]; input: TransitionCaptureInput;
}
export function commitTransitionStage(stage: TransitionStageFixture) {
  const proof = buildTransitionPublicationProof(stage.db, { ...stage.input, candidateId: stage.candidate.candidateId });
  recordTransitionProof(stage.db, { ...stage.input, proof });
  stage.input.lease = updateTransitionAttempt(stage.db, { ...stage.input,
    lease: readTransitionAttempt(stage.db, stage.intent.transitionId)!, patch: { phase: "proven" } });
  const receipt = publishMemoryTransition(stage.db, { ...stage.input, candidateId: stage.candidate.candidateId });
  stage.input.lease = readTransitionAttempt(stage.db, stage.intent.transitionId)!;
  return receipt;
}
export function completeTransitionStage(stage: TransitionStageFixture, receipt: MemoryTransitionReceipt) {
  const statuses = stage.proofs.map((proof) => {
    const saved = stage.db.prepare("SELECT status_json FROM memory_transition_native_outcomes WHERE transition_id=:id AND bank_id=:bank")
      .get({ id: stage.intent.transitionId, bank: proof.status.bank_id });
    return saved ? HindsightTransitionStatusSchema.parse(JSON.parse(String(saved.status_json))) : transitionOutcomeFixture(proof.status, receipt.receiptId);
  });
  for (const status of statuses) recordTransitionNativeOutcome(stage.db, { ...stage.input, status });
  const result = { kind: "transition" as const, transitionId: stage.intent.transitionId, receiptId: receipt.receiptId,
    authorityCommitted: true, runtime: "ready" as const, queue: "settled" as const, outcome: "completed" as const, errorCode: null };
  const body = { version: 1 as const, operationId: stage.intent.operationId, transitionId: stage.intent.transitionId,
    result, release: readTransitionNativeRelease(stage.db, stage.input) };
  resolveTransition(stage.db, { ...stage.input, resolution: { ...body,
    resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) } });
  createMemoryOperationRepo(stage.db).transition({ operationId: stage.intent.operationId, expectedState: "running",
    patch: { state: "completed", result } });
  return statuses;
}

function nextIntent(previous: TransitionStageFixture, receipt: MemoryTransitionReceipt, newScope = false): MemoryTransitionIntent {
  const entering = receipt.identity.targetProvider === "local";
  const kind = entering ? "transition.reenter-hindsight" : "transition.return-local";
  const publication = readVerifiedTransitionPublication(previous.db, receipt.receiptId);
  const expected = { ...receipt.identity, predecessorEpochId: receipt.newEpochId,
    sourceProvider: receipt.identity.targetProvider, sourceLineageId: receipt.identity.targetLineageId,
    targetProvider: receipt.identity.sourceProvider, targetLineageId: receipt.identity.sourceLineageId,
    baselineReceiptId: entering ? receipt.receiptId : null, baselineHash: entering ? publication.baselineId : null,
    custodyBoundaryHash: transitionLocalHash(readTransitionCustody(previous.db, receipt.newEpochId)),
    inventoryHash: canonicalPayloadHash(previous.db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all()),
    banks: previous.candidate.scopes.map((scope) => ({ ...receipt.identity.banks.find((bank) => bank.nativeBankId === scope.nativeBankId)!,
      sourceBankId: entering ? scope.localBankId : scope.nativeBankId, targetBankId: entering ? scope.nativeBankId : scope.localBankId })) };
  if (newScope) expected.banks.push({ ...expected.banks[0]!, scope: { kind: "character", characterId: "new-character" },
    sourceBankId: "new-local-bank", targetBankId: "new-native-bank", nativeBankId: null, nativeGeneration: null });
  return { ...previous.intent, transitionId: randomUUID(), operationId: randomUUID(), request: {
    ...previous.intent.request, kind, confirmation: "healthy-switch", requestId: randomUUID(), previewId: randomUUID(), expected,
    previewHash: canonicalPayloadHash(["taki-transition-preview.v1", kind, expected]) } };
}

export function reenterTransitionStage(previous: TransitionStageFixture, receipt: MemoryTransitionReceipt, newScope = false): TransitionStageFixture {
  const { db } = previous;
  if (newScope) {
    createCanonicalMemoryAuthorityRepo(db).createBank({ ...previous.candidate.state.banks[0]!,
      authorityEpochId: receipt.newEpochId, bankId: "new-local-bank", scope: { kind: "character", characterId: "new-character" } });
    const setup = createHindsightBankSetupRepo(db);
    setup.upsert({ ...setup.list()[0]!, scope: "character", canonicalIdentity: "character:new-character", externalBankId: "new-native-bank" });
  }
  const intent = nextIntent(previous, receipt, newScope);
  const input = { lease: admitFixtureTransition(db, intent), now: W3_AT, assertConfiguration: () => undefined };
  const capture = captureTransitionLocal(db, input); const preparationIds: string[] = []; const proofs: MemoryTransitionNativeEvidence[] = [];
  for (const old of previous.proofs) {
    const scope = previous.candidate.scopes.find((row) => row.nativeBankId === old.status.bank_id)!;
    const request = signHindsightTransitionAcquire(scope.nativeBankId, { ...old.status.request, transition_id: intent.transitionId,
      attempt_id: randomUUID(), direction: "reenter-hindsight", baseline_transition_id: previous.intent.transitionId,
      baseline_proof_hash: old.status.proof!.proof_hash });
    const target = { ...old.status, request, phase: "fenced" as const, proof: null,
      executor: { ...old.status.executor, transition_id: intent.transitionId, attempt_id: request.attempt_id, fence_token: randomUUID() } };
    const retired = transitionOutcomeFixture(old.status, receipt.receiptId);
    const prepared = prepareTransitionDelta(db, { ...input, captureId: capture.captureId, localBankId: scope.localBankId, target, retired });
    const final = transitionFinalFixture(prepared, old);
    recordTransitionDeltaResult(db, { ...input, preparationId: prepared.preparationId, result: final.result });
    persistTransitionNativeEvidence(db, { ...input, evidence: final.evidence });
    preparationIds.push(prepared.preparationId); proofs.push(final.evidence);
  }
  if (newScope) {
    const unused = transitionUnusedFixture(intent);
    const prepared = prepareTransitionDelta(db, { ...input, captureId: capture.captureId, localBankId: "new-local-bank",
      target: unused.target, retired: null, unusedInventory: unused.inventory });
    const final = transitionFinalFixture(prepared, unused.evidence);
    recordTransitionDeltaResult(db, { ...input, preparationId: prepared.preparationId, result: final.result });
    persistTransitionNativeEvidence(db, { ...input, evidence: final.evidence });
    preparationIds.push(prepared.preparationId); proofs.push(final.evidence);
  }
  const candidate = buildTransitionHindsightCandidate(db, { ...input, preparationIds, evidenceIds: proofs.map((row) => row.evidenceId) });
  return { db, intent, candidate, proofs, input };
}

export function returnTransitionStage(previous: TransitionStageFixture, receipt: MemoryTransitionReceipt): TransitionStageFixture {
  const { db } = previous; const intent = nextIntent(previous, receipt);
  const input = { lease: admitFixtureTransition(db, intent), now: W3_AT, assertConfiguration: () => undefined };
  const proofs = previous.proofs.map((old) => {
    const value = structuredClone(old);
    const request = signHindsightTransitionAcquire(value.status.bank_id, { ...value.status.request, transition_id: intent.transitionId,
      attempt_id: randomUUID(), direction: "return-local", baseline_transition_id: null, baseline_proof_hash: null, unused_scope: null });
    value.transitionId = intent.transitionId; value.status.request = request;
    value.status.executor = { ...value.status.executor, transition_id: intent.transitionId, attempt_id: request.attempt_id, fence_token: randomUUID() };
    const proof = value.status.proof!;
    proof.certificate_id = intent.transitionId; proof.executor = value.status.executor; proof.request_hash = request.request_hash;
    proof.delta_result_hash = null; proof.unused_scope_hash = null;
    proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1",
      proof: Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")) });
    for (const page of value.maintenancePages) { page.verification_id = intent.transitionId; page.certificate_hash = proof.proof_hash; }
    for (const page of value.auxiliaryPages) { page.transition_id = intent.transitionId; page.proof_hash = proof.proof_hash; }
    return sealTransitionNativeEvidence(value);
  });
  for (const evidence of proofs) persistTransitionNativeEvidence(db, { ...input, evidence });
  const candidate = buildTransitionLocalCandidate(db, { ...input, evidenceIds: proofs.map((row) => row.evidenceId) });
  return { db, intent, candidate, proofs, input };
}
