/**
 * INPUT:  authenticated typed native drift observations under exact frozen preparation/candidate identities
 * OUTPUT: immutable invalidation evidence and restart-safe refusal of superseded cutover proof
 * POS:    core/db — known native drift gate; immutable historical certificates remain inspectable
 */
import { HindsightCurrentNativeInvalidationSchema, HindsightCurrentVerificationEvidenceSchema,
  HindsightCurrentNativeObservationSchema, hindsightCurrentObservationProvesDrift,
  type HindsightCurrentNativeObservation, type HindsightCurrentNativeInvalidation } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { assertCurrentVerificationIdentity, currentVerificationRequest, sameCurrentCandidate } from "../memory/hindsight/hindsight-current-verification-identity.ts";
import { currentStateFieldsWithout } from "../memory/hindsight/hindsight-current-state-hash.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { readCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export function saveHindsightCurrentNativeInvalidation(db: Database, input: {
  preparationId: string; verificationId?: string; response: HindsightCurrentNativeObservation; observedAt: string;
}): HindsightCurrentNativeInvalidation | undefined {
  const response = HindsightCurrentNativeObservationSchema.parse(input.response);
  if (!hindsightCurrentObservationProvesDrift(response)) return undefined;
  const prepared = readHindsightCurrentPreparation(db, input.preparationId); const request = prepared.request;
  if (!request) throw new Error("HINDSIGHT_CURRENT_PREPARATION_GAPS");
  const candidate = input.verificationId ? readCurrentVerificationCandidate(db, input.verificationId) : undefined;
  if (candidate && candidate.preparationId !== prepared.preparationId) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_IDENTITY_INVALID");
  const certificate = candidate ? currentCertificateBinding(db, candidate) : null;
  if (response.kind === "verification-status") {
    const imported = readHindsightCurrentImport(db, prepared.preparationId);
    if (!candidate || !imported || !sameCurrentCandidate(candidate.status, response.value)
      || response.value.revision < Math.max(candidate.status.revision, certificate?.revision ?? 0)) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_IDENTITY_INVALID");
    assertCurrentVerificationIdentity({ imported, request: currentVerificationRequest({ imported, verificationId: candidate.request.verification_id }), status: response.value });
  }
  const scope = response.kind === "verification-status" ? "candidate" as const : "preparation" as const;
  const body = { schemaVersion: 1 as const, preparationId: prepared.preparationId, bankId: prepared.bankId,
    providerLineage: request.provider_lineage, bankGeneration: request.bank_generation, scope,
    candidateId: candidate?.candidateId ?? null, verificationId: input.verificationId ?? null,
    certificateHash: certificate?.hash ?? null, response };
  const observationKey = canonicalPayloadHash(["taki-current-native-drift-key.v1", body]);
  const prior = db.prepare("SELECT * FROM hindsight_current_native_invalidations WHERE observation_key=:key").get({ key: observationKey });
  if (prior) return parseInvalidation(prior);
  const payload = { ...body, observationKey, observedAt: input.observedAt };
  const value = HindsightCurrentNativeInvalidationSchema.parse({ ...payload,
    invalidationId: canonicalPayloadHash(["taki-current-native-invalidation.v1", payload]) });
  db.prepare(`INSERT INTO hindsight_current_native_invalidations
    (invalidation_id,observation_key,preparation_id,candidate_id,scope,observation_json) VALUES (:id,:key,:preparation,:candidate,:scope,:json)`)
    .run({ id: value.invalidationId, key: value.observationKey, preparation: value.preparationId, candidate: value.candidateId,
      scope: value.scope, json: canonicalJson(value) });
  return value;
}

export function readHindsightCurrentNativeInvalidation(db: Database, input: {
  preparationId: string; candidateId?: string;
}): HindsightCurrentNativeInvalidation | undefined {
  const rows = db.prepare(`SELECT * FROM hindsight_current_native_invalidations WHERE preparation_id=:preparation
    AND (scope='preparation' OR candidate_id=:candidate) ORDER BY rowid`)
    .all({ preparation: input.preparationId, candidate: input.candidateId ?? null });
  return rows.map(parseInvalidation)[0];
}

export function requireHindsightCurrentNativeState(db: Database, input: { preparationId: string; candidateId?: string }): void {
  if (readHindsightCurrentNativeInvalidation(db, input)) throw new Error("HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED");
}

function parseInvalidation(row: SqlRow): HindsightCurrentNativeInvalidation {
  const value = HindsightCurrentNativeInvalidationSchema.parse(JSON.parse(String(row.observation_json)));
  const { invalidationId, ...payload } = value;
  const observationKey = payload.observationKey;
  const body = currentStateFieldsWithout(payload, ["observationKey", "observedAt"]);
  if (invalidationId !== canonicalPayloadHash(["taki-current-native-invalidation.v1", payload])
    || observationKey !== canonicalPayloadHash(["taki-current-native-drift-key.v1", body])
    || invalidationId !== row.invalidation_id || observationKey !== row.observation_key || value.preparationId !== row.preparation_id
    || value.candidateId !== row.candidate_id || value.scope !== row.scope) throw new Error("HINDSIGHT_CURRENT_INVALIDATION_CORRUPT");
  return value;
}

function currentCertificateBinding(db: Database, candidate: { preparationId: string; candidateId: string }): { hash: string; revision: number } | null {
  const rows = db.prepare("SELECT certificate_hash,evidence_json FROM hindsight_current_verification_evidence WHERE preparation_id=:id ORDER BY rowid DESC")
    .all({ id: candidate.preparationId });
  for (const row of rows) {
    const evidence = HindsightCurrentVerificationEvidenceSchema.parse(JSON.parse(String(row.evidence_json)));
    if (evidence.candidateId === candidate.candidateId) {
      const hash = evidence.status.certificate?.certificate_hash;
      const { evidenceId, ...body } = evidence;
      if (!hash || hash !== row.certificate_hash || evidence.preparationId !== candidate.preparationId
        || evidenceId !== canonicalPayloadHash(["taki-current-verification-evidence.v1", body])) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_CORRUPT");
      return { hash, revision: evidence.status.revision };
    }
  }
  return null;
}
