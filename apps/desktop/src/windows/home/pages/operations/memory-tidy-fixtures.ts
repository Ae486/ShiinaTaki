/**
 * INPUT: synthetic tidy progress/outcome patches for the Operations regressions.
 * OUTPUT: typed tidy operations without private content or real state.
 * POS: Home Operations test support; never imported by product code.
 */
import type { MemoryOperation, MemoryTidyOutcome } from "@taki/shared";
import { AT, operation } from "./memory-authority-fixtures.ts";

export const TIDY_OUTCOME: MemoryTidyOutcome = {
  status: "ran", defects: { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 31 },
  edits: 2, steps: 4, usage: { calls: 4, inputTokens: 120, outputTokens: 30, usageUnknown: 0 },
  reviewed: 31, remaining: 0, nextAction: "none",
};

export function tidyOperation(patch: Partial<MemoryOperation> = {}): MemoryOperation {
  return operation({ kind: "tidy", state: "running", authorityEpochId: "epoch-1",
    request: { kind: "tidy", characterId: "taki" },
    producer: { kind: "tidy", characterId: "taki", authorityEpochId: "epoch-1",
      progress: { edits: 2, steps: 4, reviewed: 10, remaining: 21 } }, ...patch });
}

export function settledTidy(outcome: MemoryTidyOutcome = TIDY_OUTCOME): MemoryOperation {
  return tidyOperation({ state: outcome.status === "ran" || outcome.status === "clean" ? "completed" : "failed",
    reason: outcome.status === "ran" || outcome.status === "clean" ? null : "producer_failed",
    result: { kind: "tidy", outcome }, terminalAt: AT });
}
