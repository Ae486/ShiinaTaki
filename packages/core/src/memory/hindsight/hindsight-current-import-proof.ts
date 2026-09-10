/**
 * INPUT:  a frozen D78 preparation plus the provider's immutable result and every mapping page
 * OUTPUT: complete namespace/hash/source/target-validated import evidence
 * POS:    core/memory/hindsight — factual proof only; maintenance and final snapshots are separate gates
 */
import { HindsightCurrentTransferResultSchema, HindsightCurrentMappingPageSchema, HindsightCurrentImportEvidenceSchema,
  type HindsightPreparedCurrentBank, type HindsightCurrentMapping, type HindsightCurrentTransferResult,
  type HindsightCurrentMappingPage, type HindsightCurrentImportEvidence } from "@taki/shared";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { hindsightCurrentRequestHash, hindsightCurrentStateHash } from "./hindsight-current-state-hash.ts";

export function verifyCurrentImport(input: { prepared: HindsightPreparedCurrentBank; result: HindsightCurrentTransferResult;
  pages: HindsightCurrentMappingPage[] }): HindsightCurrentImportEvidence {
  const result = HindsightCurrentTransferResultSchema.parse(input.result);
  const pages = input.pages.map((page) => HindsightCurrentMappingPageSchema.parse(page));
  assertResult(input.prepared, result);
  const manifest = result.manifest;
  if (pages.length !== manifest.total_pages || manifest.page_hashes.length !== manifest.total_pages
    || Math.ceil(manifest.total_records / manifest.page_size) !== manifest.total_pages) fail();
  pages.forEach((page, index) => assertPage({ page, index, result }));
  const mappings = pages.flatMap((page) => page.mappings);
  if (mappings.length !== manifest.total_records || hindsightCurrentStateHash(mappings) !== manifest.mappings_hash) fail();
  assertMappings(input.prepared, result, mappings);
  const body = { schemaVersion: 1 as const, preparationId: input.prepared.preparationId, result, pages, mappings };
  return HindsightCurrentImportEvidenceSchema.parse({ ...body, evidenceId: canonicalPayloadHash(["taki-current-import-evidence.v1", body]) });
}

function assertResult(prepared: HindsightPreparedCurrentBank, result: HindsightCurrentTransferResult): void {
  const request = prepared.request; if (!request || prepared.gaps.length) fail();
  const { result_hash: resultHash, ...body } = result;
  if (request.request_hash !== hindsightCurrentRequestHash(prepared.bankId, request)
    || resultHash !== hindsightCurrentStateHash(body) || result.operation_id !== prepared.operationId
    || result.request_hash !== request.request_hash || result.bank_id !== prepared.bankId
    || result.source_bank_id !== prepared.sourceBankId || result.provider_lineage !== request.provider_lineage
    || result.bank_generation !== request.bank_generation || result.local_manifest_digest !== prepared.localManifestDigest
    || result.native_through_cursor < result.native_before_cursor || result.superseded_count !== request.supersede.length) fail();
}

function assertPage(input: { page: HindsightCurrentMappingPage; index: number; result: HindsightCurrentTransferResult }): void {
  const { page, index, result } = input; const manifest = result.manifest;
  if (page.operation_id !== result.operation_id || page.bank_id !== result.bank_id
    || page.provider_lineage !== result.provider_lineage || page.bank_generation !== result.bank_generation
    || page.result_hash !== result.result_hash || page.page_number !== index || page.total_pages !== manifest.total_pages
    || page.mappings.length !== Math.min(manifest.page_size, manifest.total_records - index * manifest.page_size)
    || page.page_hash !== manifest.page_hashes[index]
    || page.page_hash !== hindsightCurrentStateHash({ page_number: index, mappings: page.mappings })) fail();
}

function assertMappings(prepared: HindsightPreparedCurrentBank, result: HindsightCurrentTransferResult, mappings: HindsightCurrentMapping[]): void {
  const request = prepared.request; if (!request) fail();
  const sources = [request.source_bank, ...request.documents.map((item) => item.source),
    ...request.memory_units.map((item) => item.source), ...request.mental_models.map((item) => item.source),
    ...request.directives.map((item) => item.source)];
  const expected = new Map(sources.map((source) => [`${source.source_kind}:${source.source_id}`, source]));
  if (expected.size !== sources.length || expected.size !== mappings.length) fail();
  const targets = new Set<string>(); const cursors = new Set<number>();
  const writes = mappings.length > 1 || request.supersede.length > 0;
  if (writes ? result.native_batch_id === null || result.native_through_cursor <= result.native_before_cursor
    : result.native_batch_id !== null || result.native_through_cursor !== result.native_before_cursor) fail();
  mappings.forEach((mapping, ordinal) => {
    const key = `${mapping.source.source_kind}:${mapping.source.source_id}`; const source = expected.get(key);
    const target = `${mapping.target_kind}:${mapping.target_id}`;
    if (!source || mapping.ordinal !== ordinal || mapping.target_kind !== source.source_kind || targets.has(target)
      || hindsightCurrentStateHash(mapping.source) !== hindsightCurrentStateHash(source)) fail();
    if (mapping.target_kind === "bank") {
      if (mapping.target_id !== prepared.bankId || mapping.target_revision !== request.target_bank.object_revision
        || mapping.target_payload_hash !== request.target_bank.payload_hash
        || mapping.journal_cursor !== null && (mapping.journal_cursor < 1 || mapping.journal_cursor > result.native_before_cursor)) fail();
    } else {
      if (mapping.journal_cursor === null || mapping.journal_cursor <= result.native_before_cursor
        || mapping.journal_cursor > result.native_through_cursor || cursors.has(mapping.journal_cursor)) fail();
      cursors.add(mapping.journal_cursor);
    }
    expected.delete(key); targets.add(target);
  });
  if (expected.size) fail();
}

function fail(): never { throw new Error("HINDSIGHT_CURRENT_IMPORT_PROOF_INVALID"); }
