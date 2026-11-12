/**
 * INPUT:  legacy detached memory surfaces and the mutable authority selector
 * OUTPUT: wrappers that stop every legacy background/write path after canonical activation
 * POS:    core/memory — runtime retirement adapters; no canonical storage or Markdown access
 */
import type { AutoMemory } from "./auto-memory.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import type { TidyPass, TidyRunOutcome } from "./tidy-pass.ts";

export function authorityAwareAutoMemory(legacy: AutoMemory, isCanonical: () => boolean): AutoMemory {
  return { onTurnCompleted: (characterId, origin) => isCanonical() ? Promise.resolve() : legacy.onTurnCompleted(characterId, origin) };
}

export function authorityAwareTidy(legacy: TidyPass, isCanonical: () => boolean): TidyPass {
  return {
    maybeRun: async (characterId) => { if (!isCanonical()) await legacy.maybeRun(characterId); },
    runNow: (characterId, options): Promise<TidyRunOutcome> => isCanonical() ? Promise.resolve(cleanTidyOutcome()) : legacy.runNow(characterId, options),
  };
}

export function authorityAwareWrite(legacy: MemoryWriteOp, isCanonical: () => boolean): MemoryWriteOp {
  return (input) => {
    if (isCanonical()) throw new Error("MEMORY_LEGACY_WRITE_RETIRED");
    return legacy(input);
  };
}

function cleanTidyOutcome(): TidyRunOutcome {
  return { status: "clean", defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 }, edits: 0, steps: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 } };
}
