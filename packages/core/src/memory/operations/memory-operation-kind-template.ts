/**
 * INPUT:  an operator preview reference or explicit original-plan recovery request
 * OUTPUT: existing-owner admission, deferred claim, durable observation and pre-dispatch cancellation
 * POS:    memory.operations template adapter — the template producer owns its independent executor and hold
 */
import type { MemoryTemplateRequest } from "@taki/shared";
import { MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

export const templateKind: MemoryOperationKindHandler<MemoryTemplateRequest> = {
  family: () => "hindsight-template",
  existing: (request, ctx) => {
    const prior = ctx.templates?.existing(request);
    return prior ? ctx.lookup(prior.operationId) : undefined;
  },
  admit: (request, ctx, admission) => {
    if (!ctx.templates || admission.origin !== "operator") throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    refuseWhileExclusiveFamilyBusy(ctx);
    for (const bankId of ctx.templates.bankIds(request)) {
      const active = ctx.activeInFamily(`replica:${bankId}`);
      if (active) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", active.operationId);
    }
    return ctx.templates.admit(request);
  },
  persistAdmission: (operation, ctx) => {
    if (!ctx.templates) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    ctx.templates.persistAdmission(operation);
  },
  execute: async (input) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!input.tryClaim()) return null;
    if (!input.ctx.templates || input.producer.kind !== "template") throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    try { await input.ctx.templates.execute({ operationId: input.operationId, producer: input.producer, checkpoint: input.checkpoint }); }
    catch { /* Admission/lease failure is classified from the unchanged durable producer below. */ }
    const operation = input.ctx.lookup(input.operationId);
    return operation ? input.ctx.templates.observe(operation) : null;
  },
  observe: (operation, ctx) => {
    const settlement = ctx.templates?.observe(operation);
    return settlement ? { kind: "settled", settlement } : null;
  },
  observeBoot: (operation, ctx) => ctx.templates?.observe(operation, true) ?? null,
  cancel: (operation, ctx) => {
    if (!ctx.templates) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    ctx.templates.cancel(operation);
  },
};
