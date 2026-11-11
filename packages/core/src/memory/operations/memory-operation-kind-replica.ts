/**
 * INPUT:  replica.sync requests, live B5 scheduler and durable exact request/claim/outcome evidence
 * OUTPUT: manual admission, request-specific cancellation and factual settlement, including boot observation
 * POS:    core/memory/operations — producer adapter only; no timestamp inference or second scheduler
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperationProducerRef, MemoryOperationRequest, MemoryReplicaRequest } from "@taki/shared";
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
    const transition = ctx.activeInFamily("memory-transition");
    if (transition) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", transition.operationId);
    const runtime = requireRuntime(ctx);
    if (!knownBank(runtime, request.bankId)) throw new MemoryOperationRefusal("MEMORY_OPERATION_BANK_UNKNOWN");
    return { kind: "replica", bankId: request.bankId, admittedAt: ctx.now(), requestId: randomUUID() };
  },
  execute: async ({ request, producer, ctx }) => {
    const runtime = ctx.live();
    if (!runtime || !runtime.scheduler.started()) return { state: "failed", reason: "runtime_unavailable", errorCode: null, result: null };
    const ref = replicaRef(producer);
    if (!ref.requestId) return null;
    try { runtime.scheduler.requestManual(request.bankId, request.syncKind, ref.requestId); }
    catch (error) {
      // Admission also projects status after committing the queue. A failed read is not proof of refusal:
      // preserve any admitted request, and leave unreadable evidence unresolved for later observation.
      try {
        const row = read(ctx, ref);
        return row ? classify(row) : { state: "failed", reason: "producer_refused", errorCode: replicaErrorCode(error), result: null };
      } catch { return null; }
    }
    // Supervisor/storage failure without a persisted request outcome leaves this operation unresolved.
    // In particular, another Bank's failed read cannot become this request's failure receipt.
    try { await runtime.scheduler.tick(); return classify(read(ctx, ref)); }
    catch { return null; }
  },
  observe: (operation, ctx) => {
    if (!operation.producer) return null;
    const row = read(ctx, replicaRef(operation.producer));
    if (row?.state === "claimed") return { kind: "running" };
    const settlement = classify(row);
    return settlement ? { kind: "settled", settlement } : null;
  },
  observeBoot: (operation, ctx) => {
    const ref = replicaRef(operation.producer);
    const row = ref.requestId ? ctx.replicaRequest?.(ref.requestId) : undefined;
    if (row && row.bankId !== ref.bankId) throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
    return classify(row);
  },
  cancel: (operation, ctx) => {
    const runtime = requireRuntime(ctx); const ref = replicaRef(operation.producer);
    if (!ref.requestId) throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
    try { runtime.scheduler.cancelManual(ref.bankId, ref.requestId); }
    catch (error) {
      if (replicaErrorCode(error) === "HINDSIGHT_REPLICA_BUSY") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
      throw error;
    }
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

function read(ctx: MemoryOperationContext, ref: ReplicaRef): MemoryReplicaRequest | undefined {
  if (!ref.requestId) return undefined; // Historical rows cannot acquire identity from their timestamps.
  const row = ctx.live()?.scheduler.request(ref.requestId) ?? ctx.replicaRequest?.(ref.requestId);
  if (row && row.bankId !== ref.bankId) throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return row;
}

function classify(row: MemoryReplicaRequest | undefined): MemoryOperationSettlement | null {
  if (!row || row.state === "queued" || row.state === "claimed") return null;
  if (row.state === "cancelled") return { state: "cancelled", reason: "cancelled_before_claim", errorCode: null, result: null };
  const result = { kind: "replica" as const, errorCode: row.errorCode, nextAction: row.nextAction, lastSuccessAt: row.lastSuccessAt };
  if (row.state === "waiting") return { state: "waiting", reason: null, errorCode: null, result };
  return row.state === "succeeded" ? { state: "completed", reason: null, errorCode: null, result }
    : { state: "failed", reason: "producer_failed", errorCode: row.errorCode, result };
}
