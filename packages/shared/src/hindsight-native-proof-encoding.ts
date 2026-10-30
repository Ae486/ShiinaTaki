/**
 * INPUT:  typed G1 native commands, result manifests and ordered source references
 * OUTPUT: portable ordered JSON encoding for producer hashes in Python and TypeScript
 * POS:    shared protocol — preserves existing local canonicalJson and never hashes an untyped object
 */
import type {
  HindsightNativeIdentity, HindsightNativeInputResult, HindsightNativeOperationKind, HindsightNativeReference,
  HindsightNativeResult, HindsightTrackedMutationRequest, HindsightTrackedRetainRequest,
} from "./hindsight-native-result-schema.ts";

export function nativeProofJson(value: unknown): string {
  validatePortable(value);
  return JSON.stringify(value);
}

function validatePortable(value: unknown): void {
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value))) return;
  if (typeof value === "string") {
    for (const character of value) {
      const point = character.codePointAt(0) ?? 0;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
    }
    return;
  }
  if (Array.isArray(value)) { for (const item of value) validatePortable(item); return; }
  throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
}

export function nativeStringPairs(value: Record<string, string>): string[][] {
  return Object.keys(value).sort(compareUtf8).map((key) => [key, value[key] ?? ""]);
}

function compareUtf8(first: string, second: string): number {
  validatePortable(first); validatePortable(second);
  const encoder = new TextEncoder();
  const a = encoder.encode(first); const b = encoder.encode(second);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function nativeNormalizedTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  const at = new Date(`${match[1]}T${match[2] ?? "00:00:00"}${match[4] ?? "Z"}`);
  if (!Number.isFinite(at.getTime())) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  return `${at.toISOString().slice(0, 19)}.${(match[3] ?? "").padEnd(6, "0")}Z`;
}

function identityFields(identity: HindsightNativeIdentity, bankId: string, kind: HindsightNativeOperationKind): unknown[] {
  return [kind, bankId, identity.provider_lineage.toLowerCase(), identity.bank_generation.toLowerCase(), identity.operation_id.toLowerCase()];
}

export function nativeRetainRequestFields(bankId: string, request: HindsightTrackedRetainRequest): unknown[] {
  const items = request.items.map((item) => [
    item.content, !item.timestamp ? ["default"] : item.timestamp === "unset" ? ["unset"] : ["at", nativeNormalizedTime(item.timestamp)],
    item.context ?? "", nativeStringPairs(item.metadata ?? {}), item.document_id || null,
    (item.entities ?? []).map((entity) => [entity.text, entity.type || "CONCEPT"]), item.tags ?? [],
    item.observation_scopes ?? null, item.strategy || null, item.update_mode ?? "replace",
  ]);
  return ["taki-native-request.v1", ...identityFields(request, bankId, "retain"), request.document_tags ?? [], items];
}

export function nativeMutationRequestFields(input: { bankId: string; memoryId: string; request: HindsightTrackedMutationRequest }): unknown[] {
  const mutation = input.request.mutation;
  // Bind the submitted list exactly. Native execution owns entity normalization;
  // runtime Unicode case tables cannot define portable dispatch identity.
  const entities = mutation.entities ?? null;
  const date = (key: "occurred_start" | "occurred_end") => Object.hasOwn(mutation, key)
    ? mutation[key] ? nativeNormalizedTime(mutation[key]) : "" : null;
  return ["taki-native-request.v1", ...identityFields(input.request, input.bankId, "mutation"), input.memoryId.toLowerCase(),
    mutation.text ?? null, mutation.context ?? null, date("occurred_start"), date("occurred_end"),
    mutation.fact_type ?? null, entities, mutation.state ?? null, mutation.reason ?? null, mutation.expected_revision ?? null];
}

export function nativeReferenceFields(reference: HindsightNativeReference): unknown[] {
  return [reference.ordinal, reference.input_index, reference.document_id, reference.memory_id.toLowerCase(), reference.revision, reference.state];
}

function inputFields(input: HindsightNativeInputResult): unknown[] {
  return [input.input_index, input.document_id, input.update_mode, input.prepared_input_hash, input.document_hash,
    input.created_count, input.full_result_count, input.first_ordinal];
}

export function nativeResultFields(result: HindsightNativeResult): unknown[] {
  const mutation = result.mutation;
  const manifest = result.manifest;
  return ["taki-native-result.v1", ...identityFields(result, result.bank_id, result.operation_kind), result.request_hash,
    result.native_outcome, result.native_through_cursor, result.inputs.map(inputFields),
    mutation ? [mutation.memory_id.toLowerCase(), mutation.revision, mutation.state, mutation.document_id, mutation.chunk_id] : null,
    [manifest.total_records, manifest.page_size, manifest.total_pages, manifest.references_sha256]];
}

export function nativeReceiptFields(result: HindsightNativeResult): unknown[] {
  return ["taki-native-receipt.v1", ...identityFields(result, result.bank_id, result.operation_kind),
    result.request_hash, result.result_hash, result.native_through_cursor];
}
