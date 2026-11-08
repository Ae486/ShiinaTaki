/**
 * INPUT:  strict candidate requests and the explicitly composed durable candidate producer
 * OUTPUT: original-request admission, existing-owner execution and read-only restart classification
 * POS:    Memory Operations candidate adapter; no Host driver, scheduler or candidate runtime is invented here
 */
import { HindsightCandidateRequestSchema, HindsightCandidateProducerRefSchema,
  type HindsightCandidateRequest } from "@taki/shared/hindsight-candidate-domain";
import { MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy,
  type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

export const candidateKind: MemoryOperationKindHandler<HindsightCandidateRequest> = {
  family: () => "hindsight-candidate",
  existing: (request, ctx) => {
    const operationId = ctx.candidates?.existing(request);
    return operationId ? ctx.lookup(operationId) : undefined;
  },
  admit: (request, ctx, admission) => {
    if (!ctx.candidates || admission.origin !== "operator") throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    refuseWhileExclusiveFamilyBusy(ctx);
    return ctx.candidates.admit(request);
  },
  persistAdmission: (operation, ctx) => {
    if (!ctx.candidates) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    ctx.candidates.persistAdmission({ operationId: operation.operationId,
      request: HindsightCandidateRequestSchema.parse(operation.request),
      producer: HindsightCandidateProducerRefSchema.parse(operation.producer) });
  },
  execute: async (input) => {
    if (!input.ctx.candidates) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    return input.ctx.candidates.execute({ operationId: input.operationId, tryClaim: input.tryClaim, checkpoint: input.checkpoint });
  },
  observe: (operation, ctx) => {
    const settlement = ctx.candidateOutcome?.(operation.operationId);
    return settlement ? { kind: "settled", settlement } : null;
  },
  observeBoot: (operation, ctx) => ctx.candidateOutcome?.(operation.operationId) ?? null,
  cancel: (operation, ctx) => {
    if (!ctx.candidates) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    ctx.candidates.cancel(operation.operationId);
  },
};
