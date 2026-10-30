/**
 * INPUT:  immutable import/candidate, complete maintenance pages, and exact native snapshot wire pages
 * OUTPUT: certificate-bound complete final snapshot and durable verification evidence
 * POS:    core/memory/hindsight — first-activation proof; no policy fabrication or G1 derived wait
 */
import { HindsightCurrentVerificationEvidenceSchema, HindsightCutoverVerificationStatusSchema, HindsightCutoverEvidencePageSchema,
  HindsightSnapshotPageWireSchema, type HindsightCurrentVerificationCandidate, type HindsightCurrentImportEvidence,
  type HindsightCutoverVerificationStatus, type HindsightCutoverEvidencePage, type HindsightSnapshotPageWire,
  type HindsightCurrentVerificationEvidence } from "@taki/shared";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";
import { assertCurrentVerificationIdentity, sameCurrentCandidate } from "./hindsight-current-verification-identity.ts";
import { verifyCurrentMaintenanceStream } from "./hindsight-current-maintenance-stream.ts";
import { normalizeSnapshotMetadata } from "./hindsight-snapshot-contracts.ts";
import { verifyRetainedLogicalSnapshot } from "./hindsight-snapshot-validator.ts";

export function verifyCurrentMaintenance(input: { candidate: HindsightCurrentVerificationCandidate; imported: HindsightCurrentImportEvidence;
  status: HindsightCutoverVerificationStatus; pages: HindsightCutoverEvidencePage[]; snapshotPages: HindsightSnapshotPageWire[];
  now: string }): HindsightCurrentVerificationEvidence {
  const status = HindsightCutoverVerificationStatusSchema.parse(input.status); const candidate = input.candidate;
  assertCurrentVerificationIdentity({ imported: input.imported, request: candidate.request, status });
  if (!sameCurrentCandidate(candidate.status, status) || status.revision < candidate.status.revision
    || status.state !== "complete" || status.reasons.length || !status.certificate) fail();
  const certificate = status.certificate; const { certificate_hash: hash, ...body } = certificate;
  for (const key of Object.keys(candidate.request) as Array<keyof typeof candidate.request>) {
    if (certificate[key] !== candidate.request[key]) fail();
  }
  if (hash !== hindsightCurrentStateHash(body) || certificate.bank_id !== status.bank_id
    || certificate.candidate_hash !== status.candidate_hash || certificate.required_set_hash !== status.required_set_hash
    || certificate.source_scope_count !== status.source_scope_count || certificate.model_count !== status.model_count
    || certificate.candidate_cursor < input.imported.result.native_through_cursor) fail();
  const pages = input.pages.map((page) => HindsightCutoverEvidencePageSchema.parse(page));
  verifyPages({ certificate, pages });
  verifyCurrentMaintenanceStream(pages.flatMap((page) => page.records), certificate);
  const snapshotPages = input.snapshotPages.map((page) => HindsightSnapshotPageWireSchema.parse(page));
  const metadata = normalizeSnapshotMetadata(certificate.snapshot);
  if (metadata.manifest.bankGeneration !== status.bank_generation || metadata.manifest.endCursor < certificate.candidate_cursor
    || hindsightCurrentStateHash(snapshotPages.flatMap((page) => page.records)) !== certificate.snapshot_records_hash) fail();
  verifyRetainedLogicalSnapshot({ certificate, pages: snapshotPages, expectedBankId: status.bank_id,
    expectedProviderLineage: status.provider_lineage });
  const evidence = { schemaVersion: 1 as const, preparationId: candidate.preparationId, candidateId: candidate.candidateId,
    request: candidate.request, status, pages, snapshotPages };
  return HindsightCurrentVerificationEvidenceSchema.parse({ ...evidence,
    evidenceId: canonicalPayloadHash(["taki-current-verification-evidence.v1", evidence]) });
}

function verifyPages(input: { certificate: NonNullable<HindsightCutoverVerificationStatus["certificate"]>; pages: HindsightCutoverEvidencePage[] }): void {
  const { certificate, pages } = input; const manifest = certificate.evidence;
  if (pages.length !== manifest.total_pages || manifest.page_hashes.length !== pages.length
    || manifest.total_pages !== Math.max(1, Math.ceil(manifest.total_records / manifest.page_size))) fail();
  pages.forEach((page, index) => {
    if (page.verification_id !== certificate.verification_id || page.bank_id !== certificate.bank_id
      || page.provider_lineage !== certificate.provider_lineage || page.bank_generation !== certificate.bank_generation
      || page.certificate_hash !== certificate.certificate_hash || page.page_number !== index || page.total_pages !== pages.length
      || page.records.length !== Math.min(manifest.page_size, manifest.total_records - index * manifest.page_size)
      || page.page_hash !== manifest.page_hashes[index]
      || page.page_hash !== hindsightCurrentStateHash({ page_number: index, records: page.records })) fail();
  });
}
function fail(): never { throw new Error("HINDSIGHT_CURRENT_MAINTENANCE_PROOF_INVALID"); }
