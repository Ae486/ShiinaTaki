/**
 * INPUT:  prepared source evidence, the frozen native request/result pages, and parsed snapshot or journal records
 * OUTPUT: exact immutable document/unit binding candidates with complete native namespace and payload hashes
 * POS:    core/memory/hindsight — confirmation gate; receipts alone never invent object revisions or payloads
 */
import { createHash } from "node:crypto";
import { HindsightLogicalSnapshotRecordSchema, nativeProofJson, nativeReferenceFields, nativeRetainRequestFields,
  type HindsightLogicalSnapshotRecord, type HindsightNativeReference, type HindsightNativeResult,
  HindsightSourceConfirmationSchema, HindsightSourceObjectBindingSchema,
  type HindsightPreparedSource, type HindsightSourceBankBinding, type HindsightSourceConfirmation, type HindsightSourceObjectBinding,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { assertNativeResultHashes, nativeProofHash } from "./hindsight-native-proof.ts";
import { encodeHindsightSourceMetadataV1 } from "./hindsight-source-preparation.ts";
import { verifyLogicalSnapshot } from "./hindsight-snapshot-validator.ts";

interface Observation {
  records: Map<string, { record: HindsightLogicalSnapshotRecord | null; observationId: string }>;
  kind: "snapshot" | "journal"; cursor: number;
}

export function confirmHindsightSourceBindings(prepared: HindsightPreparedSource, raw: HindsightSourceConfirmation,
  bank: HindsightSourceBankBinding): HindsightSourceObjectBinding[] {
  const parsed = HindsightSourceConfirmationSchema.safeParse(raw);
  if (!parsed.success) throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  const input = parsed.data;
  if (prepared.source.bankId !== bank.sourceBankId || input.result.bank_id !== bank.nativeBankId) fail();
  assertRequestResult(prepared, input);
  const references = verifyReferences(input);
  const observation = readObservation(input);
  const document = requireRecord(observation, "document", prepared.source.documentId);
  assertDocument(prepared, input.result, document.record);
  const bindings = [makeBinding({ prepared, input, observation, bank }, { ...document, sourceMemoryId: null })];
  for (const association of input.unitAssociations) {
    const nativeId = association.nativeMemoryId.toLowerCase();
    const observed = requireRecord(observation, "memory_unit", nativeId);
    assertUnit({ prepared, sourceMemoryId: association.sourceMemoryId, reference: references.get(nativeId) }, observed.record);
    bindings.push(makeBinding({ prepared, input, observation, bank }, { ...observed, sourceMemoryId: association.sourceMemoryId }));
  }
  return bindings;
}

export function hindsightSourceBindingId(binding: Omit<HindsightSourceObjectBinding, "bindingId">): string {
  return canonicalPayloadHash(["taki-hindsight-source-binding.v1", binding.schemaVersion, binding.evidenceId,
    binding.sourceBankId, binding.bankScope, binding.sourceDocumentId, binding.sourceMemoryId, binding.providerLineageId, binding.bankGeneration, binding.bankId,
    binding.objectKind, binding.objectId, binding.objectRevision, binding.nativePayloadHash, binding.operationId,
    binding.requestHash, binding.resultHash, binding.nativeReceiptHash, binding.nativeThroughCursor,
    binding.observationKind, binding.observationId, binding.observedCursor]);
}

function assertRequestResult(prepared: HindsightPreparedSource, input: HindsightSourceConfirmation): void {
  const { request, result } = input;
  if (prepared.evidenceId !== input.evidenceId || prepared.nativeItem === null || prepared.gapCount !== 0) fail();
  try { assertNativeResultHashes(result); } catch { fail(); }
  if (request.items.length !== 1 || canonicalJson(request.items[0]) !== canonicalJson(prepared.nativeItem)
    || new TextEncoder().encode(JSON.stringify(request)).byteLength > 512 * 1024
    || (request.document_tags ?? []).length !== 0 || result.operation_kind !== "retain"
    || result.provider_lineage !== request.provider_lineage
    || result.bank_generation !== request.bank_generation || result.operation_id !== request.operation_id
    || result.request_hash !== nativeProofHash(nativeRetainRequestFields(result.bank_id, request))
    || result.inputs.length !== 1) fail();
  const source = result.inputs[0];
  if (!source || source.document_id !== prepared.source.documentId || source.update_mode !== "replace"
    || source.document_hash !== prepared.retainedTextHash || source.created_count > source.full_result_count) fail();
}

function verifyReferences(input: HindsightSourceConfirmation): Map<string, HindsightNativeReference> {
  const result = input.result; const references = new Map<string, HindsightNativeReference>();
  if (input.resultPages.length !== result.manifest.total_pages) fail();
  const digest = createHash("sha256").update("taki-native-references.v1\n");
  let ordinal = 0; let priorId = "";
  for (const [index, page] of input.resultPages.entries()) {
    const first = index * result.manifest.page_size;
    if (page.operation_id !== result.operation_id || page.operation_kind !== result.operation_kind
      || page.bank_id !== result.bank_id || page.provider_lineage !== result.provider_lineage
      || page.bank_generation !== result.bank_generation || page.result_hash !== result.result_hash
      || page.page_number !== index || page.first_ordinal !== first
      || page.references.length !== Math.min(result.manifest.page_size, result.manifest.total_records - first)
      || page.page_sha256 !== nativeProofHash(["taki-native-page.v1", result.result_hash, index, page.references.map(nativeReferenceFields)])) fail();
    for (const reference of page.references) {
      const memoryId = reference.memory_id.toLowerCase();
      if (reference.ordinal !== ordinal || reference.input_index !== 0 || reference.document_id !== result.inputs[0]?.document_id
        || memoryId <= priorId) fail();
      digest.update(`${nativeProofJson(nativeReferenceFields(reference))}\n`);
      references.set(memoryId, reference); priorId = memoryId; ordinal += 1;
    }
  }
  if (ordinal !== result.manifest.total_records || digest.digest("hex") !== result.manifest.references_sha256) fail();
  return references;
}

function readObservation(input: HindsightSourceConfirmation): Observation {
  const value = input.observation; const result = input.result;
  const records: Observation["records"] = new Map();
  if (value.kind === "snapshot") {
    const snapshot = verifyLogicalSnapshot({ ...value, expectedBankId: result.bank_id,
      expectedProviderLineage: result.provider_lineage, now: input.confirmedAt });
    if (snapshot.metadata.manifest.bankGeneration !== result.bank_generation
      || snapshot.metadata.manifest.endCursor < result.native_through_cursor) fail();
    for (const record of snapshot.records) {
      const key = recordKey(record.objectKind, record.objectId);
      if (record.payload.value.bankId !== result.bank_id || records.has(key)) fail();
      records.set(key, { record, observationId: snapshot.metadata.snapshotId });
    }
    return { kind: value.kind, records, cursor: snapshot.metadata.manifest.endCursor };
  }
  const page = value.page;
  if (page.bankId !== result.bank_id || page.providerLineageId !== result.provider_lineage
    || page.bankGeneration !== result.bank_generation || page.nextCursor < result.native_through_cursor) fail();
  for (const change of page.changes) {
    if (change.objectKind === "document" && change.objectRevision !== change.cursor) fail();
    const record = change.operation === "tombstone" ? null : HindsightLogicalSnapshotRecordSchema.parse({
      objectKind: change.objectKind, objectId: change.objectId, objectRevision: change.objectRevision, payload: change.payload });
    records.set(recordKey(change.objectKind, change.objectId), { record, observationId: change.batchId });
  }
  return { kind: value.kind, records, cursor: page.nextCursor };
}

function requireRecord(observation: Observation, kind: string, id: string): { record: HindsightLogicalSnapshotRecord; observationId: string } {
  const observed = observation.records.get(recordKey(kind, id));
  if (!observed?.record) throw new Error("HINDSIGHT_SOURCE_NATIVE_OBJECT_MISSING");
  return { record: observed.record, observationId: observed.observationId };
}

function assertDocument(prepared: HindsightPreparedSource, result: HindsightNativeResult, record: HindsightLogicalSnapshotRecord): void {
  if (record.payload.kind !== "document" || record.objectRevision > result.native_through_cursor
    || record.payload.value.contentHash !== result.inputs[0]?.document_hash
    || canonicalJson(record.payload.value.metadata) !== canonicalJson(prepared.nativeItem?.metadata)) fail();
}

function assertUnit(input: {
  prepared: HindsightPreparedSource; sourceMemoryId: string; reference: HindsightNativeReference | undefined;
}, record: HindsightLogicalSnapshotRecord): void {
  const source = input.prepared.units.find(({ record: candidate }) => candidate.unit.memoryId === input.sourceMemoryId);
  const reference = input.reference;
  if (!source || !reference || record.payload.kind !== "memory_unit") fail();
  const unit = record.payload.value;
  if (unit.documentId !== input.prepared.source.documentId || record.objectRevision !== reference.revision
    || unit.state !== reference.state || canonicalJson(unit.metadata) !== canonicalJson(encodeHindsightSourceMetadataV1(source.record.unit.metadata))) fail();
  const layerTags = unit.tags.filter((tag) => tag.startsWith("taki-layer:"));
  if (layerTags.length !== 1 || layerTags[0] !== `taki-layer:${source.record.policy.layerId}`) throw new Error("HINDSIGHT_SOURCE_LAYER_MISMATCH");
}

function makeBinding(context: { prepared: HindsightPreparedSource; input: HindsightSourceConfirmation; observation: Observation; bank: HindsightSourceBankBinding }, object: {
  record: HindsightLogicalSnapshotRecord; observationId: string; sourceMemoryId: string | null;
}): HindsightSourceObjectBinding {
  const result = context.input.result; const record = object.record;
  const body = { schemaVersion: 1 as const, evidenceId: context.prepared.evidenceId,
    sourceBankId: context.bank.sourceBankId, bankScope: context.bank.scope,
    sourceDocumentId: context.prepared.source.documentId, sourceMemoryId: object.sourceMemoryId,
    providerLineageId: result.provider_lineage, bankGeneration: result.bank_generation, bankId: result.bank_id,
    objectKind: record.objectKind, objectId: record.objectId, objectRevision: record.objectRevision,
    nativePayloadHash: canonicalPayloadHash(record.payload), operationId: result.operation_id,
    requestHash: result.request_hash, resultHash: result.result_hash, nativeReceiptHash: result.native_receipt_hash,
    nativeThroughCursor: result.native_through_cursor, observationKind: context.observation.kind,
    observationId: object.observationId, observedCursor: context.observation.cursor, confirmedAt: context.input.confirmedAt };
  const parsed = HindsightSourceObjectBindingSchema.parse({ ...body, bindingId: "0".repeat(64) });
  return { ...parsed, bindingId: hindsightSourceBindingId(parsed) };
}

function recordKey(kind: string, id: string): string { return canonicalJson([kind, id]); }
function fail(): never { throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID"); }
