/**
 * INPUT:  a persisted native candidate, complete certificate pages and final snapshot wire
 * OUTPUT: immutable verification evidence plus atomic raw B4 replica/checkpoint publication
 * POS:    core/db — finite D78 proof; no B5 Canonical policy projection is manufactured
 */
import { HindsightCurrentVerificationEvidenceSchema, type HindsightCurrentVerificationEvidence,
  type HindsightCutoverVerificationStatus, type HindsightCutoverEvidencePage, type HindsightSnapshotPageWire } from "@taki/shared";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { verifyCurrentMaintenance } from "../memory/hindsight/hindsight-current-maintenance-proof.ts";
import { readCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { publishHindsightCurrentReplica } from "./hindsight-current-replica-publication.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { createHindsightLocalCoverageRepo, reserveHindsightLocalWriter } from "./hindsight-local-coverage-repo.ts";
import { requireCurrentCaptureLease } from "./hindsight-current-capture-repo.ts";
import { requireHindsightCurrentNativeState } from "./hindsight-current-invalidation-repo.ts";
import type { HindsightCutoverLease } from "./hindsight-cutover-run-repo.ts";
import type { Database } from "./sqlite.ts";

export function saveHindsightCurrentVerification(db: Database, input: { lease: HindsightCutoverLease;
  status: HindsightCutoverVerificationStatus; pages: HindsightCutoverEvidencePage[]; snapshotPages: HindsightSnapshotPageWire[];
  replicaEpochId: string; now: string }): HindsightCurrentVerificationEvidence {
  let saved: HindsightCurrentVerificationEvidence | undefined;
  db.transaction(() => {
    const candidate = readCurrentVerificationCandidate(db, input.status.verification_id);
    if (!candidate) throw new Error("HINDSIGHT_CURRENT_CANDIDATE_MISSING");
    const prepared = readHindsightCurrentPreparation(db, candidate.preparationId);
    reserveHindsightLocalWriter(db, prepared.localEpochId); requireCurrentCaptureLease(db, input);
    requireHindsightCurrentNativeState(db, { preparationId: prepared.preparationId, candidateId: candidate.candidateId });
    const manifest = createHindsightLocalCoverageRepo(db).selected(input.lease.runId);
    if (input.lease.runId !== prepared.runId || manifest?.manifestId !== prepared.manifestId) throw new Error("HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE");
    createHindsightLocalCoverageRepo(db).assertCurrent(prepared.manifestId);
    const imported = readHindsightCurrentImport(db, candidate.preparationId); if (!imported) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
    const evidence = verifyCurrentMaintenance({ ...input, candidate, imported }); const certificate = evidence.status.certificate;
    if (!certificate) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
    const prior = readHindsightCurrentVerification(db, { preparationId: prepared.preparationId,
      snapshotId: certificate.snapshot.snapshot_id, now: input.now });
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(evidence)) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_CONFLICT");
    } else {
      db.prepare(`INSERT INTO hindsight_current_verification_evidence
        (evidence_id,preparation_id,certificate_hash,snapshot_id,manifest_digest,evidence_json)
        VALUES (:id,:preparation,:hash,:snapshot,:manifest,:json)`)
        .run({ id: evidence.evidenceId, preparation: prepared.preparationId, hash: certificate.certificate_hash,
          snapshot: certificate.snapshot.snapshot_id, manifest: certificate.snapshot.manifest.sha256, json: canonicalJson(evidence) });
    }
    publishHindsightCurrentReplica(db, { evidence, runId: prepared.runId, replicaEpochId: input.replicaEpochId, now: input.now });
    saved = evidence;
  });
  if (!saved) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
  return saved;
}

export function readHindsightCurrentVerification(db: Database, input: {
  preparationId: string; snapshotId: string; now: string;
}): HindsightCurrentVerificationEvidence | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_current_verification_evidence
    WHERE preparation_id=:preparation AND snapshot_id=:snapshot`).get({ preparation: input.preparationId, snapshot: input.snapshotId });
  if (!row) return undefined;
  const value = HindsightCurrentVerificationEvidenceSchema.parse(JSON.parse(String(row.evidence_json)));
  const candidate = readCurrentVerificationCandidate(db, value.request.verification_id);
  const imported = readHindsightCurrentImport(db, input.preparationId);
  if (!candidate || !imported) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_CORRUPT");
  const verified = verifyCurrentMaintenance({ candidate, imported, ...value, now: input.now });
  const certificate = value.status.certificate;
  if (!certificate || canonicalJson(verified) !== canonicalJson(value) || value.evidenceId !== row.evidence_id
    || value.preparationId !== row.preparation_id || certificate?.certificate_hash !== row.certificate_hash
    || certificate.snapshot.snapshot_id !== row.snapshot_id || certificate.snapshot.manifest.sha256 !== row.manifest_digest) {
    throw new Error("HINDSIGHT_CURRENT_VERIFICATION_CORRUPT");
  }
  return verified;
}
