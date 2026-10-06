/**
 * INPUT:  parsed transition requests, immutable provider proofs and delta receipts
 * OUTPUT: native-compatible hashes and exact identity checks before Core consumption
 * POS:    Core transition client evidence — validates wire truth, never selects authority
 */
import { createHash } from "node:crypto";
import { hindsightCurrentStateJson, HindsightTransitionAcquireSchema, HindsightTransitionDeltaRequestSchema,
  type HindsightTransitionAcquire, type HindsightTransitionDeltaRequest, type HindsightTransitionStatus,
  type HindsightTransitionDeltaResult, type HindsightTransitionUnusedScope } from "@taki/shared";
import { hindsightError } from "./hindsight-errors.ts";
import { withoutApplicationHash } from "./hindsight-application-integrity.ts";

export function hindsightTransitionHash(value: unknown): string {
  return createHash("sha256").update(hindsightCurrentStateJson(value)).digest("hex");
}
export function signHindsightTransitionAcquire(bankId: string, input: HindsightTransitionAcquire): HindsightTransitionAcquire {
  const parsed = HindsightTransitionAcquireSchema.parse(input);
  const request = withoutApplicationHash(parsed, "request_hash");
  return { ...parsed, request_hash: hindsightTransitionHash({ domain: "transition-acquire.v1", bank_id: bankId, request }) };
}
export function signHindsightTransitionDelta(bankId: string, input: HindsightTransitionDeltaRequest): HindsightTransitionDeltaRequest {
  const parsed = HindsightTransitionDeltaRequestSchema.parse(input);
  const request = withoutApplicationHash(withoutApplicationHash(parsed, "request_hash"), "executor");
  return { ...parsed, request_hash: hindsightTransitionHash({ domain: "transition-delta.v1", bank_id: bankId,
    transition_id: parsed.executor.transition_id, request }) };
}
export function validateHindsightUnusedScope(proof: HindsightTransitionUnusedScope, bankId: string): void {
  const { proof_hash: hash, ...value } = proof;
  if (proof.bank_id !== bankId || hash !== hindsightTransitionHash(value)) invalid();
}
export function validateHindsightTransitionStatus(status: HindsightTransitionStatus, expected: { bankId: string; transitionId: string }): void {
  const request = status.request;
  if (status.bank_id !== expected.bankId || request.transition_id !== expected.transitionId
    || status.executor.transition_id !== expected.transitionId || signHindsightTransitionAcquire(expected.bankId, request).request_hash !== request.request_hash) invalid();
  if (request.unused_scope) validateHindsightUnusedScope(request.unused_scope, expected.bankId);
  const proof = status.proof;
  if (proof) {
    const { proof_hash: proofHash, ...body } = proof;
    if (proofHash !== hindsightTransitionHash({ domain: "transition-proof.v1", proof: body })
      || proof.certificate_id !== expected.transitionId || proof.executor.transition_id !== expected.transitionId
      || proof.bank_id !== expected.bankId || proof.request_hash !== request.request_hash
      || proof.provider_lineage !== request.provider_lineage || proof.bank_generation !== request.bank_generation
      || proof.executor.generation > status.executor.generation
      || (proof.delta_result_hash !== null) !== (request.direction === "reenter-hindsight")
      || proof.unused_scope_hash !== (request.unused_scope?.proof_hash ?? null)) invalid();
    const native = proof.native_snapshot.manifest; const app = proof.application_snapshot;
    if (native.bank_id !== expected.bankId || app.bank_id !== expected.bankId
      || native.provider_lineage !== request.provider_lineage || native.bank_generation !== request.bank_generation
      || app.namespace.provider_lineage !== request.provider_lineage || app.namespace.bank_generation !== request.bank_generation
      || native.end_cursor !== app.checkpoint.native_cursor) invalid();
  }
  if (status.outcome) {
    const { outcome_hash: hash, ...outcome } = status.outcome;
    if (hash !== hindsightTransitionHash(outcome) || outcome.bank_id !== expected.bankId
      || outcome.provider_lineage !== request.provider_lineage || outcome.bank_generation !== request.bank_generation
      || outcome.phase !== status.phase || hindsightTransitionHash(outcome.request.executor) !== hindsightTransitionHash(status.executor)
      || outcome.request.proof_hash !== null && outcome.request.proof_hash !== proof?.proof_hash) invalid();
  }
}
export function validateHindsightTransitionDelta(result: HindsightTransitionDeltaResult, expected: { bankId: string; transitionId: string; request?: HindsightTransitionDeltaRequest }): void {
  const { result_hash: hash, ...body } = result;
  if (result.bank_id !== expected.bankId || result.transition_id !== expected.transitionId || hash !== hindsightTransitionHash(body)) invalid();
  const request = expected.request;
  if (request && (result.operation_id !== request.operation_id || result.request_hash !== request.request_hash
    || result.local_manifest_hash !== request.local_manifest_hash || result.baseline_proof_hash !== request.baseline_proof_hash
    || result.unused_scope_hash !== (request.unused_scope?.proof_hash ?? null))) invalid();
}
function invalid(): never { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
