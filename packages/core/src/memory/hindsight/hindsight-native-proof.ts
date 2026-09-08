/**
 * INPUT:  Shared tracked dispatch, producer result headers and immutable pages
 * OUTPUT: independent producer hash verification and bounded complete reference validation
 * POS:    core/memory/hindsight — factual proof gate; local legacy hash semantics remain unchanged
 */
import { createHash } from "node:crypto";
import {
  HINDSIGHT_NATIVE_RESULT_VERSION, HindsightNativeIdentitySchema, HindsightNativeResultSchema,
  PendingMemoryDispatchSchema, nativeMutationRequestFields, nativeProofJson, nativeReceiptFields,
  nativeReferenceFields, nativeResultFields, nativeRetainRequestFields,
  type HindsightNativeResult, type HindsightNativeResultPage, type MutationRequest,
  type PendingMemoryNativeResultReceipt, type PendingMemoryRecord,
  type PendingMemoryState,
} from "@taki/shared";
import { mutationBody, retainItem } from "./hindsight-pending-client.ts";
import type { TrackedMemoryDispatch } from "./hindsight-native-result-client.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";

export function nativeProofHash(value: unknown): string {
  return createHash("sha256").update(nativeProofJson(value), "utf8").digest("hex");
}

export function trackedDispatchHash(bankId: string, dispatch: TrackedMemoryDispatch): string {
  const command = dispatch.command;
  return nativeProofHash(command.kind === "retain" ? nativeRetainRequestFields(bankId, command.request)
    : nativeMutationRequestFields({ bankId, memoryId: command.memoryId, request: command.request }));
}

export function prepareTrackedDispatch(record: PendingMemoryState, prepared: MutationRequest | null): TrackedMemoryDispatch {
  const identity = { contract_version: HINDSIGHT_NATIVE_RESULT_VERSION, operation_id: record.remoteOperationId,
    provider_lineage: record.intent.providerLineageId, bank_generation: record.intent.bankGeneration };
  const operation = record.intent.operation;
  const raw = operation.kind === "retain" ? {
    kind: "retain", request: { ...identity, items: [retainItem({ request: operation.request,
      documentId: requireDocumentId(record.documentId), originalAt: record.intent.originalAt })] },
  } : { kind: "mutation", memoryId: operation.request.memoryId,
    request: { ...identity, mutation: mutationBody(prepared ?? operation.request, record.remoteOperationId) } };
  // JSON serialization is the actual wire boundary: undefined dates must be
  // omitted, since explicit native null means clear, not leave unchanged.
  const dispatch = PendingMemoryDispatchSchema.parse(JSON.parse(JSON.stringify({
    protocol: "tracked_native_v1", requestHash: "0".repeat(64), command: raw,
  })));
  if (dispatch.protocol !== "tracked_native_v1") throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  dispatch.requestHash = trackedDispatchHash(record.intent.bank.bankId, dispatch);
  if (new TextEncoder().encode(JSON.stringify(dispatch.command.request)).byteLength > 512 * 1024) {
    throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  }
  return dispatch;
}

export function assertNativeResultHashes(raw: HindsightNativeResult): void {
  const result = HindsightNativeResultSchema.parse(raw);
  if (nativeProofHash(nativeResultFields(result)) !== result.result_hash
    || nativeProofHash(nativeReceiptFields(result)) !== result.native_receipt_hash) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
}

export function assertNativeResultBinding(record: PendingMemoryState, result: HindsightNativeResult): void {
  assertNativeResultHashes(result);
  const dispatch = record.dispatch;
  if (dispatch?.protocol !== "tracked_native_v1" || result.operation_id !== record.remoteOperationId
    || result.operation_kind !== record.intent.operation.kind || result.bank_id !== record.intent.bank.bankId
    || result.provider_lineage !== record.intent.providerLineageId || result.bank_generation !== record.intent.bankGeneration
    || result.request_hash !== dispatch.requestHash || trackedDispatchHash(result.bank_id, dispatch) !== result.request_hash
    || result.native_through_cursor < record.intent.baseCursor) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  if (record.intent.operation.kind === "retain" && (result.inputs.length !== 1
    || result.inputs[0]?.document_id !== record.documentId || result.inputs[0].update_mode !== record.intent.operation.request.updateMode)) {
    throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  }
}

export async function verifyNativeResultPages(input: {
  record: PendingMemoryRecord; result: HindsightNativeResult; client: HindsightClient;
  request: () => HindsightCallContext; now: () => string;
}): Promise<PendingMemoryNativeResultReceipt> {
  const { result } = input;
  assertNativeResultBinding(input.record, result);
  if (!input.client.nativeResultPage) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
  const digest = createHash("sha256").update("taki-native-references.v1\n");
  let ordinal = 0; let priorMemoryId = "";
  for (let pageNumber = 0; pageNumber < result.manifest.total_pages; pageNumber += 1) {
    const page = await input.client.nativeResultPage({ bankId: result.bank_id, kind: result.operation_kind,
      identity: HindsightNativeIdentitySchema.parse({ contract_version: result.contract_version, operation_id: result.operation_id,
        provider_lineage: result.provider_lineage, bank_generation: result.bank_generation }), resultHash: result.result_hash,
      pageNumber, context: input.request() });
    input.request();
    verifyPageEnvelope(result, page, pageNumber);
    for (const reference of page.references) {
      // Taki submits exactly one source. Strict UUID order checks uniqueness
      // across all pages with constant memory, including arbitrarily large appends.
      const memoryId = reference.memory_id.toLowerCase();
      if (reference.ordinal !== ordinal || reference.input_index !== 0 || reference.document_id !== input.record.documentId
        || memoryId <= priorMemoryId) throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
      digest.update(`${nativeProofJson(nativeReferenceFields(reference))}\n`);
      ordinal += 1; priorMemoryId = memoryId;
    }
  }
  if (ordinal !== result.manifest.total_records || digest.digest("hex") !== result.manifest.references_sha256) {
    throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  }
  return { schemaVersion: 1, result, verifiedAt: input.now() };
}

function verifyPageEnvelope(result: HindsightNativeResult, page: HindsightNativeResultPage, pageNumber: number): void {
  const first = pageNumber * result.manifest.page_size;
  if (page.operation_id !== result.operation_id || page.operation_kind !== result.operation_kind || page.bank_id !== result.bank_id
    || page.provider_lineage !== result.provider_lineage || page.bank_generation !== result.bank_generation
    || page.result_hash !== result.result_hash || page.page_number !== pageNumber || page.first_ordinal !== first
    || page.references.length !== Math.min(result.manifest.page_size, result.manifest.total_records - first)
    || page.page_sha256 !== nativeProofHash(["taki-native-page.v1", result.result_hash, pageNumber, page.references.map(nativeReferenceFields)])) {
    throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  }
}

function requireDocumentId(value: string | null): string {
  if (value === null) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  return value;
}
