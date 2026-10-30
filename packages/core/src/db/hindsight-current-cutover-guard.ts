/**
 * INPUT:  selected complete Local coverage, D78 receipts and the published raw B4 replica
 * OUTPUT: independent current-import/maintenance completeness or a bounded cutover refusal
 * POS:    core/db — actual B4 ready/verify/promotion guard; old B2 mappings never discharge current proof
 */
import type { HindsightLocalCoverageManifest, HindsightReplicaCheckpoint } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readHindsightCurrentCaptureByManifest } from "./hindsight-current-capture-repo.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { readHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { readHindsightLocalBankBinding } from "./hindsight-local-bank-binding.ts";
import { requireHindsightCurrentNativeState } from "./hindsight-current-invalidation-repo.ts";
import type { Database } from "./sqlite.ts";

export function hasHindsightCurrentCapture(db: Database, runId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM hindsight_current_captures c JOIN hindsight_cutover_local_coverage s
    ON s.manifest_id=c.manifest_id WHERE s.run_id=:run`).get({ run: runId }));
}

export function requireHindsightCurrentCheckpointRetention(db: Database, input: {
  runId: string; checkpoint: HindsightReplicaCheckpoint; now: string;
}): void {
  const checkpoint = input.checkpoint;
  const row = db.prepare(`SELECT p.preparation_id FROM hindsight_current_preparations p
    JOIN hindsight_current_captures c ON c.capture_id=p.capture_id
    JOIN hindsight_cutover_local_coverage s ON s.manifest_id=c.manifest_id
    WHERE s.run_id=:run AND p.bank_id=:bank`).get({ run: input.runId, bank: checkpoint.bankId });
  if (!row) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_MISSING");
  const evidence = readHindsightCurrentVerification(db, { preparationId: String(row.preparation_id),
    snapshotId: checkpoint.snapshotId, now: input.now });
  const certificate = evidence?.status.certificate;
  requireHindsightCurrentNativeState(db, { preparationId: String(row.preparation_id), candidateId: evidence?.candidateId });
  // Read-back revalidates the full certificate, native namespace, evidence stream and exact retained snapshot bytes.
  if (!certificate || certificate.bank_id !== checkpoint.bankId || certificate.provider_lineage !== checkpoint.providerLineage
    || certificate.bank_generation !== checkpoint.bankGeneration || certificate.snapshot.manifest.sha256 !== checkpoint.manifestDigest
    || certificate.snapshot.manifest.end_cursor !== checkpoint.endCursor || certificate.snapshot.created_at !== checkpoint.capturedAt
    || certificate.snapshot.expires_at !== checkpoint.snapshotExpiresAt) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_MISSING");
}

export function requireHindsightCurrentCutover(db: Database, input: { manifest: HindsightLocalCoverageManifest; now?: string }): void {
  const capture = readHindsightCurrentCaptureByManifest(db, input.manifest.manifestId);
  if (!capture || capture.manifest.manifestDigest !== input.manifest.manifestDigest) throw new Error("HINDSIGHT_CURRENT_CAPTURE_MISSING");
  for (const sourceBankId of input.manifest.bankIds) {
    const binding = readHindsightLocalBankBinding(db, { localEpochId: input.manifest.localEpochId, sourceBankId });
    const row = db.prepare("SELECT preparation_id FROM hindsight_current_preparations WHERE capture_id=:capture AND bank_id=:bank")
      .get({ capture: capture.captureId, bank: binding.nativeBankId });
    if (!row) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
    const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id));
    requireHindsightCurrentNativeState(db, { preparationId: prepared.preparationId });
    const imported = readHindsightCurrentImport(db, prepared.preparationId);
    if (!imported || prepared.sourceBankId !== sourceBankId || prepared.localManifestDigest !== input.manifest.manifestDigest) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
    const checkpoint = db.prepare("SELECT * FROM hindsight_replica_checkpoints WHERE bank_id=:bank").get({ bank: binding.nativeBankId });
    if (!checkpoint) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_MISSING");
    const evidence = readHindsightCurrentVerification(db, { preparationId: prepared.preparationId,
      snapshotId: String(checkpoint.snapshot_id), now: input.now ?? new Date().toISOString() });
    const certificate = evidence?.status.certificate;
    requireHindsightCurrentNativeState(db, { preparationId: prepared.preparationId, candidateId: evidence?.candidateId });
    if (!evidence || !certificate || certificate.snapshot.manifest.sha256 !== checkpoint.manifest_digest
      || certificate.snapshot.manifest.end_cursor !== checkpoint.end_cursor
      || certificate.provider_lineage !== checkpoint.provider_lineage || certificate.bank_generation !== checkpoint.bank_generation) {
      throw new Error("HINDSIGHT_CURRENT_VERIFICATION_MISSING");
    }
    const targets = new Set(imported.mappings.map((mapping) => `${mapping.source.source_kind}:${mapping.source.source_id}`));
    if (capture.dispositions.some((item) => item.witness.bankId === sourceBankId && item.destination === "native-object"
      && !targets.has(`${item.nativeKind}:${item.nativeSourceId}`))) throw new Error("HINDSIGHT_CURRENT_DISPOSITION_MISSING");
    verifyPublishedSnapshot(db, { bankId: binding.nativeBankId, stagingId: String(checkpoint.staging_id), evidence });
  }
}

function verifyPublishedSnapshot(db: Database, input: { bankId: string; stagingId: string;
  evidence: NonNullable<ReturnType<typeof readHindsightCurrentVerification>> }): void {
  const records = input.evidence.snapshotPages.flatMap((page) => page.records);
  const rows = db.prepare("SELECT * FROM hindsight_replica_records WHERE bank_id=:bank").all({ bank: input.bankId });
  if (rows.length !== records.length) throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
  for (const record of records) {
    const row = rows.find((candidate) => candidate.object_kind === record.object_kind && candidate.object_id === record.object_id);
    const camel = Object.fromEntries(Object.entries(record.payload).map(([key, value]) =>
      [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
    if (!row || row.object_revision !== record.object_revision || row.payload_hash !== canonicalPayloadHash(camel)
      || canonicalPayloadHash(JSON.parse(String(row.payload_json))) !== row.payload_hash) throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
  }
  const staging = db.prepare("SELECT status,snapshot_id FROM hindsight_replica_staging_runs WHERE staging_id=:id").get({ id: input.stagingId });
  if (staging?.status !== "published" || staging.snapshot_id !== input.evidence.status.certificate?.snapshot.snapshot_id) {
    throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
  }
}
