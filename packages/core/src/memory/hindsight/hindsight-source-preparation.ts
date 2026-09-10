/**
 * INPUT:  one canonical Local source and its separately identified current records
 * OUTPUT: deterministic version-1 native retain item and complete immutable typed evidence, including explicit gaps
 * POS:    core/memory/hindsight — local-only preparation; existing G1 Pending serialization is unchanged
 */
import { createHash } from "node:crypto";
import {
  CanonicalMemoryRecordSchema, CanonicalMemorySourceSchema, HINDSIGHT_NATIVE_RESULT_VERSION,
  nativeProofJson, nativeRetainRequestFields, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type HindsightNativeRetainItem, type JsonValue,
  HINDSIGHT_SOURCE_EVIDENCE_VERSION, HINDSIGHT_SOURCE_GAP_LIMIT, HindsightPreparedSourceSchema,
  type HindsightPreparedSource, type HindsightSourcePreparationGap,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";

// These are representation limits of the existing snapshot and G1 transport,
// not new restrictions on Canonical Memory or the durable evidence payload.
const NATIVE_METADATA_KEYS = 128;
const NATIVE_METADATA_VALUE_CHARS = 100_000;
const NATIVE_REQUEST_BYTES = 512 * 1024;
const PLACEHOLDER_UUID = "00000000-0000-4000-8000-000000000000";

export function encodeHindsightSourceMetadataV1(metadata: Record<string, JsonValue>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? value : canonicalJson(value)]));
}

export function prepareHindsightSource(input: {
  source: CanonicalMemorySource; records: CanonicalMemoryRecord[];
}): HindsightPreparedSource {
  const parsed = CanonicalMemorySourceSchema.safeParse(input.source);
  if (!parsed.success) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
  const source = parsed.data;
  const records = input.records.map((raw) => {
    const record = CanonicalMemoryRecordSchema.safeParse(raw);
    if (!record.success) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
    return record.data;
  })
    .sort((a, b) => a.unit.memoryId < b.unit.memoryId ? -1 : a.unit.memoryId > b.unit.memoryId ? 1 : 0);
  assertSourceRelationships(source, records);
  const gaps = preparationGaps(source, records);
  const nativeItem = gaps.length === 0 ? sourceItem(source) : null;
  const body = { schemaVersion: HINDSIGHT_SOURCE_EVIDENCE_VERSION, source, sourceHash: canonicalPayloadHash(source),
    retainedTextHash: source.retainedText === null ? null : createHash("sha256").update(source.retainedText, "utf8").digest("hex"),
    units: records.map((record) => ({ record, recordHash: canonicalPayloadHash(record) })),
    nativeItem, nativeItemHash: nativeItem === null ? null : canonicalPayloadHash(["taki-hindsight-native-item.v1", nativeItem]),
    gapCount: gaps.length, gaps: gaps.slice(0, HINDSIGHT_SOURCE_GAP_LIMIT) };
  return HindsightPreparedSourceSchema.parse({ ...body,
    evidenceId: canonicalPayloadHash(["taki-hindsight-source-evidence.v1", body]) });
}

export function assertPreparedHindsightSource(raw: HindsightPreparedSource): HindsightPreparedSource {
  const parsed = HindsightPreparedSourceSchema.safeParse(raw);
  if (!parsed.success) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
  const expected = prepareHindsightSource({ source: parsed.data.source, records: parsed.data.units.map(({ record }) => record) });
  if (canonicalJson(expected) !== canonicalJson(parsed.data)) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
  return expected;
}

function assertSourceRelationships(source: CanonicalMemorySource, records: CanonicalMemoryRecord[]): void {
  let prior: string | undefined;
  for (const { unit } of records) {
    if (unit.authorityEpochId !== source.authorityEpochId || unit.bankId !== source.bankId
      || unit.documentId !== source.documentId || unit.memoryId === prior) throw new Error("HINDSIGHT_SOURCE_RELATIONSHIP_INVALID");
    prior = unit.memoryId;
  }
}

function sourceItem(source: CanonicalMemorySource): HindsightNativeRetainItem {
  if (!source.retainedText) throw new Error("HINDSIGHT_SOURCE_NATIVE_UNREPRESENTABLE");
  // A source has no per-unit entity or policy ownership. Native extraction owns
  // those fields; binding a resulting unit is a separate explicit operation.
  return { content: source.retainedText, document_id: source.documentId, context: source.context,
    timestamp: source.provenance.capturedAt, tags: source.tags, entities: [],
    metadata: encodeHindsightSourceMetadataV1(source.metadata), observation_scopes: source.observationScopes,
    strategy: null, update_mode: "replace" };
}

function preparationGaps(source: CanonicalMemorySource, records: CanonicalMemoryRecord[]): HindsightSourcePreparationGap[] {
  const gaps = metadataGaps(source.metadata, { objectKind: "document", objectId: source.documentId });
  for (const { unit } of records) gaps.push(...metadataGaps(unit.metadata, { objectKind: "memory_unit", objectId: unit.memoryId }));
  const identity = { objectKind: "document" as const, objectId: source.documentId };
  if (source.retainedText === null) gaps.push({ ...identity, code: "source_text_missing" });
  else if (source.retainedText.length === 0) gaps.push({ ...identity, code: "source_text_empty" });
  else {
    const request = { contract_version: HINDSIGHT_NATIVE_RESULT_VERSION, operation_id: PLACEHOLDER_UUID,
      provider_lineage: PLACEHOLDER_UUID, bank_generation: PLACEHOLDER_UUID, items: [sourceItem(source)] };
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > NATIVE_REQUEST_BYTES) gaps.push({ ...identity, code: "native_request_bytes" });
    try { nativeProofJson(nativeRetainRequestFields("prepared-native-bank", request)); }
    catch { gaps.push({ ...identity, code: "native_unicode" }); }
  }
  return [...new Map(gaps.map((gap) => [canonicalJson([gap.objectKind, gap.objectId, gap.code]), gap])).values()];
}

function metadataGaps(metadata: Record<string, JsonValue>, identity: Pick<HindsightSourcePreparationGap, "objectKind" | "objectId">): HindsightSourcePreparationGap[] {
  const encoded = encodeHindsightSourceMetadataV1(metadata); const gaps: HindsightSourcePreparationGap[] = [];
  if (Object.keys(encoded).length > NATIVE_METADATA_KEYS) gaps.push({ ...identity, code: "native_metadata_keys" });
  if (Object.values(encoded).some((value) => value.length > NATIVE_METADATA_VALUE_CHARS)) gaps.push({ ...identity, code: "native_metadata_value" });
  if (new TextEncoder().encode(JSON.stringify(encoded)).byteLength > NATIVE_REQUEST_BYTES) gaps.push({ ...identity, code: "native_request_bytes" });
  // String values survive JSON unchanged. Portable native hashing rejects lone
  // surrogates; do not silently replace them with U+FFFD or alter Local evidence.
  if (Object.entries(encoded).some(([key, value]) => hasLoneSurrogate(key) || hasLoneSurrogate(value))) gaps.push({ ...identity, code: "native_unicode" });
  return gaps;
}

function hasLoneSurrogate(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point >= 0xd800 && point <= 0xdfff;
  });
}
