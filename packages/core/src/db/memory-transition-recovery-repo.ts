/**
 * INPUT:  an explicit new recovery operation and identity-bound factual release/retirement evidence
 * OUTPUT: append-only recovery admissions and resolutions; old unknown operation history remains intact
 * POS:    core/db — recovery storage, no automatic effect replay or native fence release
 */
import { MemoryTransitionRecoverySchema, MemoryTransitionResolutionSchema, type MemoryTransitionRecovery, type MemoryTransitionResolution } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { assertTransitionPredecessor, readTransitionAttempt, readTransitionIntent, requireTransitionLease, writeAttempt, type TransitionLease } from "./memory-transition-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import type { Database } from "./sqlite.ts";
import { readTransitionUndispatched } from "./memory-transition-undispatched.ts";
import { transitionIsQuarantined } from "./memory-transition-emergency-quarantine.ts";
import { readVerifiedEmergencyPublication } from "./memory-transition-emergency-publication.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";

export function readTransitionRecovery(db: Database, operationId: string): MemoryTransitionRecovery | undefined {
  const row = db.prepare("SELECT recovery_json FROM memory_transition_recoveries WHERE operation_id=:id").get({ id: operationId });
  return row ? MemoryTransitionRecoverySchema.parse(JSON.parse(String(row.recovery_json))) : undefined;
}
export function findTransitionRecovery(db: Database, requestId: string): MemoryTransitionRecovery | undefined {
  const row = db.prepare("SELECT recovery_json FROM memory_transition_recoveries WHERE request_id=:id").get({ id: requestId });
  return row ? MemoryTransitionRecoverySchema.parse(JSON.parse(String(row.recovery_json))) : undefined;
}
export function admitTransitionRecovery(db: Database, value: MemoryTransitionRecovery): void {
  const recovery = MemoryTransitionRecoverySchema.parse(value);
  db.transaction(() => {
    const prior = findTransitionRecovery(db, recovery.request.requestId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(recovery)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    const intent = readTransitionIntent(db, recovery.transitionId); const attempt = readTransitionAttempt(db, recovery.transitionId);
    if (transitionIsQuarantined(db, recovery.transitionId)) throw new Error("MEMORY_TRANSITION_STALE");
    const receipt = readTransitionReceipt(db, recovery.transitionId);
    const original = intent ? db.prepare("SELECT terminal_at FROM memory_operations WHERE operation_id=:id").get({ id: intent.operationId }) : undefined;
    if (!intent || !attempt || attempt.phase === "terminal" || !original?.terminal_at || recovery.request.kind !== intent.request.kind
      || canonicalJson(recovery.request.expected) !== canonicalJson(intent.request.expected)
      || recovery.request.recovery?.expectedGeneration !== attempt.generation
      || recovery.request.recovery.expectedReceiptId !== (receipt?.receiptId ?? null)) throw new Error("MEMORY_TRANSITION_STALE");
    if (!receipt) assertTransitionPredecessor(db, intent);
    else if (db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get()?.active_epoch_id !== receipt.newEpochId) throw new Error("MEMORY_TRANSITION_STALE");
    const operation = db.prepare("SELECT state,request_json,producer_json FROM memory_operations WHERE operation_id=:id").get({ id: recovery.operationId });
    if (!operation || operation.state !== "admitted" || canonicalJson(JSON.parse(String(operation.request_json))) !== canonicalJson(recovery.request)
      || JSON.parse(String(operation.producer_json)).transitionId !== recovery.transitionId) throw new Error("MEMORY_TRANSITION_CONFLICT");
    db.prepare("INSERT INTO memory_transition_recoveries VALUES (:operation,:request,:transition,:json)")
      .run({ operation: recovery.operationId, request: recovery.request.requestId, transition: recovery.transitionId, json: canonicalJson(recovery) });
  });
}

export function readTransitionResolution(db: Database, operationId: string): MemoryTransitionResolution | undefined {
  const row = db.prepare("SELECT resolution_id,transition_id,resolution_json FROM memory_transition_resolutions WHERE operation_id=:id").get({ id: operationId });
  if (!row) return undefined;
  const value = MemoryTransitionResolutionSchema.parse(JSON.parse(String(row.resolution_json)));
  const { resolutionId, ...body } = value;
  if (value.operationId !== operationId || value.transitionId !== row.transition_id || resolutionId !== row.resolution_id
    || resolutionId !== canonicalPayloadHash(["taki-transition-resolution.v1", body])) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return value;
}

/** External native receipt verification belongs to W2/W5. Only exact proven release can remove the durable exclusion. */
export function resolveTransition(db: Database, input: { lease: TransitionLease; now: string; resolution: MemoryTransitionResolution }): void {
  const resolution = MemoryTransitionResolutionSchema.parse(input.resolution);
  db.transaction(() => {
    const prior = readTransitionResolution(db, resolution.operationId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(resolution)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    const attempt = requireTransitionLease(db, input);
    validateResolution(db, { resolution, attempt });
    const pending = db.prepare(`SELECT count(*) AS n FROM memory_transition_queue q LEFT JOIN memory_transition_queue_results r
      ON r.intent_id=q.intent_id WHERE q.transition_id=:id AND r.intent_id IS NULL`).get({ id: attempt.transitionId });
    if (Number(pending?.n) !== 0) throw new Error("MEMORY_TRANSITION_CONFLICT");
    db.prepare("INSERT INTO memory_transition_resolutions VALUES (:id,:operation,:transition,:json)").run({ id: resolution.resolutionId,
      operation: resolution.operationId, transition: resolution.transitionId, json: canonicalJson(resolution) });
    writeAttempt(db, attempt, { ...attempt, phase: "terminal", revision: attempt.revision + 1 });
  });
}

function validateResolution(db: Database, input: { resolution: MemoryTransitionResolution; attempt: TransitionLease }): void {
  const { resolution, attempt } = input; const { resolutionId, ...body } = resolution;
  const intent = readTransitionIntent(db, attempt.transitionId); const receipt = readTransitionReceipt(db, attempt.transitionId);
  const release = resolution.release;
  if (!intent || resolutionId !== canonicalPayloadHash(["taki-transition-resolution.v1", body]) || resolution.operationId !== attempt.operationId
    || resolution.transitionId !== attempt.transitionId || release.attemptId !== attempt.attemptId || release.generation !== attempt.generation
    || resolution.result.receiptId !== (receipt?.receiptId ?? null)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const expected = intent.request.expected.banks.map((bank) => [bank.sourceBankId, bank.nativeGeneration]).sort();
  const actual = release.banks.map((bank) => [bank.sourceBankId, bank.nativeGeneration]).sort();
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  if (release.disposition === "source-aborted") {
    if (receipt || resolution.result.runtime !== "source") throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    assertTransitionPredecessor(db, intent);
  } else if (!receipt || resolution.result.runtime !== "ready"
    || db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get()?.active_epoch_id !== receipt.newEpochId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  if (release.disposition === "offline-quarantined") {
    if (intent.request.kind !== "transition.emergency-local" || !receipt || !intent.incidentId || release.incidentId !== intent.incidentId
      || release.banks.some((bank) => bank.dispatch !== "offline-quarantined" || bank.outcomeReceiptId !== null || bank.fenceId !== null)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const publication = readVerifiedEmergencyPublication(db, receipt.receiptId);
    if (release.proofHash !== transitionLocalHash(publication) || release.banks.some((bank) => bank.proofHash !== publication.incidentHash)) {
      throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    }
  } else {
    if (release.incidentId !== null || release.banks.some((bank) => bank.dispatch === "offline-quarantined")) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    for (const bank of release.banks) {
      if (bank.dispatch !== "never-dispatched") {
        if (bank.fenceId === null) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
        continue;
      }
      const admitted = intent.request.expected.banks.find((entry) => entry.sourceBankId === bank.sourceBankId);
      const nativeId = admitted?.nativeBankId ?? admitted?.targetBankId;
      const evidence = nativeId ? readTransitionUndispatched(db, attempt.transitionId, nativeId) : undefined;
      if (receipt || release.disposition !== "source-aborted" || !evidence || evidence.evidenceId !== bank.proofHash) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    }
  }
}
