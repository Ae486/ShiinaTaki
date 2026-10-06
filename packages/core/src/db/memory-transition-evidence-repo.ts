/**
 * INPUT:  lease-bound final proofs, committed authority receipts and factual terminal results
 * OUTPUT: hash-verified append-only evidence with receipt-based read-only recovery
 * POS:    core/db — W4 must publish authority/custody and insert its receipt in one outer transaction
 */
import { MemoryTransitionFinalProofSchema, MemoryTransitionReceiptSchema, MemoryTransitionResultSchema,
  type MemoryTransitionFinalProof, type MemoryTransitionReceipt, type MemoryTransitionResult } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readTransitionIntent, requireTransitionLease, writeAttempt, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";

export function readTransitionProof(db: Database, evidenceId: string): MemoryTransitionFinalProof | undefined {
  const row = db.prepare("SELECT transition_id,proof_json FROM memory_transition_evidence WHERE evidence_id=:id").get({ id: evidenceId });
  if (!row) return undefined;
  const proof = MemoryTransitionFinalProofSchema.parse(JSON.parse(String(row.proof_json)));
  if (proof.transitionId !== row.transition_id || canonicalPayloadHash(["taki-transition-proof.v1", proof]) !== evidenceId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return proof;
}
export function recordTransitionProof(db: Database, input: { lease: TransitionLease; now: string; proof: MemoryTransitionFinalProof }): string {
  const proof = MemoryTransitionFinalProofSchema.parse(input.proof);
  const evidenceId = canonicalPayloadHash(["taki-transition-proof.v1", proof]);
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input);
    const intent = readTransitionIntent(db, attempt.transitionId);
    const previous = attempt.lastEvidenceId ? readTransitionProof(db, attempt.lastEvidenceId) : undefined;
    const recoveryProof = attempt.phase === "proven" && previous && previous.generation < attempt.generation;
    if (!intent || (attempt.phase !== "fenced" && !recoveryProof) || attempt.cutoffSequence === null || proof.transitionId !== intent.transitionId || proof.attemptId !== attempt.attemptId
      || proof.generation !== attempt.generation || proof.cutoffSequence !== attempt.cutoffSequence
      || canonicalJson(proof.identity) !== canonicalJson(intent.request.expected) || proof.incidentId !== intent.incidentId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const prior = readTransitionProof(db, evidenceId);
    if (!prior) db.prepare("INSERT INTO memory_transition_evidence VALUES (:id,:transition,:json)")
      .run({ id: evidenceId, transition: proof.transitionId, json: canonicalJson(proof) });
    writeAttempt(db, attempt, { ...attempt, lastEvidenceId: evidenceId, revision: attempt.revision + 1 });
  });
  return evidenceId;
}

export function readTransitionReceipt(db: Database, transitionId: string): MemoryTransitionReceipt | undefined {
  const row = db.prepare("SELECT receipt_id,receipt_json FROM memory_transition_receipts WHERE transition_id=:id").get({ id: transitionId });
  if (!row) return undefined;
  const value = MemoryTransitionReceiptSchema.parse(JSON.parse(String(row.receipt_json)));
  const { receiptId, ...body } = value;
  const proof = readTransitionProof(db, value.proofId);
  const intent = readTransitionIntent(db, transitionId);
  if (!intent || receiptId !== row.receipt_id || value.operationId !== intent.operationId || value.requestId !== intent.request.requestId
    || value.kind !== intent.request.kind || canonicalJson(value.identity) !== canonicalJson(intent.request.expected)
    || value.transitionId !== transitionId || receiptId !== canonicalPayloadHash(["taki-transition-receipt.v1", body]) || !proof
    || proof.transitionId !== transitionId || canonicalJson(proof.identity) !== canonicalJson(value.identity)
    || proof.mappingHash !== value.mappingHash || proof.cutoffSequence !== value.cutoffSequence) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return value;
}

