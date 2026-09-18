/**
 * INPUT:  exact native document/source bytes and independently preserved original Source artifacts
 * OUTPUT: truthful current-source projection and operation-proven awaiting-source resolution
 * POS:    core/memory/hindsight — source association proof; no operation-ID-only text fallback or invented conversation provenance
 */
import { createHash } from "node:crypto";
import {
  HINDSIGHT_NATIVE_RESULT_VERSION, HindsightCurrentCanonicalSourceSchema, TakiApplicationSourceBodySchema,
  type TakiApplicationNativeRecord, type MemoryBankScope, type TakiApplicationSourceBody,
  type TakiApplicationArtifact, type TakiApplicationNativeSourceEvidence,
} from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { assertNativeResultHashes } from "./hindsight-native-proof.ts";
import type { HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";

export function readHindsightApplicationSourceEvidence(input: HindsightApplicationScope & {
  native: TakiApplicationNativeRecord; evidence: HindsightApplicationEvidenceReader;
}): TakiApplicationNativeSourceEvidence {
  if (input.native.version.object_kind !== "document" || !input.native.source_evidence_ref) invalid();
  const body = input.evidence.body(input.native.source_evidence_ref).content;
  if (body.body_schema !== "application-native-source.v1" || !sameApplicationValue(body.value.document_version, input.native.version)) invalid();
  return body.value;
}

export function createHindsightApplicationProviderSource(input: HindsightApplicationScope & {
  native: TakiApplicationNativeRecord; source: TakiApplicationNativeSourceEvidence;
  authorityEpochId: string; bankScope: MemoryBankScope; at: string;
}): TakiApplicationSourceBody {
  const payload = input.native.payload;
  if (input.native.version.object_kind !== "document" || !("content_hash" in payload)) invalid();
  if (!sameApplicationValue(input.source.document_version, input.native.version)) invalid();
  const text = input.source.availability === "available" ? input.source.original_text : null;
  const context = input.source.context;
  if (text !== null && text.trim() && !isSafeAutomaticMemoryText(text)
    || context !== null && context.trim() && !isSafeAutomaticMemoryText(context)) invalid();
  const version = input.native.version;
  const original = HindsightCurrentCanonicalSourceSchema.parse({ authorityEpochId: input.authorityEpochId,
    bankId: input.bankId, documentId: payload.document_id, contentHash: payload.content_hash,
    retainedText: text, context, tags: payload.tags, metadata: payload.metadata, observationScopes: payload.observation_scopes,
    revision: version.object_revision, createdAt: payload.created_at, updatedAt: payload.updated_at,
    provenance: { actor: "provider", origin: "provider-derived", characterId: input.bankScope.characterId,
      timelineFromSeq: null, timelineToSeq: null, capturedAt: input.at, sanitized: true,
      sourceRef: `hindsight:${input.namespace.provider_lineage}:${input.namespace.bank_generation}:document:${version.object_id}@${version.object_revision}` } });
  return TakiApplicationSourceBodySchema.parse({ original_source: original, encoded_metadata: payload.metadata,
    original_witness: applicationNativeSourceWitness(input.native), operation_id: null });
}

export async function proveHindsightAwaitingSource(input: HindsightApplicationScope & {
  client: HindsightClient; artifact: TakiApplicationArtifact; source: TakiApplicationSourceBody;
  native: TakiApplicationNativeRecord; evidence: TakiApplicationNativeSourceEvidence; request(): HindsightCallContext;
}): Promise<TakiApplicationSourceBody | undefined> {
  const binding = input.artifact.binding;
  if (binding.kind !== "awaiting_native" || input.source.operation_id !== binding.operation_id
    || input.native.version.object_kind !== "document" || input.native.version.object_id !== binding.document_id) invalid();
  if (!input.client.nativeResult) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
  const identity = { contract_version: HINDSIGHT_NATIVE_RESULT_VERSION, operation_id: binding.operation_id,
    provider_lineage: input.namespace.provider_lineage, bank_generation: input.namespace.bank_generation };
  const status = await input.client.nativeResult({ bankId: input.bankId, kind: "retain", identity, context: input.request() });
  input.request();
  if (status.bank_id !== input.bankId || status.operation_kind !== "retain" || status.operation_id !== binding.operation_id
    || status.provider_lineage !== identity.provider_lineage || status.bank_generation !== identity.bank_generation) invalid();
  if (status.status !== "completed" || !status.result) return undefined;
  const result = status.result; assertNativeResultHashes(result);
  if (result.bank_id !== input.bankId || result.operation_id !== binding.operation_id || result.operation_kind !== "retain"
    || result.provider_lineage !== identity.provider_lineage || result.bank_generation !== identity.bank_generation
    || result.request_hash !== status.request_hash || result.inputs.length !== 1) invalid();
  const source = result.inputs[0];
  if (!source || source.document_id !== binding.document_id) invalid();
  if (!sameApplicationValue(input.evidence.document_version, input.native.version)) invalid();
  const text = input.evidence.original_text;
  if (input.evidence.availability !== "available" || text === null) return undefined;
  if (createHash("sha256").update(text, "utf8").digest("hex") !== source.document_hash) return undefined;
  const payload = input.native.payload;
  if (!("content_hash" in payload) || payload.content_hash !== source.document_hash) return undefined;
  // An append fragment is retained as its original artifact. It is not the
  // entire current document; projection compares actual native source bytes.
  return TakiApplicationSourceBodySchema.parse({ ...input.source, original_witness: applicationNativeSourceWitness(input.native) });
}

export function applicationNativeSourceWitness(native: TakiApplicationNativeRecord) {
  const version = native.version;
  return { source_kind: version.object_kind, source_id: version.object_id,
    source_revision: version.object_revision, source_payload_hash: version.payload_hash };
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_SOURCE_BINDING_INVALID"); }
