/**
 * INPUT:  owned isolated test databases and deterministic native wire values
 * OUTPUT: real Local/B3 preparation plus synthetic provider receipts for consumer contract tests
 * POS:    core/db — test support only; root integration independently uses the real native HTTP producer
 */
import { createHash } from "node:crypto";
import { HindsightSnapshotRecordWireSchema, HindsightCurrentTransferResultSchema, HindsightCutoverVerificationStatusSchema,
  type HindsightSnapshotRecordWire, type HindsightSnapshotMetadataWire, type HindsightSnapshotPageWire,
  type HindsightPreparedCurrentBank, type HindsightCurrentMapping, type HindsightCurrentImportEvidence,
  type HindsightCutoverEvidenceRecord, type HindsightCutoverRequirement, type HindsightCutoverCertificate } from "@taki/shared";
import { createLocalCoverageFixture, LOCAL_COVERAGE_NOW } from "./hindsight-local-coverage-fixtures.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";
import { prepareHindsightCurrentBank } from "./hindsight-current-preparation-repo.ts";
import { hindsightBankBindings } from "../memory/hindsight/hindsight-bank-identity.ts";
import { loadTakiBankTemplate, takiBankTemplateDigest } from "../memory/hindsight/taki-bank-template-v1.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";
import { currentStateFieldsWithout, hindsightCurrentStateHash } from "../memory/hindsight/hindsight-current-state-hash.ts";
import { currentVerificationRequest } from "../memory/hindsight/hindsight-current-verification-identity.ts";
import { currentRequirementKey, currentRequiredSetHash, currentInputManifestHash, currentWitnessListHash } from "../memory/hindsight/hindsight-current-maintenance-hash.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { hindsightOperationUuid } from "../memory/hindsight/hindsight-import-identity.ts";
import type { Database } from "./sqlite.ts";

export const CURRENT_LINEAGE = "11111111-1111-4111-8111-111111111111";
export const CURRENT_GENERATION = "22222222-2222-4222-8222-222222222222";
export const CURRENT_VERIFICATION = "33333333-3333-4333-8333-333333333333";
export const CURRENT_REPLICA = "44444444-4444-4444-8444-444444444444";
const at = LOCAL_COVERAGE_NOW;

export function currentStateFixture(db: Database) {
  const fixture = createLocalCoverageFixture(db); const binding = hindsightBankBindings("taki")[0];
  if (!binding) throw new Error("TEST_BANK_MISSING");
  const bankId = binding.externalBankId; const template = loadTakiBankTemplate("taki-bank-v1", "global");
  const templateDigest = takiBankTemplateDigest(template);
  createHindsightBankSetupRepo(db).upsert({ scope: "global", canonicalIdentity: "global", externalBankId: bankId,
    templateRevision: "taki-bank-v1", templateDigest, status: "verified", operationIds: [], lastVerifiedAt: at, lastError: null });
  const model = template.manifest.mental_models?.[0]; const directive = template.manifest.directives?.[0];
  if (!model || !directive) throw new Error("TEST_TEMPLATE_MISSING");
  const baselineRecords = [
    HindsightSnapshotRecordWireSchema.parse({ object_kind: "bank", object_id: bankId, object_revision: 1,
      payload: { bank_id: bankId, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
        mission: "", config: template.manifest.bank, created_at: at, updated_at: at } }),
    HindsightSnapshotRecordWireSchema.parse({ object_kind: "mental_model", object_id: model.id, object_revision: 2,
      payload: { mental_model_id: model.id, bank_id: bankId, subtype: "pinned", name: model.name, source_query: model.source_query,
        content: "Authored continuity.", tags: model.tags, max_tokens: model.max_tokens, trigger: {}, last_refreshed_at: null,
        created_at: at, reflect_response: null, structured_content: null } }),
    HindsightSnapshotRecordWireSchema.parse({ object_kind: "directive", object_id: "policy-directive", object_revision: 3,
      payload: { ...directive, directive_id: "policy-directive", bank_id: bankId, created_at: at, updated_at: at } }),
  ];
  const baseline = currentSnapshotFixture(baselineRecords, bankId, 10);
  const prepare = () => {
    const manifest = fixture.coverage.selected("run"); if (!manifest) throw new Error("TEST_MANIFEST_MISSING");
    return prepareHindsightCurrentBank(db, { lease: fixture.lease, manifestId: manifest.manifestId,
      expectedEpochId: fixture.epochId, sourceBankId: fixture.bankId, providerLineage: CURRENT_LINEAGE, bankGeneration: CURRENT_GENERATION,
      baseline: { metadata: normalizeSnapshotMetadata(baseline.metadata), pages: baseline.pages.map(normalizeSnapshotPage) }, now: at });
  };
  return { ...fixture, nativeBankId: bankId, template, templateDigest, baselineRecords, baseline, prepare };
}

