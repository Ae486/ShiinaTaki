/**
 * INPUT: a durable tidy admission and the currently selected raw maintenance producer
 * OUTPUT: producer-derived completion plus transaction-bound progress on the existing operation row
 * POS: core/memory/operations — tidy kind adapter; no model loop, timer, or candidate queue
 */
import { MemoryTidyOutcomeSchema, type MemoryOperationRequest, type MemoryOperationProducerRef } from "@taki/shared";
import { MemoryOperationRefusal, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

type Request = Extract<MemoryOperationRequest, { kind: "tidy" }>;
type Producer = Extract<MemoryOperationProducerRef, { kind: "tidy" }>;

export const tidyKind: MemoryOperationKindHandler<Request> = {
  // Characters share Global memory and Blocks; per-Character flights would still conflict.
  family: () => "tidy",
  admit(request, ctx): Producer {
    const runtime = ctx.tidy?.();
    if (!runtime) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    return { kind: "tidy", characterId: request.characterId, authorityEpochId: runtime.authorityEpochId,
      progress: { edits: 0, steps: 0, reviewed: 0, remaining: null } };
  },
  async execute({ request, producer, ctx, updateProducer }) {
    if (producer.kind !== "tidy" || !updateProducer) throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
    const runtime = ctx.tidy?.();
    if (!runtime || runtime.authorityEpochId !== producer.authorityEpochId) {
      return { state: "failed", reason: "runtime_unavailable", errorCode: null, result: null };
    }
    const outcome = MemoryTidyOutcomeSchema.parse(await runtime.runNow(request.characterId, {
      onProgress: (progress) => updateProducer({ ...producer, progress }),
    }));
    const completed = outcome.status === "clean" || outcome.status === "ran";
    return { state: completed ? "completed" : "failed", reason: completed ? null : "producer_failed", errorCode: null,
      producer: { ...producer, progress: { edits: outcome.edits, steps: outcome.steps,
        reviewed: outcome.reviewed ?? 0, remaining: outcome.remaining ?? null } },
      result: { kind: "tidy", outcome } };
  },
};
