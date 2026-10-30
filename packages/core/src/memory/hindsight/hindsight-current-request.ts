/**
 * INPUT:  complete typed Local capture, one Bank and an explicit frozen native target baseline
 * OUTPUT: structural current-state request preserving every native logical field without extraction
 * POS:    core/memory/hindsight — D78 adapter; source policy/provenance remain complete Local evidence
 */
import { HindsightCurrentTransferRequestSchema, HINDSIGHT_CURRENT_STATE_VERSION, HINDSIGHT_CURRENT_STATE_ENCODING,
  HINDSIGHT_CURRENT_STATE_MAX_BYTES, HINDSIGHT_CURRENT_STATE_MAX_RECORDS,
  type HindsightCurrentCapture, type HindsightCurrentSourceWitness, type HindsightCurrentTransferRequest,
  type HindsightCurrentPreparationGap } from "@taki/shared";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { hindsightCurrentRequestHash } from "./hindsight-current-state-hash.ts";
import { currentRequestRepresentationGaps } from "./hindsight-current-request-preflight.ts";

export function buildCurrentTransferRequest(input: {
  capture: HindsightCurrentCapture; sourceBankId: string; bankId: string; operationId: string;
  providerLineage: string; bankGeneration: string; baseline: Pick<HindsightCurrentTransferRequest, "target_bank" | "preserve">;
  supersede: HindsightCurrentTransferRequest["supersede"];
}): { request: HindsightCurrentTransferRequest | null; gaps: HindsightCurrentPreparationGap[] } {
  const bank = input.capture.banks.find((candidate) => candidate.bankId === input.sourceBankId);
  if (!bank) throw new Error("HINDSIGHT_CURRENT_BANK_MISSING");
  const sources = input.capture.sources.filter((source) => source.bankId === bank.bankId);
  const records = input.capture.records.filter((record) => record.unit.bankId === bank.bankId);
  const derived = input.capture.derived.filter((record) => record.bankId === bank.bankId);
  const gaps = relationshipGaps({ records, sources });
  if (1 + sources.length + records.length + derived.length > HINDSIGHT_CURRENT_STATE_MAX_RECORDS) {
    gaps.push({ code: "native_record_limit", objectKind: "bank", objectId: bank.bankId });
  }
  const value = { contract_version: HINDSIGHT_CURRENT_STATE_VERSION, encoding: HINDSIGHT_CURRENT_STATE_ENCODING,
    operation_id: input.operationId, request_hash: "0".repeat(64), local_manifest_digest: input.capture.manifest.manifestDigest,
    provider_lineage: input.providerLineage, bank_generation: input.bankGeneration, ...input.baseline,
    source_bank: sourceWitness("bank", { id: bank.bankId, revision: bank.revision, value: bank }),
    documents: sources.map((source) => ({ ...nativeFields(source, ["authorityEpochId", "bankId", "documentId", "revision", "provenance", "retainedText"]),
      source: sourceWitness("document", { id: source.documentId, revision: source.revision, value: source }), original_text: source.retainedText })),
    chunks: [], memory_units: records.map((record) => ({ ...nativeFields(record.unit, ["authorityEpochId", "bankId", "memoryId", "revision"]),
      source: sourceWitness("memory_unit", { id: record.unit.memoryId, revision: record.unit.revision, value: record }) })),
    mental_models: derived.filter((record) => record.payload.kind === "mental_model").map((record) => ({
      ...nativeFields(record.payload, ["kind", "bankId", "mentalModelId"]),
      source: sourceWitness("mental_model", { id: "mentalModelId" in record.payload ? record.payload.mentalModelId : "", revision: record.objectRevision, value: record }) })),
    directives: derived.filter((record) => record.payload.kind === "directive").map((record) => ({
      ...nativeFields(record.payload, ["kind", "bankId", "directiveId"]),
      source: sourceWitness("directive", { id: "directiveId" in record.payload ? record.payload.directiveId : "", revision: record.objectRevision, value: record }) })),
    supersede: input.supersede };
  try {
    const request = HindsightCurrentTransferRequestSchema.parse(value);
    gaps.push(...currentRequestRepresentationGaps(request));
    request.request_hash = hindsightCurrentRequestHash(input.bankId, request);
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > HINDSIGHT_CURRENT_STATE_MAX_BYTES) {
      gaps.push({ code: "native_request_bytes", objectKind: "bank", objectId: bank.bankId });
    }
    return { request: gaps.length ? null : request, gaps };
  } catch {
    gaps.push({ code: "native_value", objectKind: "bank", objectId: bank.bankId }); return { request: null, gaps };
  }
}

function sourceWitness(kind: HindsightCurrentSourceWitness["source_kind"], input: { id: string; revision: number; value: unknown }): HindsightCurrentSourceWitness {
  return { source_kind: kind, source_id: input.id, source_revision: input.revision, source_payload_hash: canonicalPayloadHash(input.value) };
}
function nativeFields(value: object, omit: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)).map(([key, item]) =>
    [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item]));
}
function relationshipGaps(input: Pick<HindsightCurrentCapture, "records" | "sources">): HindsightCurrentPreparationGap[] {
  const sources = new Set(input.sources.map((source) => source.documentId));
  const units = new Set(input.records.map((record) => record.unit.memoryId)); const gaps: HindsightCurrentPreparationGap[] = [];
  for (const { unit } of input.records) {
    const identity = { objectKind: "memory_unit" as const, objectId: unit.memoryId };
    if (unit.chunkId !== null) gaps.push({ ...identity, code: "chunk_evidence_unavailable" });
    if (unit.documentId !== null && !sources.has(unit.documentId) || unit.sourceMemoryIds.some((id) => !units.has(id))) {
      gaps.push({ ...identity, code: "missing_source" });
    }
  }
  return gaps;
}
