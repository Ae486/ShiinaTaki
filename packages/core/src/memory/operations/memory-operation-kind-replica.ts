/**
 * INPUT:  replica.sync requests, the live B5 scheduler and the verified Bank list of the selected Hindsight runtime
 * OUTPUT: the replica.sync kind handler — durable manual request, one awaited tick, classification from persisted Bank state
 * POS:    core/memory/operations — never a second scheduler; completion is derived from what B5 persisted, nothing more
 */
import type { MemoryOperationProducerRef, MemoryOperationRequest, MemoryReplicaSyncStatus } from "@taki/shared";
import { replicaErrorCode } from "../hindsight/hindsight-replica-errors.ts";
import {
  MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationKindHandler,
  type MemoryOperationSettlement, type MemoryOperationsRuntime,
} from "./memory-operation-contract.ts";

type SyncRequest = Extract<MemoryOperationRequest, { kind: "replica.sync" }>;
type ReplicaRef = Extract<MemoryOperationProducerRef, { kind: "replica" }>;

export const replicaSyncKind: MemoryOperationKindHandler<SyncRequest> = {
  family: (request) => `replica:${request.bankId}`,
  admit: (request, ctx) => {
    const runtime = requireRuntime(ctx);
    if (!knownBank(runtime, request.bankId)) throw new MemoryOperationRefusal("MEMORY_OPERATION_BANK_UNKNOWN");
    return { kind: "replica", bankId: request.bankId, admittedAt: ctx.now() };
  },
  execute: async ({ request, producer, ctx }) => {
    const runtime = ctx.live();
    if (!runtime || !runtime.scheduler.started()) return { state: "failed", reason: "runtime_unavailable", errorCode: null, result: null };
    try { runtime.scheduler.requestManual(request.bankId, request.syncKind); }
    catch (error) { return { state: "failed", reason: "producer_refused", errorCode: replicaErrorCode(error), result: null }; }
    // One awaited tick: a started scheduler drains the manual claim (an in-flight drain loops again via rerun).
    await runtime.scheduler.tick();
    return classify(runtime, replicaRef(producer));
  },
  observe: (operation, ctx) => {
    const runtime = ctx.live();
    if (!runtime || !operation.producer) return null;
    const ref = replicaRef(operation.producer);
    const state = runtime.scheduler.status(ref.bankId)[0];
    if (!state) return null;
    if (state.run !== null && state.pendingManualKind === null && claimedSince(state, ref)) return { kind: "running" };
    const settlement = classify(runtime, ref, state);
    return settlement ? { kind: "settled", settlement } : null;
  },
  cancel: (operation, ctx) => {
    const runtime = requireRuntime(ctx);
    const ref = replicaRef(operation.producer);
    let state: MemoryReplicaSyncStatus;
    try { state = runtime.scheduler.cancelManual(ref.bankId); }
    catch (error) {
      if (replicaErrorCode(error) === "HINDSIGHT_REPLICA_BUSY") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
      throw error;
    }
    // A claim at/after admission means the scheduler already took this request; its execute settles the outcome.
    if (claimedSince(state, ref)) throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
  },
};

function requireRuntime(ctx: MemoryOperationContext): MemoryOperationsRuntime {
  const runtime = ctx.live();
  if (!runtime || !runtime.scheduler.started()) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return runtime;
}

function knownBank(runtime: MemoryOperationsRuntime, bankId: string): boolean {
  try { return runtime.banks().some((bank) => bank.bankId === bankId); }
  catch { throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"); }
}

function replicaRef(producer: MemoryOperationProducerRef | null): ReplicaRef {
  if (!producer || producer.kind !== "replica") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

function claimedSince(state: MemoryReplicaSyncStatus, ref: ReplicaRef): boolean {
  return state.lastAttemptAt !== null && Date.parse(state.lastAttemptAt) >= Date.parse(ref.admittedAt);
}

/** Null means the request is still unclaimed and no supervisor failure was recorded: the row stays open. */
function classify(runtime: MemoryOperationsRuntime, ref: ReplicaRef, current?: MemoryReplicaSyncStatus): MemoryOperationSettlement | null {
  const state = current ?? runtime.scheduler.status(ref.bankId)[0];
  if (!state) return { state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED", result: null };
  const result = (errorCode: MemoryReplicaSyncStatus["errorCode"], nextAction: MemoryReplicaSyncStatus["nextAction"]) =>
    ({ kind: "replica" as const, errorCode, nextAction, lastSuccessAt: state.lastSuccessAt });
  // Claim consumes the manual request, and this owner is its only producer: a still-queued request proves the Bank
  // state (including a previous run that overlaps admittedAt to the millisecond) is not this operation's outcome.
  if (state.pendingManualKind !== null) {
    const supervisor = runtime.scheduler.lastError();
    if (supervisor === null) return null;
    const nextAction = state.automatic ? "automatic_retry_scheduled" : "explicit_retry_required";
    return { state: "failed", reason: "producer_failed", errorCode: supervisor, result: result(supervisor, nextAction) };
  }
  if (state.run !== null || !claimedSince(state, ref)) return null;
  if (state.lastSuccessAt !== null && Date.parse(state.lastSuccessAt) >= Date.parse(ref.admittedAt)) {
    return { state: "completed", reason: null, errorCode: null, result: result(null, null) };
  }
  const errorCode = state.errorCode ?? "HINDSIGHT_REPLICA_SYNC_FAILED";
  return { state: "failed", reason: "producer_failed", errorCode, result: result(errorCode, state.nextAction ?? "explicit_retry_required") };
}
