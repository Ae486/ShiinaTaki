/**
 * INPUT:  confirmed transition requests and the optional direction-capable Core producer
 * OUTPUT: exclusive admission, atomic durable identity, deferred claim and receipt-only observation
 * POS:    core/memory/operations — W5 supplies the healthy producer; missing direction capability always refuses
 */
import { randomUUID } from "node:crypto";
import type { MemoryTransitionRequest } from "@taki/shared";
import { MemoryTransitionRequestSchema } from "@taki/shared";
import { MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

export const transitionKind: MemoryOperationKindHandler<MemoryTransitionRequest> = {
  family: () => "memory-transition",
  existing: (request, ctx) => {
    const prior = ctx.transitionStorage?.find(request);
    return prior ? ctx.lookup(prior.operationId) : undefined;
  },
  admit: (request, ctx, admission) => {
    if (!ctx.transition || !ctx.transitionStorage || admission.origin !== "operator") throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    if (request.kind !== "transition.emergency-local" || request.recovery) refuseWhileExclusiveFamilyBusy(ctx);
    ctx.transition.plan(MemoryTransitionRequestSchema.parse(request), ctx.admissionVerification);
    return { kind: "transition", transitionId: request.recovery?.transitionId ?? randomUUID(), requestId: request.requestId };
  },
  persistAdmission: (operation, ctx) => {
    if (!ctx.transition || !ctx.transitionStorage) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    ctx.transitionStorage.persist(operation, ctx.transition.plan(MemoryTransitionRequestSchema.parse(operation.request), ctx.admissionVerification));
  },
  execute: async (input) => {
    // Yield so a durable pre-claim cancellation can win; producers never receive a cancelled operation.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!input.tryClaim()) return null;
    if (!input.ctx.transition) return { state: "failed", reason: "producer_refused", errorCode: "MEMORY_TRANSITION_UNAVAILABLE", result: null };
    try { await input.ctx.transition.execute(input); }
    // A producer exception may follow a committed effect. Classify only from durable receipts below.
    catch { /* The operation remains observable even when the producer loses its reply. */ }
    try {
      const operation = input.ctx.lookup(input.operationId);
      return operation ? input.ctx.transitionStorage?.observe(operation) ?? null : null;
    }
    catch { return null; } // An unreadable receipt is not evidence of producer failure.
  },
  observe: (operation, ctx) => {
    const settlement = ctx.transitionStorage?.observe(operation);
    return settlement ? { kind: "settled", settlement } : null;
  },
  observeBoot: (operation, ctx) => ctx.transitionStorage?.observe(operation, true) ?? null,
  cancel: (operation, ctx) => {
    if (operation.state !== "admitted" || operation.producer?.kind !== "transition" || !ctx.transitionStorage?.canCancel(operation)) {
      throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
    }
  },
};
