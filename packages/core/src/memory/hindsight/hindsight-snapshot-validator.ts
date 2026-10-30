/**
 * INPUT:  normalized logical snapshot pages or a complete retained D78 certificate and its raw pages
 * OUTPUT: canonical page/order/hash/count/aggregate verification with bounded safe failures
 * POS:    core/memory/hindsight — integrity gate before staging persistence or checkpoint publication
 */
import { createHash } from "node:crypto";
import { HindsightLogicalSnapshotMetadataSchema, HindsightLogicalSnapshotPageSchema, HindsightCutoverCertificateSchema,
  HindsightSnapshotPageWireSchema, type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage,
  type HindsightLogicalSnapshotRecord, type HindsightCutoverCertificate, type HindsightSnapshotPageWire } from "@taki/shared";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import { hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "./hindsight-snapshot-contracts.ts";

export interface VerifiedSnapshot {
  metadata: HindsightLogicalSnapshotMetadata;
  pages: HindsightLogicalSnapshotPage[];
  records: HindsightLogicalSnapshotRecord[];
}

export function verifyLogicalSnapshot(input: { metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[]; expectedBankId: string; expectedProviderLineage: string; now: string }): VerifiedSnapshot {
  const metadata = HindsightLogicalSnapshotMetadataSchema.parse(input.metadata);
  if (metadata.manifest.bankId !== input.expectedBankId) fail("HINDSIGHT_SNAPSHOT_BANK_MISMATCH");
  if (metadata.manifest.providerLineage !== input.expectedProviderLineage) fail("HINDSIGHT_SNAPSHOT_LINEAGE_MISMATCH");
  if (Date.parse(metadata.expiresAt) <= Date.parse(input.now)) fail("HINDSIGHT_SNAPSHOT_EXPIRED");
  return verifySnapshotContents(metadata, input.pages);
}

export function verifyRetainedLogicalSnapshot(input: { certificate: HindsightCutoverCertificate;
  pages: HindsightSnapshotPageWire[]; expectedBankId: string; expectedProviderLineage: string }): VerifiedSnapshot {
  const certificate = HindsightCutoverCertificateSchema.parse(input.certificate);
  const { certificate_hash: hash, ...body } = certificate;
  const pages = input.pages.map((page) => HindsightSnapshotPageWireSchema.parse(page));
  const metadata = normalizeSnapshotMetadata(certificate.snapshot);
  // Retention is sealed atomically with this exact immutable snapshot. The diagnostic TTL stays unchanged.
  // A flag alone, another certificate, or reusing page hashes with different bytes cannot grant the exception.
  if (hash !== hindsightCurrentStateHash(body) || certificate.bank_id !== input.expectedBankId
    || certificate.provider_lineage !== input.expectedProviderLineage || metadata.manifest.bankId !== certificate.bank_id
    || metadata.manifest.providerLineage !== certificate.provider_lineage || metadata.manifest.bankGeneration !== certificate.bank_generation
    || hindsightCurrentStateHash(pages.flatMap((page) => page.records)) !== certificate.snapshot_records_hash) {
    fail("HINDSIGHT_SNAPSHOT_RETENTION_INVALID");
  }
  return verifySnapshotContents(metadata, pages.map(normalizeSnapshotPage));
}

function verifySnapshotContents(metadata: HindsightLogicalSnapshotMetadata, inputPages: HindsightLogicalSnapshotPage[]): VerifiedSnapshot {
  if (inputPages.length !== metadata.manifest.totalPages) fail("HINDSIGHT_SNAPSHOT_PAGE_MISSING");
  const pages = inputPages.map((page) => HindsightLogicalSnapshotPageSchema.parse(page));
  pages.forEach((page, index) => verifyPage(metadata, page, index));
  const records = pages.flatMap((page) => page.records);
  if (records.length !== metadata.manifest.totalRecords) fail("HINDSIGHT_SNAPSHOT_COUNT_MISMATCH");
  verifyCounts(metadata, records);
  const aggregate = manifestHash(metadata);
  if (aggregate !== metadata.manifest.manifestDigest) fail("HINDSIGHT_SNAPSHOT_MANIFEST_HASH_MISMATCH");
  return { metadata, pages, records };
}

function verifyPage(metadata: HindsightLogicalSnapshotMetadata, page: HindsightLogicalSnapshotPage, index: number): void {
  if (page.snapshotId !== metadata.snapshotId || page.pageNumber !== index || page.totalPages !== metadata.manifest.totalPages) {
    fail("HINDSIGHT_SNAPSHOT_PAGE_ORDER_MISMATCH");
  }
  const expectedHash = metadata.manifest.pageHashes[index];
  // The admitted Hindsight page route recomputes content_sha256 from its materialized canonical bytes.
  // Core binds that verified digest to the manifest instead of reserializing numbers with different JS semantics.
  if (page.contentHash !== expectedHash) {
    fail("HINDSIGHT_SNAPSHOT_PAGE_HASH_MISMATCH");
  }
}

function verifyCounts(metadata: HindsightLogicalSnapshotMetadata, records: HindsightLogicalSnapshotRecord[]): void {
  const counts = { bank: 0, document: 0, valid: 0, invalidated: 0, mentalModel: 0, directive: 0 };
  for (const record of records) {
    if (record.objectKind === "bank") counts.bank += 1;
    else if (record.objectKind === "document") counts.document += 1;
    else if (record.objectKind === "mental_model") counts.mentalModel += 1;
    else if (record.objectKind === "directive") counts.directive += 1;
    else if (record.payload.kind === "memory_unit" && record.payload.value.state === "valid") counts.valid += 1;
    else counts.invalidated += 1;
  }
  const expected = metadata.manifest.counts;
  if (counts.bank !== expected.bank || counts.document !== expected.document || counts.valid !== expected.memoryUnit.valid
    || counts.invalidated !== expected.memoryUnit.invalidated || counts.mentalModel !== expected.mentalModel
    || counts.directive !== expected.directive) fail("HINDSIGHT_SNAPSHOT_COUNT_MISMATCH");
}

export function snapshotManifestHash(metadata: HindsightLogicalSnapshotMetadata): string {
  return manifestHash(metadata);
}

function manifestHash(metadata: HindsightLogicalSnapshotMetadata): string {
  const manifest = metadata.manifest;
  return hashCanonical({ schema_version: manifest.schemaVersion, bank_id: manifest.bankId,
    provider_lineage: manifest.providerLineage, bank_generation: manifest.bankGeneration, end_cursor: manifest.endCursor,
    page_size: manifest.pageSize, total_pages: manifest.totalPages, total_records: manifest.totalRecords,
    counts: { bank: manifest.counts.bank, document: manifest.counts.document,
      memory_unit: manifest.counts.memoryUnit, mental_model: manifest.counts.mentalModel,
       directive: manifest.counts.directive, total: manifest.counts.total }, page_hashes: manifest.pageHashes });
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function fail(code: string): never { throw new Error(code); }