export function currentSnapshotFixture(records: HindsightSnapshotRecordWire[], bankId: string, endCursor: number) {
  const snapshotId = hindsightOperationUuid(`fixture-snapshot/${bankId}/${endCursor}/${hindsightCurrentStateHash(records)}`);
  const pages: HindsightSnapshotPageWire[] = records.map((record, index) => ({ snapshot_id: snapshotId, page_number: index,
    total_pages: records.length, record_count: 1, content_sha256: createHash("sha256").update(canonicalJson([record])).digest("hex"), records: [record] }));
  const counts = { bank: 0, document: 0, memory_unit: { valid: 0, invalidated: 0 }, mental_model: 0, directive: 0, total: records.length };
  for (const record of records) {
    if (record.object_kind === "memory_unit") counts.memory_unit[record.payload.state === "valid" ? "valid" : "invalidated"]++;
    else counts[record.object_kind]++;
  }
  const metadata: HindsightSnapshotMetadataWire = { snapshot_id: snapshotId, created_at: at, expires_at: "2099-01-01T00:00:00.000Z",
    manifest: { schema_version: 1, bank_id: bankId, provider_lineage: CURRENT_LINEAGE, bank_generation: CURRENT_GENERATION,
      end_cursor: endCursor, page_size: 1, total_pages: records.length, total_records: records.length, counts,
      page_hashes: pages.map((page) => page.content_sha256), sha256: "0".repeat(64) } };
  metadata.manifest.sha256 = snapshotManifestHash(normalizeSnapshotMetadata(metadata));
  return { metadata, pages };
}

