/**
 * INPUT: a desired stoplist change and the selected Memory search-index producer
 * OUTPUT: existing durable operation lifecycle with actual rebuild completion or failure
 * POS: core/memory/operations — single-flight maintenance adapter; no second queue or authority selection
 */
import type { MemoryOperationRequest } from "@taki/shared";
import { MemoryOperationRefusal, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

export const indexRebuildKind: MemoryOperationKindHandler<Extract<MemoryOperationRequest, { kind: "index.rebuild" }>> = {
  family: () => "index",
  admit(request, ctx) {
    const runtime = ctx.searchIndex?.();
    if (!runtime || runtime.desiredStoplist() !== request.stoplist) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    return { kind: "index", stoplist: request.stoplist, authorityEpochId: runtime.authorityEpochId };
  },
  async execute({ request, producer, ctx, running }) {
    const runtime = ctx.searchIndex?.();
    if (producer.kind !== "index" || !runtime || runtime.authorityEpochId !== producer.authorityEpochId) {
      return { state: "failed", reason: "runtime_unavailable", errorCode: null, result: null };
    }
    running();
    const result = await runtime.rebuild(request.stoplist);
    return { state: "completed", reason: null, errorCode: null, result: { kind: "index", indexed: result.indexed } };
  },
};
