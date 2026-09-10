/**
 * INPUT:  immutable structured-import evidence and provider-prepared verification identity
 * OUTPUT: exact finite candidate requests and immutable candidate/transfer binding checks
 * POS:    core/memory/hindsight — versioned request identity; no queue or timestamp completion inference
 */
import { HindsightCutoverVerificationRequestSchema, type HindsightCurrentImportEvidence,
  type HindsightCutoverVerificationRequest, type HindsightCutoverVerificationStatus } from "@taki/shared";
import { currentStateFieldsWithout, hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";

export function currentVerificationRequest(input: { imported: HindsightCurrentImportEvidence; verificationId: string }): HindsightCutoverVerificationRequest {
  const result = input.imported.result;
  const request = HindsightCutoverVerificationRequestSchema.parse({ contract_version: result.contract_version,
    encoding: result.encoding, verification_id: input.verificationId, request_hash: "0".repeat(64),
    transfer_operation_id: result.operation_id, transfer_request_hash: result.request_hash, transfer_result_hash: result.result_hash,
    local_manifest_digest: result.local_manifest_digest, source_bank_id: result.source_bank_id,
    provider_lineage: result.provider_lineage, bank_generation: result.bank_generation });
  request.request_hash = currentVerificationRequestHash(result.bank_id, request); return request;
}

export function currentVerificationRequestHash(bankId: string, request: HindsightCutoverVerificationRequest): string {
  const body = currentStateFieldsWithout(request, ["request_hash"]);
  return hindsightCurrentStateHash({ domain: "cutover-verification-request.v1", bank_id: bankId, request: body });
}

export function assertCurrentVerificationIdentity(input: { imported: HindsightCurrentImportEvidence;
  request: HindsightCutoverVerificationRequest; status: HindsightCutoverVerificationStatus }): void {
  const { request, status } = input; const result = input.imported.result;
  if (hindsightCurrentStateHash(currentVerificationRequest({ imported: input.imported, verificationId: request.verification_id }))
    !== hindsightCurrentStateHash(request) || status.bank_id !== result.bank_id) fail();
  for (const key of Object.keys(request) as Array<keyof HindsightCutoverVerificationRequest>) {
    if (request[key] !== status[key]) fail();
  }
}

export function sameCurrentCandidate(left: HindsightCutoverVerificationStatus, right: HindsightCutoverVerificationStatus): boolean {
  return left.candidate_hash === right.candidate_hash && left.required_set_hash === right.required_set_hash
    && left.source_scope_count === right.source_scope_count && left.model_count === right.model_count;
}
function fail(): never { throw new Error("HINDSIGHT_CURRENT_VERIFICATION_IDENTITY_INVALID"); }
