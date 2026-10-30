/**
 * INPUT:  claimed Pending Memory rows, their captured Bank lease, and authenticated native Hindsight methods
 * OUTPUT: idempotent dispatch/native receipts or non-blocking superseded/retry/unknown outcomes
 * POS:    core/memory/hindsight — explicit B5 replay; confirmed replica mutation and generic Run Effect replay are forbidden
 */
import type { MemoryReplicaErrorCode, MutationRequest, PendingMemoryRecord } from "@taki/shared";
import { z } from "zod";
import type { PendingMemoryGuard, PendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import type { PendingMemoryChange } from "../../db/pending-memory-transition.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import { resolvePendingRetain } from "./hindsight-pending-retain.ts";
import { replicaErrorCode, replicaOwnershipLost } from "./hindsight-replica-errors.ts";
import { prepareTrackedDispatch } from "./hindsight-native-proof.ts";
import { resolveTrackedPending, submitTrackedPending } from "./hindsight-pending-native-result.ts";

export interface PendingReplayContext {
  client: HindsightClient; pending: PendingMemoryRepo; replica: HindsightReplicaSyncRepo;
  guard: PendingMemoryGuard; request: () => HindsightCallContext; now: () => string;
  nativeResultSupported?: boolean;
  beforeNativeDispatch?: (input: { record: PendingMemoryRecord; context: HindsightCallContext }) => Promise<void>;
}

export async function replayPendingNative(context: PendingReplayContext, raw: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  let record = raw;
  try {
    context.request();
    if (record.phase === "queued") {
      if (record.intent.operation.kind === "mutation") {
        if (!(context.nativeResultSupported ? context.client.trackedNativeWrite : context.client.mutatePending)) throw new Error("HINDSIGHT_PENDING_CLIENT_UNAVAILABLE");
        if (!z.uuid().safeParse(record.intent.operation.request.memoryId).success) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
        const target = context.replica.record({ bankId: record.intent.bank.bankId,
          memoryId: record.intent.operation.request.memoryId, includeInvalidated: true });
        if (!target || target.unit.revision !== record.intent.operation.request.expectedRevision) {
          return change(context, record, { kind: "terminal", phase: "superseded", code: "HINDSIGHT_PENDING_SUPERSEDED", currentRevision: target?.unit.revision });
        }
        if (target.unit.factType === "observation") throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
        const prepared = prepareMutation(record.intent.operation.request, target.unit.entities);
        record = change(context, record, { kind: "dispatch", preparedMutation: prepared,
          dispatch: context.nativeResultSupported ? prepareTrackedDispatch(record, prepared) : undefined });
      } else {
        if (!(context.nativeResultSupported ? context.client.trackedNativeWrite : context.client.retainPending) || record.documentId === null) throw new Error("HINDSIGHT_PENDING_CLIENT_UNAVAILABLE");
        if (!context.nativeResultSupported && record.intent.operation.request.updateMode !== "replace") throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
        const request = record.intent.operation.request;
        const documentId = record.documentId;
        const dispatch = context.nativeResultSupported ? prepareTrackedDispatch(record, null) : undefined;
        // D77 persists the complete original source remotely before the first
        // native request. Historical replay still uses its frozen G1 identity.
        await context.beforeNativeDispatch?.({ record, context: context.request() });
        context.request();
        record = change(context, record, { kind: "dispatch", preparedMutation: null,
          dispatch });
        if (record.dispatch?.protocol === "tracked_native_v1") return await submitTrackedPending(nativeContext(context), record);
        if (!context.client.retainPending) throw new Error("HINDSIGHT_PENDING_CLIENT_UNAVAILABLE");
        await context.client.retainPending({ request, documentId,
          operationId: record.remoteOperationId, originalAt: record.intent.originalAt, context: context.request() });
        context.request();
        return change(context, record, { kind: "acknowledged" });
      }
    }
    if (record.dispatch?.protocol === "tracked_native_v1") return raw.phase === "queued"
      ? await submitTrackedPending(nativeContext(context), record) : record;
    if (record.phase === "submitted" && record.intent.operation.kind === "mutation") return await replayMutation(context, record);
    return record;
  } catch (error) { return handlePendingFailure(context, record, error); }
}

export async function resolvePendingNative(context: PendingReplayContext, record: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  if (record.phase === "submitted" && record.dispatch?.protocol === "tracked_native_v1") return resolveTrackedPending(nativeContext(context), record);
  if (record.phase !== "submitted" || record.intent.operation.kind !== "retain") return record;
  try {
    const receipt = await resolvePendingRetain({ record, client: context.client, request: context.request, now: context.now });
    return receipt ? change(context, record, { kind: "native_completed", receipt })
      : change(context, record, { kind: "retry", code: "HINDSIGHT_PENDING_REMAINS" });
  } catch (error) { return handlePendingFailure(context, record, error); }
}

async function replayMutation(context: PendingReplayContext, record: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  if (!context.client.mutatePending || record.preparedMutation === null) throw new Error("HINDSIGHT_PENDING_CLIENT_UNAVAILABLE");
  // A prior dispatch can itself explain a newer/missing replica target. Recover the original receipt BEFORE CAS rejection.
  const result = await context.client.mutatePending({ request: record.preparedMutation,
    operationId: record.remoteOperationId, context: context.request() });
  context.request();
  if (result.outcome === "superseded") return change(context, record, { kind: "terminal", phase: "superseded",
    code: "HINDSIGHT_PENDING_SUPERSEDED", currentRevision: result.currentRevision ?? undefined });
  if (result.outcome === "identity_conflict") return change(context, record, { kind: "terminal", phase: "failed", code: "HINDSIGHT_PENDING_IDENTITY_CONFLICT" });
  return change(context, record, { kind: "native_completed", receipt: { kind: "mutation", operationId: record.remoteOperationId,
    memoryId: result.memoryId, revision: result.revision, state: result.state, outcome: result.changed ? "applied" : "unchanged",
    resultHash: result.resultHash, completedAt: context.now() } });
}

function prepareMutation(request: MutationRequest, entities: string[]): MutationRequest {
  if (request.kind !== "edit" || request.patch.layerId === undefined) return request;
  const layer = `taki-layer:${request.patch.layerId}`;
  return { ...request, patch: { ...request.patch,
    entities: [...new Set([...(request.patch.entities ?? entities).filter((entity) => !entity.startsWith("taki-layer:")), layer])] } };
}

export function change(context: PendingReplayContext, record: PendingMemoryRecord, value: PendingMemoryChange): PendingMemoryRecord {
  context.request();
  return context.pending.progress({ record, guard: context.guard, change: value });
}

export function handlePendingFailure(context: PendingReplayContext, record: PendingMemoryRecord, error: unknown): PendingMemoryRecord {
  const observedCode = replicaErrorCode(error);
  const code = observedCode === "HINDSIGHT_TEMPLATE_INVALID" ? "HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED" : observedCode;
  if (replicaOwnershipLost(error) || ["HINDSIGHT_CANCELLED", "HINDSIGHT_DEADLINE_EXCEEDED",
    "HINDSIGHT_PENDING_AUTHORITY_MISMATCH", "HINDSIGHT_PENDING_STATE_STALE"].includes(code)) throw error;
  const phase = terminalPhase(code, record);
  return change(context, record, phase ? { kind: "terminal", phase, code } : { kind: "retry", code });
}

function terminalPhase(code: MemoryReplicaErrorCode, record: PendingMemoryRecord): "failed" | "outcome_unknown" | "cancelled" | undefined {
  if (record.nativeReceipt !== null || record.nativeResultReceipt) return undefined;
  if (["HINDSIGHT_PENDING_OUTCOME_UNKNOWN", "HINDSIGHT_PENDING_RECEIPT_INVALID", "HINDSIGHT_NATIVE_RESULT_INVALID"].includes(code)) return "outcome_unknown";
  if (code === "HINDSIGHT_PENDING_OPERATION_CANCELLED") return "cancelled";
  if (["HINDSIGHT_PENDING_OPERATION_FAILED", "HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED", "HINDSIGHT_PENDING_PAYLOAD_UNSAFE",
    "HINDSIGHT_PENDING_IDENTITY_CONFLICT", "HINDSIGHT_OPERATION_IDENTITY_CONFLICT"].includes(code)) return "failed";
  return undefined;
}

function nativeContext(context: PendingReplayContext) {
  return { ...context, onFailure: (record: PendingMemoryRecord, error: unknown) => handlePendingFailure(context, record, error) };
}
