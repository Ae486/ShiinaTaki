/**
 * INPUT:  an original tracked dispatch and its claimed Pending Memory row
 * OUTPUT: durable native progress or fully verified factual proof for the second pull
 * POS:    core/memory/hindsight — native-result recovery; no per-write derived scheduling
 */
import {
  HINDSIGHT_NATIVE_RESULT_VERSION, HindsightNativeIdentitySchema, type HindsightNativeResultStatus, type HindsightNativeWriteResponse, type PendingMemoryRecord,
} from "@taki/shared";
import type { PendingMemoryChange } from "../../db/pending-memory-transition.ts";
import type { PendingReplayContext } from "./hindsight-pending-replay.ts";
import type { TrackedMemoryDispatch } from "./hindsight-native-result-client.ts";
import { verifyNativeResultPages } from "./hindsight-native-proof.ts";

interface NativeContext extends PendingReplayContext {
  onFailure(record: PendingMemoryRecord, error: unknown): PendingMemoryRecord;
}

export async function submitTrackedPending(context: NativeContext, raw: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  let record = raw;
  try {
    const dispatch = selected(context, record);
    if (!context.client.trackedNativeWrite) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
    const response = await context.client.trackedNativeWrite({ bankId: record.intent.bank.bankId, dispatch, context: context.request() });
    context.request();
    const refused = nativeRefusal(context, record, response);
    if (refused) return refused;
    record = advance(context, record, { kind: "acknowledged" });
    if ("status" in response) record = observe(context, record, response);
    return record;
  } catch (error) { return context.onFailure(record, error); }
}

export async function resolveTrackedPending(context: NativeContext, raw: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  let record = raw;
  try {
    const dispatch = selected(context, record);
    if (!context.client.nativeResult) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
    let status = await context.client.nativeResult({ bankId: record.intent.bank.bankId, kind: dispatch.command.kind,
      identity: identity(record), context: context.request() });
    context.request();
    assertStatusBinding(record, status);
    if (status.status === "unavailable" && status.reason === "receipt_not_found") {
      // Only a durably selected tracked command has the producer lifetime and
      // payload claim needed for this retry. Legacy missing UUIDs never enter it.
      record = await submitTrackedPending(context, record);
      if (record.phase !== "submitted" || record.lease === null) return record;
      status = await context.client.nativeResult({ bankId: record.intent.bank.bankId, kind: dispatch.command.kind,
        identity: identity(record), context: context.request() });
      context.request();
    }
    record = observe(context, record, status);
    if (status.status === "completed" && status.result !== null) {
      const receipt = await verifyNativeResultPages({ record, result: status.result, client: context.client, request: context.request, now: context.now });
      return advance(context, record, { kind: "native_factual", receipt });
    }
    if (["conflicting", "retired"].includes(status.status) || (status.status === "cancelled" && status.progress?.committed_parts !== 0)) {
      return advance(context, record, { kind: "terminal", phase: "outcome_unknown", code: "HINDSIGHT_PENDING_OUTCOME_UNKNOWN" });
    }
    if (status.status === "cancelled") return advance(context, record, { kind: "terminal", phase: "cancelled", code: "HINDSIGHT_PENDING_OPERATION_CANCELLED" });
    return advance(context, record, { kind: "retry", code: status.status === "failed" ? "HINDSIGHT_NATIVE_RESULT_UNAVAILABLE" : "HINDSIGHT_PENDING_REMAINS" });
  } catch (error) { return context.onFailure(record, error); }
}

function selected(context: NativeContext, record: PendingMemoryRecord): TrackedMemoryDispatch {
  if (!context.nativeResultSupported || record.dispatch?.protocol !== "tracked_native_v1") throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
  return record.dispatch;
}

function identity(record: PendingMemoryRecord) {
  return HindsightNativeIdentitySchema.parse({ contract_version: HINDSIGHT_NATIVE_RESULT_VERSION, operation_id: record.remoteOperationId,
    provider_lineage: record.intent.providerLineageId, bank_generation: record.intent.bankGeneration });
}

function observe(context: NativeContext, record: PendingMemoryRecord, status: HindsightNativeResultStatus): PendingMemoryRecord {
  selected(context, record);
  assertStatusBinding(record, status);
  return advance(context, record, { kind: "native_progress", status });
}

function assertStatusBinding(record: PendingMemoryRecord, status: HindsightNativeResultStatus): void {
  const dispatch = record.dispatch;
  if (dispatch?.protocol !== "tracked_native_v1") throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  if (status.bank_id !== record.intent.bank.bankId || status.operation_id !== record.remoteOperationId
    || status.operation_kind !== dispatch.command.kind || status.provider_lineage !== record.intent.providerLineageId
    || status.bank_generation !== record.intent.bankGeneration || (status.request_hash !== null && status.request_hash !== dispatch.requestHash)) {
    throw new Error("HINDSIGHT_NATIVE_RESULT_INVALID");
  }
}

function nativeRefusal(context: NativeContext, record: PendingMemoryRecord, response: HindsightNativeWriteResponse): PendingMemoryRecord | undefined {
  if (!("error" in response)) return undefined;
  const request = record.intent.operation;
  if (response.error === "memory_revision_mismatch" && request.kind === "mutation"
    && response.memory_id === request.request.memoryId && response.expected_revision === request.request.expectedRevision
    && response.current_revision !== undefined && response.current_revision !== request.request.expectedRevision) {
    return advance(context, record, { kind: "terminal", phase: "superseded", code: "HINDSIGHT_PENDING_SUPERSEDED", currentRevision: response.current_revision });
  }
  if (response.error === "taki_native_result_refused" && response.reason === "target_not_found" && request.kind === "mutation") {
    return advance(context, record, { kind: "terminal", phase: "superseded", code: "HINDSIGHT_PENDING_SUPERSEDED" });
  }
  // Streaming conflicts/failures can already have committed parts. Preserve
  // their receipt reference and inspect progress in the resolution stage.
  if (response.error === "taki_native_result_refused" && ["document_changed", "extraction_failed", "task_cancelled", "task_missing"].includes(response.reason ?? "")) return record;
  throw new Error("HINDSIGHT_PENDING_OUTCOME_UNKNOWN");
}

function advance(context: NativeContext, record: PendingMemoryRecord, change: PendingMemoryChange): PendingMemoryRecord {
  context.request();
  return context.pending.progress({ record, guard: context.guard, change });
}
