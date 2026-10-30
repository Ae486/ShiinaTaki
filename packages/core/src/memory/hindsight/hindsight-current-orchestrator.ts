/**
 * INPUT:  persisted D78 commands, authenticated clients and an operator-owned B4 lease
 * OUTPUT: recovered import mappings or a fully verified native certificate/raw replica checkpoint
 * POS:    core/memory/hindsight — current-state import entry; all Canonical origins use structure, never extraction
 */
import type { HindsightCurrentImportEvidence, HindsightCurrentVerificationEvidence, HindsightCutoverVerificationStatus,
  HindsightCurrentTransferFailure, HindsightCutoverVerificationFailure, HindsightCutoverVerificationRequest } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightCutoverLease } from "../../db/hindsight-cutover-run-repo.ts";
import { readHindsightCurrentPreparation } from "../../db/hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport, saveHindsightCurrentImport } from "../../db/hindsight-current-import-repo.ts";
import { readCurrentVerificationCandidate, saveCurrentVerificationCandidate } from "../../db/hindsight-current-candidate-repo.ts";
import { saveHindsightCurrentVerification } from "../../db/hindsight-current-verification-repo.ts";
import { requireHindsightCurrentNativeState, saveHindsightCurrentNativeInvalidation } from "../../db/hindsight-current-invalidation-repo.ts";
import { currentVerificationRequest } from "./hindsight-current-verification-identity.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "./hindsight-snapshot-contracts.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightCurrentStateClient } from "./hindsight-current-client.ts";
import type { HindsightCurrentBaseline } from "./hindsight-current-baseline.ts";

export async function importHindsightCurrentBank(input: { db: Database; preparationId: string;
  client: HindsightCurrentStateClient; context: HindsightCallContext }): Promise<HindsightCurrentImportEvidence> {
  requireHindsightCurrentNativeState(input.db, { preparationId: input.preparationId });
  const prior = readHindsightCurrentImport(input.db, input.preparationId); if (prior) return prior;
  const prepared = readHindsightCurrentPreparation(input.db, input.preparationId); const request = prepared.request;
  if (!request || prepared.gaps.length) throw new Error("HINDSIGHT_CURRENT_PREPARATION_GAPS");
  const read = { bankId: prepared.bankId, operationId: prepared.operationId, providerLineage: request.provider_lineage,
    bankGeneration: request.bank_generation, context: input.context };
  let result = await input.client.currentTransferResult(read);
  if ("error" in result && result.reason === "result_not_found") {
    result = await input.client.transferCurrentState({ bankId: prepared.bankId, request, context: input.context });
  }
  if ("error" in result) recordRefusal({ ...input, observedAt: new Date().toISOString() }, result);
  const pages = [];
  for (let pageNumber = 0; pageNumber < result.manifest.total_pages; pageNumber++) {
    const page = await input.client.currentTransferPage({ ...read, pageNumber });
    if ("error" in page) recordRefusal({ ...input, observedAt: new Date().toISOString() }, page);
    pages.push(page);
  }
  return saveHindsightCurrentImport(input.db, { preparationId: prepared.preparationId, result, pages });
}

export async function verifyHindsightCurrentBank(input: { db: Database; preparationId: string; lease: HindsightCutoverLease;
  verificationId: string; replicaEpochId: string; client: HindsightCurrentStateClient; context: HindsightCallContext;
  now: () => string }): Promise<{ status: HindsightCutoverVerificationStatus; evidence: HindsightCurrentVerificationEvidence | null }> {
  const knownCandidate = readCurrentVerificationCandidate(input.db, input.verificationId);
  requireHindsightCurrentNativeState(input.db, { preparationId: input.preparationId, candidateId: knownCandidate?.candidateId });
  const imported = readHindsightCurrentImport(input.db, input.preparationId); if (!imported) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
  const request = currentVerificationRequest({ imported, verificationId: input.verificationId });
  let status = await input.client.prepareCurrentVerification({ bankId: imported.result.bank_id, request, context: input.context });
  if ("error" in status) recordRefusal({ ...input, observedAt: input.now() }, status);
  const candidate = recordVerificationStatus({ ...input, request, status });
  const read = { bankId: imported.result.bank_id, operationId: request.verification_id, providerLineage: request.provider_lineage,
    bankGeneration: request.bank_generation, context: input.context };
  if (status.state !== "complete" && status.state !== "stale") {
    status = await input.client.advanceCurrentVerification({ ...read, expectedRevision: status.revision });
    if ("error" in status) recordRefusal({ ...input, observedAt: input.now() }, status);
    recordVerificationStatus({ ...input, request, status });
  }
  if (status.state !== "complete" || !status.certificate) return { status, evidence: null };
  requireHindsightCurrentNativeState(input.db, { preparationId: input.preparationId, candidateId: candidate.candidateId });
  const certificate = status.certificate; const pages = []; const snapshotPages = [];
  for (let pageNumber = 0; pageNumber < certificate.evidence.total_pages; pageNumber++) {
    const page = await input.client.currentVerificationPage({ ...read, certificateHash: certificate.certificate_hash, pageNumber });
    if ("error" in page) recordRefusal({ ...input, observedAt: input.now() }, page); pages.push(page);
  }
  for (let pageNumber = 0; pageNumber < certificate.snapshot.manifest.total_pages; pageNumber++) {
    snapshotPages.push(await input.client.currentSnapshotPage({ bankId: read.bankId,
      snapshotId: certificate.snapshot.snapshot_id, pageNumber, context: input.context }));
  }
  const evidence = saveHindsightCurrentVerification(input.db, { lease: input.lease, status, pages, snapshotPages,
    replicaEpochId: input.replicaEpochId, now: input.now() });
  return { status, evidence };
}

export async function fetchHindsightCurrentBaseline(input: { bankId: string; ttlSeconds: number;
  client: HindsightCurrentStateClient; context: HindsightCallContext }): Promise<HindsightCurrentBaseline> {
  const metadata = await input.client.createCurrentSnapshot(input); const pages = [];
  for (let pageNumber = 0; pageNumber < metadata.manifest.total_pages; pageNumber++) {
    pages.push(await input.client.currentSnapshotPage({ bankId: input.bankId, snapshotId: metadata.snapshot_id,
      pageNumber, context: input.context }));
  }
  return { metadata: normalizeSnapshotMetadata(metadata), pages: pages.map(normalizeSnapshotPage) };
}

function refuse(failure: HindsightCurrentTransferFailure | HindsightCutoverVerificationFailure): never {
  throw new Error(`HINDSIGHT_CURRENT_NATIVE_REFUSED:${failure.reason}`);
}

function recordRefusal(input: { db: Database; preparationId: string; verificationId?: string; observedAt: string },
  failure: HindsightCurrentTransferFailure | HindsightCutoverVerificationFailure): never {
  saveHindsightCurrentNativeInvalidation(input.db, { ...input,
    response: failure.error === "current_state_transfer_refused" ? { kind: "transfer-refusal", value: failure }
      : { kind: "verification-refusal", value: failure } });
  return refuse(failure);
}

function recordVerificationStatus(input: { db: Database; preparationId: string; request: HindsightCutoverVerificationRequest;
  status: HindsightCutoverVerificationStatus; now: () => string }) {
  const candidate = saveCurrentVerificationCandidate(input.db, input);
  saveHindsightCurrentNativeInvalidation(input.db, { preparationId: input.preparationId,
    verificationId: input.request.verification_id, observedAt: input.now(), response: { kind: "verification-status", value: input.status } });
  return candidate;
}
