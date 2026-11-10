/**
 * INPUT: the existing durable operation owner and the selected live search producer
 * OUTPUT: joined index application completion; concurrent changes use the same single-flight family
 * POS: core/memory/operations — compatibility adapter, with no independent queue or dispatch owner
 */
import { MemoryOperationRefusal, type MemorySearchIndexRuntime } from "./memory-operation-contract.ts";
import type { MemoryOperationService } from "./memory-operation-service.ts";

export function createIndexOperationAdapter(service: MemoryOperationService, current: () => MemorySearchIndexRuntime | null) {
  return async (stoplist: boolean): Promise<void> => {
    while (true) {
      if (current()?.desiredStoplist() !== stoplist) throw new Error("MEMORY_SEARCH_APPLICATION_SUPERSEDED");
      try {
        const admitted = service.submit({ kind: "index.rebuild", stoplist });
        const settled = await service.wait(admitted.operationId);
        if (settled.state !== "completed") throw new Error("MEMORY_SEARCH_APPLICATION_FAILED");
        return;
      } catch (error) {
        if (!(error instanceof MemoryOperationRefusal) || error.reason !== "MEMORY_OPERATION_BUSY" || !error.activeOperationId) throw error;
        // Join the existing owner, then reconcile the latest desired setting. This never replays an unknown write.
        await service.wait(error.activeOperationId);
      }
    }
  };
}