/** `prepared` may be the persisted preparation or the transport double's view of a POSTed request plus its Bank identities. */
export function currentImportFixture(prepared: Pick<HindsightPreparedCurrentBank, "request" | "bankId" | "sourceBankId">, baseline: HindsightSnapshotRecordWire[]) {
  const request = prepared.request; if (!request) throw new Error("TEST_REQUEST_MISSING");
  const records = structuredClone(baseline); const mappings: HindsightCurrentMapping[] = [{ ordinal: 0, source: request.source_bank,
    target_kind: "bank", target_id: prepared.bankId, target_revision: request.target_bank.object_revision,
    target_payload_hash: request.target_bank.payload_hash, journal_cursor: null }];
  const id = (kind: string, source: string) => hindsightOperationUuid(`fixture-native/${kind}/${source}`);
  let cursor = 10;
  for (const document of request.documents) {
    const { source, original_text } = document; const payload = currentStateFieldsWithout(document, ["source", "original_text", "context"]);
    const target = id("document", source.source_id); cursor++;
    const record = HindsightSnapshotRecordWireSchema.parse({ object_kind: "document", object_id: target, object_revision: cursor + 1,
      payload: { ...payload, bank_id: prepared.bankId, document_id: target,
        content_hash: original_text === null ? null : createHash("sha256").update(original_text).digest("hex") } });
    records.push(record); mappings.push(mapping(source, record, { ordinal: mappings.length, cursor }));
  }
  for (const unit of request.memory_units) {
    const { source, ...payload } = unit; const target = id("memory_unit", source.source_id); cursor++;
    const record = HindsightSnapshotRecordWireSchema.parse({ object_kind: "memory_unit", object_id: target, object_revision: 1,
      payload: { ...payload, bank_id: prepared.bankId, memory_id: target, revision: 1,
        document_id: unit.document_id === null ? null : id("document", unit.document_id),
        source_memory_ids: unit.source_memory_ids.map((sourceId) => id("memory_unit", sourceId)) } });
    records.push(record); mappings.push(mapping(source, record, { ordinal: mappings.length, cursor }));
  }
  for (const [kind, objects] of [["mental_model", request.mental_models], ["directive", request.directives]] as const) {
    for (const object of objects) {
      const { source, ...payload } = object; const target = id(kind, source.source_id); cursor++;
      const record = HindsightSnapshotRecordWireSchema.parse({ object_kind: kind, object_id: target, object_revision: cursor + 1,
        payload: { ...payload, bank_id: prepared.bankId, [`${kind}_id`]: target } });
      records.push(record); mappings.push(mapping(source, record, { ordinal: mappings.length, cursor }));
    }
  }
  const pageHash = hindsightCurrentStateHash({ page_number: 0, mappings });
  const result = HindsightCurrentTransferResultSchema.parse({ contract_version: request.contract_version, encoding: request.encoding,
    state: "completed", operation_id: request.operation_id, request_hash: request.request_hash, local_manifest_digest: request.local_manifest_digest,
    provider_lineage: request.provider_lineage, bank_generation: request.bank_generation, bank_id: prepared.bankId, source_bank_id: prepared.sourceBankId,
    native_before_cursor: 10, native_through_cursor: cursor, native_batch_id: cursor === 10 ? null : CURRENT_VERIFICATION, superseded_count: 0,
    manifest: { total_records: mappings.length, page_size: 128, total_pages: 1, mappings_hash: hindsightCurrentStateHash(mappings), page_hashes: [pageHash] }, result_hash: "0".repeat(64) });
  result.result_hash = hindsightCurrentStateHash(currentStateFieldsWithout(result, ["result_hash"]));
  const pages = [{ operation_id: result.operation_id, bank_id: prepared.bankId, provider_lineage: request.provider_lineage,
    bank_generation: request.bank_generation, result_hash: result.result_hash, page_number: 0, total_pages: 1, page_hash: pageHash, mappings }];
  return { result, pages, records, snapshot: currentSnapshotFixture(records, prepared.bankId, cursor) };
}

function mapping(source: HindsightCurrentMapping["source"], record: HindsightSnapshotRecordWire, input: { ordinal: number; cursor: number }): HindsightCurrentMapping {
  return { ordinal: input.ordinal, source, target_kind: record.object_kind, target_id: record.object_id, target_revision: record.object_revision,
    target_payload_hash: hindsightCurrentStateHash(record.payload), journal_cursor: input.cursor };
}

