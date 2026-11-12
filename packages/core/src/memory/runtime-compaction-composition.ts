/**
 * INPUT: selected Memory bindings, process Utility Slot and captured context/configuration inputs
 * OUTPUT: one durable compaction owner and provider-specific background maintenance chain
 * POS: core/memory — published canonical summaries preserve raw sources independently; unavailable bindings require factual flush proof
 */
import { createCompactionPass } from "../agents/compaction-pass.ts";
import { loadContextConfig } from "../config/context-config.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import type { Database } from "../db/sqlite.ts";
import { createMaintenanceAutoMemory } from "./auto-memory.ts";
import type { MemoryFlushPort } from "./memory-flush-port.ts";
import type { MemoryRuntimeInput, MemoryRuntimeScope } from "./runtime-composition.ts";
import type { UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";
import { readCurrentMemoryAuthorityIdentity } from "./legacy-migration/legacy-activation-repo.ts";
import { sameMemoryAuthorityIdentity } from "./runtime-authority-verification.ts";

export function createCompactionMaintenance(input: MemoryRuntimeInput, utility: UtilitySlot, scope: MemoryRuntimeScope) {
  const current = scope.current;
  const compact = createCompactionPass({
    view: { estimatedTokens: input.estimatedTokens, budget: input.budget,
      measureRequest: input.measureRequest ? (characterId) => input.measureRequest?.(characterId) : undefined,
      effectiveWindowTokens: input.effectiveWindowTokens },
    timeline: input.timeline, summaries: input.summaries, operations: createCompactionOperationRepo(input.db,
      { onSummaryCommitted: input.onSummaryCommitted, onChanged: input.onMaintenanceChanged }),
    legacyFlush: () => preRetirementMemoryFlush(input.db, scope), slot: utility,
    config: { ...input.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
    captureConfig: () => ({ ...(input.configuration ? loadContextConfig({
      TAKI_COMPACT_TRIGGER_RATIO: input.env.TAKI_COMPACT_TRIGGER_RATIO,
      TAKI_COMPACT_KEEP_MESSAGES: input.env.TAKI_COMPACT_KEEP_MESSAGES,
    }).compact : input.compact), summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 }),
    protectedContent: () => [MEMORY_VOICE_RULE],
    logger: input.logger.child({ mod: "compaction" }),
  });
  const autoMemory = createMaintenanceAutoMemory({ maintenance: () => current().maintenance, compact,
    legacyMaintenanceBeforeCompact: () => !scope.selected.canonical,
    logger: input.logger.child({ mod: "memory-auto" }) });
  return { autoMemory, compact };
}

function preRetirementMemoryFlush(db: Database, scope: MemoryRuntimeScope): MemoryFlushPort | undefined {
  // Published Local keeps authoritative raw sources while summaries advance independently of extraction.
  if (scope.local.current()) return undefined;
  try {
    const bound = scope.hindsightBinding.boundIdentity();
    if (scope.hindsightBinding.current() && bound?.mode === "hindsight"
      && sameMemoryAuthorityIdentity(bound, readCurrentMemoryAuthorityIdentity(db))) return undefined;
    return scope.current().memoryFlush;
  }
  catch {
    return { prepareRetirement: async () => ({ status: "retryable_failure", code: "MEMORY_FLUSH_FAILED" }) };
  }
}
