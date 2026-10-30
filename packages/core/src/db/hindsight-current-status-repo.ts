/**
 * INPUT:  the selected Local manifest and immutable D78 preparation/import/verification producers
 * OUTPUT: privacy-safe durable progress counts, or unavailable/null without manufactured zeroes
 * POS:    core/db — operator status only; verified counts do not replace cutover readiness guards
 */
import { HindsightCurrentStatusSchema, type HindsightCurrentStatus } from "@taki/shared";
import { readHindsightCurrentCaptureByManifest } from "./hindsight-current-capture-repo.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { readCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { readHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { readHindsightCurrentNativeInvalidation } from "./hindsight-current-invalidation-repo.ts";
import type { Database } from "./sqlite.ts";

export function readHindsightCurrentStatus(db: Database, runId: string): HindsightCurrentStatus | undefined {
  const selected = db.prepare(`SELECT c.manifest_id FROM hindsight_current_captures c
    JOIN hindsight_cutover_local_coverage s ON s.manifest_id=c.manifest_id WHERE s.run_id=:run`).get({ run: runId });
  if (!selected) return undefined;
  const manifestId = String(selected.manifest_id);
  try { return readCounts(db, { runId, manifestId }); }
  catch {
    return HindsightCurrentStatusSchema.parse({ schemaVersion: 1, manifestId, state: "unavailable",
      bankCount: null, preparedBankCount: null, preparationGapCount: null, importedBankCount: null,
      objectMappingCount: null, memoryUnitMappingCount: null, verificationBankCount: null, verifiedBankCount: null, nativeInvalidatedBankCount: null });
  }
}

function readCounts(db: Database, input: { runId: string; manifestId: string }): HindsightCurrentStatus {
  const capture = readHindsightCurrentCaptureByManifest(db, input.manifestId);
  if (!capture || capture.manifest.runId !== input.runId) throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
  const counts = { bankCount: capture.manifest.bankIds.length, preparedBankCount: 0, preparationGapCount: 0,
    importedBankCount: 0, objectMappingCount: 0, memoryUnitMappingCount: 0, verificationBankCount: 0, verifiedBankCount: 0, nativeInvalidatedBankCount: 0 };
  const rows = db.prepare("SELECT preparation_id FROM hindsight_current_preparations WHERE capture_id=:id")
    .all({ id: capture.captureId });
  const sourceBanks = new Set<string>();
  for (const row of rows) {
    const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id));
    if (prepared.captureId !== capture.captureId || prepared.manifestId !== input.manifestId || prepared.runId !== input.runId
      || !capture.manifest.bankIds.includes(prepared.sourceBankId) || sourceBanks.has(prepared.sourceBankId)) {
      throw new Error("HINDSIGHT_CURRENT_PREPARATION_CORRUPT");
    }
    sourceBanks.add(prepared.sourceBankId); counts.preparedBankCount++; counts.preparationGapCount += prepared.gaps.length;
    const imported = readHindsightCurrentImport(db, prepared.preparationId);
    if (!imported) {
      counts.nativeInvalidatedBankCount += readHindsightCurrentNativeInvalidation(db, { preparationId: prepared.preparationId }) ? 1 : 0;
      continue;
    }
    counts.importedBankCount++; counts.objectMappingCount += imported.mappings.length;
    counts.memoryUnitMappingCount += imported.mappings.filter((mapping) => mapping.target_kind === "memory_unit").length;
    const verification = readVerificationCounts(db, prepared.preparationId);
    counts.verificationBankCount += verification.started ? 1 : 0; counts.verifiedBankCount += verification.complete ? 1 : 0;
    counts.nativeInvalidatedBankCount += verification.invalidated ? 1 : 0;
  }
  return HindsightCurrentStatusSchema.parse({ schemaVersion: 1, manifestId: input.manifestId, state: "available", ...counts });
}

function readVerificationCounts(db: Database, preparationId: string): { started: boolean; complete: boolean; invalidated: boolean } {
  const candidates = db.prepare("SELECT verification_id FROM hindsight_current_verification_candidates WHERE preparation_id=:id")
    .all({ id: preparationId });
  for (const row of candidates) {
    if (!readCurrentVerificationCandidate(db, String(row.verification_id))) throw new Error("HINDSIGHT_CURRENT_CANDIDATE_MISSING");
  }
  const receipts = db.prepare("SELECT snapshot_id FROM hindsight_current_verification_evidence WHERE preparation_id=:id")
    .all({ id: preparationId });
  let complete = false; let invalidated = Boolean(readHindsightCurrentNativeInvalidation(db, { preparationId }));
  for (const row of receipts) {
    const evidence = readHindsightCurrentVerification(db, { preparationId, snapshotId: String(row.snapshot_id), now: new Date().toISOString() });
    if (!evidence) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_MISSING");
    if (readHindsightCurrentNativeInvalidation(db, { preparationId, candidateId: evidence.candidateId })) invalidated = true;
    else complete = true;
  }
  return { started: candidates.length > 0, complete, invalidated: invalidated && !complete };
}
