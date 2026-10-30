/**
 * INPUT:  operation-scoped native receipt identity under an admitted Hindsight Bank lineage
 * OUTPUT: required derived-completion evidence linked to an observable journal boundary, or explicit refusal
 * POS:    core/memory/hindsight — provider dependency seam; the accepted B0 build has no conforming implementation
 */
import type { MemoryDerivedCompletionRequest, MemoryDerivedCompletionResult } from "@taki/shared";
import type { HindsightCallContext } from "./hindsight-client.ts";

export interface MemoryDerivedCompletionPort {
  check(input: { request: MemoryDerivedCompletionRequest; context: HindsightCallContext }): Promise<MemoryDerivedCompletionResult>;
}

// Native retain completion counts extraction only. Mutation receipts precede best-effort derived submission.
// Neither is a substitute for a tracked completion boundary; B0 must add that contract before live convergence.
export const unavailableHindsightDerivedCompletion: MemoryDerivedCompletionPort = {
  check: async () => { throw new Error("HINDSIGHT_DERIVED_FENCE_UNAVAILABLE"); },
};
