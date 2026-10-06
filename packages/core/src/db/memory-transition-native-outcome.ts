/**
 * INPUT:  actual native historical outcome after Core COMMIT and the exact persisted transition proof
 * OUTPUT: durable per-Bank native finalization and a fail-closed target-writer readiness check
 * POS:    core/db — native activation remains separate from Core receipt, runtime construction and queue settlement
 */
import { HindsightTransitionStatusSchema, type HindsightTransitionStatus, type MemoryTransitionResolution } from "@taki/shared";
import { validateHindsightTransitionStatus } from "../memory/hindsight/hindsight-transition-proof.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readTransitionCandidate, readTransitionNativeEvidence } from "./memory-transition-candidate-repo.ts";
import { requireTransitionLease, readTransitionIntent, assertTransitionPredecessor, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";
import { readTransitionUndispatched } from "./memory-transition-undispatched.ts";

export function recordTransitionNativeOutcome(db: Database, input: { lease: TransitionLease; now: string; status: HindsightTransitionStatus }): void {
  db.transaction(() => {
    requireTransitionLease(db, input);
    verifyOutcome(db, input.lease.transitionId, input.status);
    const prior = readStoredOutcome(db, input.lease.transitionId, input.status.bank_id);
    if (prior) {
      if (outcomeIdentity(prior) !== outcomeIdentity(input.status)) invalid();
      return;
    }
    db.prepare("INSERT INTO memory_transition_native_outcomes VALUES(:transition,:bank,:json)")
      .run({ transition: input.lease.transitionId, bank: input.status.bank_id, json: JSON.stringify(input.status) });
  });
}

export function requireTransitionTargetReady(db: Database, epochId: string): void {
  const marker = db.prepare("SELECT transition_receipt_id,active_epoch_id,mode FROM memory_authority_selection WHERE singleton=1").get();
  if (marker?.transition_receipt_id == null || marker.mode !== "hindsight") return;
  if (marker.active_epoch_id !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const publication = db.prepare("SELECT transition_id,candidate_id FROM memory_transition_publications WHERE receipt_id=:id")
    .get({ id: String(marker.transition_receipt_id) });
  if (!publication) invalid();
  const candidate = readTransitionCandidate(db, String(publication.candidate_id));
  for (const scope of candidate.scopes) {
    const status = readStoredOutcome(db, String(publication.transition_id), scope.nativeBankId);
    if (!status) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    verifyOutcome(db, String(publication.transition_id), status);
  }
}

function verifyOutcome(db: Database, transitionId: string, status: HindsightTransitionStatus): void {
  validateHindsightTransitionStatus(status, { transitionId, bankId: status.bank_id });
  const receipt = readTransitionReceipt(db, transitionId);
  if (!receipt) { verifyAbort(db, transitionId, status); return; }
  const row = db.prepare("SELECT candidate_id FROM memory_transition_publications WHERE transition_id=:id").get({ id: transitionId });
  if (!receipt || !row) invalid();
  const candidate = readTransitionCandidate(db, String(row.candidate_id));
  const scope = candidate.scopes.find((entry) => entry.nativeBankId === status.bank_id);
  if (!scope) invalid();
  const original = readTransitionNativeEvidence(db, scope.evidenceId).status;
  const action = receipt.identity.targetProvider === "hindsight" ? "activate" : "retire";
  if (!status.outcome || status.outcome.request.disposition !== action || status.outcome.request.core_receipt_id !== receipt.receiptId
    || status.outcome.request.proof_hash !== original.proof?.proof_hash || status.outcome.resolution !== "committed"
    || status.phase !== (action === "activate" ? "active" : "retired")
    || transitionLocalHash(status.request) !== transitionLocalHash(original.request)
    || transitionLocalHash(status.proof) !== transitionLocalHash(original.proof)) invalid();
}

function verifyAbort(db: Database, transitionId: string, status: HindsightTransitionStatus): void {
  const intent = readTransitionIntent(db, transitionId); if (!intent) invalid();
  assertTransitionPredecessor(db, intent);
  const expected = intent.request.expected;
  const bank = expected.banks.find((entry) => (entry.nativeBankId ?? entry.targetBankId) === status.bank_id);
  const outcome = status.outcome;
  if (!bank || !outcome || status.request.provider_lineage !== (expected.sourceProvider === "hindsight" ? expected.sourceLineageId : expected.targetLineageId)
    || (bank.nativeGeneration === null ? !status.request.unused_scope
      || status.request.unused_scope.bank_generation !== status.request.bank_generation : status.request.bank_generation !== bank.nativeGeneration)
    || outcome.request.disposition !== "abort"
    || outcome.request.core_receipt_id !== null || status.request.direction !== (expected.sourceProvider === "hindsight" ? "return-local" : "reenter-hindsight")) invalid();
  if (expected.sourceProvider === "hindsight") {
    if (status.phase !== "aborted" || outcome.resolution !== "source_resumed") invalid();
  } else if (status.request.unused_scope) {
    if (status.phase !== "quarantined" || outcome.resolution !== "unused_baseline_held"
      || outcome.restored_baseline_hash !== status.request.unused_scope.proof_hash) invalid();
  } else if (status.phase !== "aborted" || outcome.resolution !== "retired_baseline_restored"
    || outcome.restored_baseline_hash !== status.request.baseline_proof_hash) invalid();
}

/** The W5 driver uses this factual release after every Bank's actual resolve response has been stored. */
export function readTransitionNativeRelease(db: Database, input: {
  lease: Pick<TransitionLease, "transitionId" | "attemptId" | "generation">; now: string;
}): MemoryTransitionResolution["release"] {
  const intent = readTransitionIntent(db, input.lease.transitionId); if (!intent) invalid();
  const receipt = readTransitionReceipt(db, intent.transitionId);
  const banks = intent.request.expected.banks.map((bank) => {
    const bankId = bank.nativeBankId ?? bank.targetBankId;
    const undispatched = bankId ? readTransitionUndispatched(db, intent.transitionId, bankId) : undefined;
    if (undispatched) {
      if (receipt || undispatched.sourceBankId !== bank.sourceBankId) invalid();
      assertTransitionPredecessor(db, intent);
      return { sourceBankId: bank.sourceBankId, nativeGeneration: bank.nativeGeneration, fenceId: null,
        outcomeReceiptId: null, proofHash: undispatched.evidenceId, dispatch: "never-dispatched" as const };
    }
    const status = readStoredOutcome(db, intent.transitionId, bankId);
    if (!status) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    verifyOutcome(db, intent.transitionId, status);
    return { sourceBankId: bank.sourceBankId, nativeGeneration: bank.nativeGeneration,
      fenceId: status.executor.fence_token, outcomeReceiptId: status.outcome!.outcome_hash,
      proofHash: status.proof?.proof_hash ?? status.outcome!.outcome_hash };
  });
  return { protocol: "taki-transition-v1", attemptId: input.lease.attemptId, generation: input.lease.generation,
    disposition: receipt ? "source-retired" : "source-aborted", proofHash: transitionLocalHash(banks), banks,
    incidentId: null, recordedAt: input.now };
}
/** A valid native receipt from another admitted Bank cannot discharge this stored Bank's own obligation. */
function readStoredOutcome(db: Database, transitionId: string, bankId: string | null): HindsightTransitionStatus | undefined {
  if (bankId === null) invalid();
  const row = db.prepare("SELECT status_json FROM memory_transition_native_outcomes WHERE transition_id=:id AND bank_id=:bank")
    .get({ id: transitionId, bank: bankId });
  if (!row) return undefined;
  const status = HindsightTransitionStatusSchema.parse(JSON.parse(String(row.status_json)));
  if (status.bank_id !== bankId || status.request.transition_id !== transitionId) invalid();
  return status;
}
function outcomeIdentity(status: HindsightTransitionStatus): string {
  return transitionLocalHash({ request: status.request, proof: status.proof, outcome: status.outcome });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