/** Does not publish authority. W4 calls this inside its authority/custody COMMIT transaction; wrong publication refuses. */
export function recordTransitionReceipt(db: Database, input: { lease: TransitionLease; now: string; receipt: MemoryTransitionReceipt }): void {
  const receipt = MemoryTransitionReceiptSchema.parse(input.receipt);
  const { receiptId, ...body } = receipt;
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input);
    const intent = readTransitionIntent(db, attempt.transitionId);
    const proof = readTransitionProof(db, receipt.proofId);
    if (!intent || !proof || attempt.phase !== "proven" || receiptId !== canonicalPayloadHash(["taki-transition-receipt.v1", body])
      || receipt.transitionId !== intent.transitionId || receipt.operationId !== intent.operationId || receipt.requestId !== intent.request.requestId
      || receipt.kind !== intent.request.kind || canonicalJson(receipt.identity) !== canonicalJson(intent.request.expected)
      || receipt.proofId !== attempt.lastEvidenceId || proof.transitionId !== intent.transitionId || proof.attemptId !== attempt.attemptId
      || proof.generation !== attempt.generation || receipt.mappingHash !== proof.mappingHash || receipt.cutoffSequence !== attempt.cutoffSequence) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const epoch = db.prepare(`SELECT e.* FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e
      ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1`).get();
    if (!epoch || epoch.epoch_id !== receipt.newEpochId || epoch.predecessor_epoch_id !== receipt.identity.predecessorEpochId
      || epoch.provider_id !== receipt.identity.targetProvider || epoch.provider_lineage_id !== receipt.identity.targetLineageId || epoch.status !== "active") throw new Error("MEMORY_TRANSITION_STALE");
    const prior = readTransitionReceipt(db, receipt.transitionId);
    if (prior && canonicalJson(prior) !== canonicalJson(receipt)) throw new Error("MEMORY_TRANSITION_CONFLICT");
    if (!prior) db.prepare("INSERT INTO memory_transition_receipts VALUES (:id,:transition,:json)")
      .run({ id: receiptId, transition: receipt.transitionId, json: canonicalJson(receipt) });
    writeAttempt(db, attempt, { ...attempt, phase: "committed", revision: attempt.revision + 1 });
  });
}

export function readTransitionResult(db: Database, transitionId: string): MemoryTransitionResult | undefined {
  const row = db.prepare("SELECT result_json FROM memory_transition_results WHERE transition_id=:id").get({ id: transitionId });
  if (!row) return undefined;
  const result = MemoryTransitionResultSchema.parse(JSON.parse(String(row.result_json)));
  if (result.transitionId !== transitionId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return result;
}

/** Unknown is immutable historical evidence and keeps fencing closed. Later repair needs a new operation, not rewriting this result. */
export function settleTransition(db: Database, input: { lease: TransitionLease; now: string; result: MemoryTransitionResult }): void {
  const result = MemoryTransitionResultSchema.parse(input.result);
  // Successful completion additionally needs exact source release/retirement proof through resolveTransition().
  if (result.outcome === "completed" || result.outcome === "cancelled") throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  db.transaction(() => {
    const prior = readTransitionResult(db, result.transitionId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(result)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    const attempt = requireTransitionLease(db, input);
    const receipt = readTransitionReceipt(db, attempt.transitionId);
    if (result.transitionId !== attempt.transitionId || result.receiptId !== (receipt?.receiptId ?? null)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const unresolved = db.prepare(`SELECT count(*) AS n FROM memory_transition_queue q LEFT JOIN memory_transition_queue_results r
      ON r.intent_id=q.intent_id WHERE q.transition_id=:id AND (r.intent_id IS NULL OR json_extract(r.outcome_json,'$.status')='outcome_unknown')`).get({ id: attempt.transitionId });
    if ((result.queue === "settled") !== (Number(unresolved?.n) === 0)) throw new Error("MEMORY_TRANSITION_CONFLICT");
    db.prepare("INSERT INTO memory_transition_results VALUES (:id,:json)").run({ id: result.transitionId, json: canonicalJson(result) });
    // A claimed phase is not proof that no external work started. Only an explicit resolution can release
    // its obligations; even a factual failure while draining may leave a native fence awaiting reconciliation.
  });
}
