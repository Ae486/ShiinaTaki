/**
 * INPUT: automatic/legacy tidy requests and the existing durable memory operation service
 * OUTPUT: submit-or-join compatibility runner that waits without replaying active work
 * POS: core/memory/operations — one bridge for raw memory.tidy and automatic Local admission
 */
import type { MemoryOperation, MemoryTidyOutcome } from "@taki/shared";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";
import type { MemoryOperationService } from "./memory-operation-service.ts";

export function createTidyOperationAdapter(service: MemoryOperationService, authorityEpochId: () => string | null) {
  return {
    async runNow(characterId: string): Promise<MemoryTidyOutcome> {
      const admitted = submitOrJoin(service, characterId, authorityEpochId());
      const operation = await service.wait(admitted.operationId);
      if (operation.result?.kind === "tidy") return operation.result.outcome;
      // Unknown/restarted work has no settled result. Do not fabricate zero applied edits or replay it.
      throw new Error("Memory tidy result is unconfirmed; inspect the current operation before retrying.");
    },
  };
}

function submitOrJoin(service: MemoryOperationService, characterId: string, authorityEpochId: string | null): MemoryOperation {
  try { return service.submit({ kind: "tidy", characterId }); }
  catch (error) {
    if (!(error instanceof MemoryOperationRefusal) || error.reason !== "MEMORY_OPERATION_BUSY" || !error.activeOperationId) throw error;
    const active = service.status(error.activeOperationId);
    // A different Character shares the family but cannot borrow another Character's outcome.
    if (active.request.kind !== "tidy" || active.request.characterId !== characterId || active.authorityEpochId !== authorityEpochId) throw error;
    return active;
  }
}
