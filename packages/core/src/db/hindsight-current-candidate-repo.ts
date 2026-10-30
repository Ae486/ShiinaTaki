/**
 * INPUT:  exact transfer result and the provider's finite required-set candidate
 * OUTPUT: immutable candidate identity retained across verification retries and lost acknowledgements
 * POS:    core/db — D78 preparation receipts; later outcome state never rewrites the first observation
 */
import { HindsightCurrentVerificationCandidateSchema, HindsightCutoverVerificationStatusSchema,
  type HindsightCurrentVerificationCandidate, type HindsightCutoverVerificationRequest, type HindsightCutoverVerificationStatus } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { assertCurrentVerificationIdentity, sameCurrentCandidate } from "../memory/hindsight/hindsight-current-verification-identity.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import type { Database } from "./sqlite.ts";

export function saveCurrentVerificationCandidate(db: Database, input: {
  preparationId: string; request: HindsightCutoverVerificationRequest; status: HindsightCutoverVerificationStatus;
}): HindsightCurrentVerificationCandidate {
  const status = HindsightCutoverVerificationStatusSchema.parse(input.status);
  const imported = readHindsightCurrentImport(db, input.preparationId); if (!imported) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
  assertCurrentVerificationIdentity({ imported, request: input.request, status });
  const prior = readCurrentVerificationCandidate(db, input.request.verification_id);
  if (prior) {
    if (prior.preparationId !== input.preparationId || canonicalJson(prior.request) !== canonicalJson(input.request)
      || !sameCurrentCandidate(prior.status, status)) throw new Error("HINDSIGHT_CURRENT_CANDIDATE_CONFLICT");
    return prior;
  }
  const body = { schemaVersion: 1 as const, preparationId: input.preparationId, request: input.request, status };
  const value = HindsightCurrentVerificationCandidateSchema.parse({ ...body, candidateId: canonicalPayloadHash(["taki-current-candidate.v1", body]) });
  db.prepare(`INSERT INTO hindsight_current_verification_candidates (candidate_id,verification_id,preparation_id,candidate_json)
    VALUES (:id,:verification,:preparation,:json)`)
    .run({ id: value.candidateId, verification: value.request.verification_id, preparation: value.preparationId, json: canonicalJson(value) });
  return value;
}

export function readCurrentVerificationCandidate(db: Database, verificationId: string): HindsightCurrentVerificationCandidate | undefined {
  const row = db.prepare("SELECT * FROM hindsight_current_verification_candidates WHERE verification_id=:id").get({ id: verificationId });
  if (!row) return undefined;
  const value = HindsightCurrentVerificationCandidateSchema.parse(JSON.parse(String(row.candidate_json)));
  const { candidateId, ...body } = value;
  if (candidateId !== canonicalPayloadHash(["taki-current-candidate.v1", body]) || candidateId !== row.candidate_id
    || value.preparationId !== row.preparation_id || value.request.verification_id !== row.verification_id) {
    throw new Error("HINDSIGHT_CURRENT_CANDIDATE_CORRUPT");
  }
  const imported = readHindsightCurrentImport(db, value.preparationId); if (!imported) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
  assertCurrentVerificationIdentity({ imported, request: value.request, status: value.status });
  return value;
}