export function currentMaintenanceFixture(imported: Pick<HindsightCurrentImportEvidence, "result">, native: ReturnType<typeof currentImportFixture>,
  verificationId = CURRENT_VERIFICATION) {
  const request = currentVerificationRequest({ imported, verificationId });
  const policy = hindsightCurrentStateHash({ observations_enabled: false }); const records: HindsightCutoverEvidenceRecord[] = [];
  const requirements: HindsightCutoverRequirement[] = [];
  for (const record of native.records.filter((row) => row.object_kind === "mental_model" || row.object_kind === "memory_unit"
    && row.payload.state === "valid" && row.payload.fact_type !== "observation")) {
    const kind = record.object_kind === "mental_model" ? "mental_model" : "source_scope";
    const witness = { object_kind: record.object_kind, object_id: record.object_id, object_revision: record.object_revision,
      payload_hash: hindsightCurrentStateHash(record.payload), material_hash: hindsightCurrentStateHash(record.payload) };
    const requirement: HindsightCutoverRequirement = { requirement_key: "0".repeat(64), kind, input: witness,
      scope_tags: kind === "source_scope" ? [] : null, policy_hash: policy };
    requirement.requirement_key = currentRequirementKey(requirement); requirements.push(requirement);
    records.push({ ordinal: records.length, record_kind: "requirement", requirement });
    const source: Extract<HindsightCutoverEvidenceRecord, { record_kind: "input" }> = { ordinal: records.length, record_kind: "input",
      requirement_key: requirement.requirement_key, input_manifest_hash: "0".repeat(64), role: kind === "source_scope" ? "source" : "definition",
      witness, lifecycle: null };
    source.input_manifest_hash = currentInputManifestHash([source]); records.push(source);
    records.push({ ordinal: records.length, record_kind: "outcome", requirement_key: requirement.requirement_key,
      disposition: kind === "source_scope" ? "not_required" : "no_op", reason: kind === "source_scope" ? "observations_disabled" : "native_unchanged",
      verified_cursor: imported.result.native_through_cursor, action_keys: [], input_manifest_hash: source.input_manifest_hash });
    if (kind === "mental_model") records.push(modelRecord(requirement.requirement_key, records.length));
  }
  const requiredHash = currentRequiredSetHash(requirements);
  const candidate = HindsightCutoverVerificationStatusSchema.parse({ ...request, bank_id: imported.result.bank_id, state: "prepared", revision: 1,
    candidate_hash: hindsightCurrentStateHash({ fixture: imported.result.result_hash }), required_set_hash: requiredHash,
    source_scope_count: requirements.filter((row) => row.kind === "source_scope").length,
    model_count: requirements.filter((row) => row.kind === "mental_model").length, reasons: [], certificate: null });
  const pageHash = hindsightCurrentStateHash({ page_number: 0, records });
  const certificate: HindsightCutoverCertificate = { ...request, bank_id: imported.result.bank_id,
    candidate_hash: candidate.candidate_hash, candidate_cursor: imported.result.native_through_cursor,
    required_set_hash: requiredHash, source_scope_count: candidate.source_scope_count, model_count: candidate.model_count, policy_hash: policy,
    evidence: { page_size: 128, total_pages: 1, total_records: records.length, records_hash: hindsightCurrentStateHash(records), page_hashes: [pageHash],
      counts: { requirements: requirements.length, outcomes: requirements.length, inputs: requirements.length, actions: 0, models: candidate.model_count } },
    snapshot: native.snapshot.metadata, snapshot_records_hash: hindsightCurrentStateHash(native.snapshot.pages.flatMap((page) => page.records)),
    snapshot_retained: true,
    certificate_hash: "0".repeat(64) };
  certificate.certificate_hash = hindsightCurrentStateHash(currentStateFieldsWithout(certificate, ["certificate_hash"]));
  const status = HindsightCutoverVerificationStatusSchema.parse({ ...candidate, state: "complete", revision: 2, certificate });
  const pages = [{ verification_id: request.verification_id, bank_id: imported.result.bank_id, provider_lineage: request.provider_lineage,
    bank_generation: request.bank_generation, certificate_hash: certificate.certificate_hash, page_number: 0, total_pages: 1, page_hash: pageHash, records }];
  return { request, candidate, status, pages, snapshotPages: native.snapshot.pages };
}

function modelRecord(requirementKey: string, ordinal: number): Extract<HindsightCutoverEvidenceRecord, { record_kind: "model" }> {
  const empty = currentWitnessListHash([]); const hash = hindsightCurrentStateHash({ fixture: "native-input" });
  return { ordinal, record_kind: "model", requirement_key: requirementKey, requested_mode: "full", effective_mode: "full", mode_fallback_reason: null,
    outcome: "content_preserved_no_new_facts", scope: { tags: ["taki-owned"], tags_match: "all_strict", tag_groups: null, fact_types: null,
      exclude_mental_models: true, exclude_mental_model_ids: [] }, window: { created_after: null, created_before: null, watermark: null },
    authored_baseline_hash: hash, definition_hash: hash, tracking_hash: hash, eligible_hash: empty, retrieved_hash: empty,
    consumed_hash: empty, lifecycle_hash: empty, prompt_hash: null, prompt_truncated: false, applied_operation_count: 0, skipped_operation_count: 0 };
}
