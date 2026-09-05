/**
 * INPUT:  Core boot dependencies for legacy Markdown and canonical Local memory runtimes
 * OUTPUT: authority-selected engine, retired legacy surfaces, roots, fence, and migration runner factory
 * POS:    core/memory — process composition seam kept out of main.ts; marker selection happens before legacy creation
 */
import type { LanguageModel } from "ai";
import { join } from "node:path";
import { createCompactionPass } from "../agents/compaction-pass.ts";
import type { RequestMeasurement } from "../agents/request-measurement.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { MemoryProviderCapabilities } from "@taki/shared";
import { authorityAwareTidy, authorityAwareWrite } from "./authority-aware-legacy-surfaces.ts";
import { createMaintenanceAutoMemory, type AutoMemoryMaintenance } from "./auto-memory.ts";
import { createMemorySubsystem, type MemorySubsystem } from "./bootstrap.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { canonicalLocalMemoryFlushPort, createMemoryFlushBinding } from "./memory-flush-port.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";

interface MemoryRuntimeInput {
  db: Database; dataDir: string; promptDir: string; model: LanguageModel; timeline: TimelineRepo;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
}

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const fence = createMemoryAuthorityFence(); let activated = false;
  const utility = createUtilitySlot({ mainModel: input.model, config: loadUtilityConfig(input.env), logger: input.logger });
  let retireLegacyMaintenance = (): void => undefined;
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => createMemorySubsystem({ db: input.db, dataDir: input.dataDir, promptDir: input.promptDir, model: input.model, utility, timeline: input.timeline, windowStart: input.windowStart, env: input.env, logger: input.logger, authorityFence: fence, isCanonical: () => activated }),
    createCanonical: (epochId) => createCanonicalLocalRuntime({ db: input.db, epochId, promptDir: input.promptDir }),
    onCanonicalBound: () => retireLegacyMaintenance(),
  });
  activated = selected.canonical;
  const legacy = selected.legacy; const isCanonical = () => selected.canonical;
  const compaction = createCompactionMaintenance(input, utility, legacy);
  retireLegacyMaintenance = () => {
    activated = true;
    compaction.retireLegacy();
  };
  return {
    selected, memory: selected.memory, fence,
    snapshot: () => {
      const selection = readMemoryAuthoritySelection(input.db);
      const capabilities = runtimeCapabilities(selection.mode);
      return {
        providerId: selection.mode === "canonical-local" ? "local" : selection.mode,
        providerLineageId: selection.providerLineageId ?? undefined,
        authorityEpochId: selection.epochId ?? undefined,
        contractVersion: 1,
        capabilities,
      };
    },
    autoMemory: compaction.autoMemory,
    compaction: compaction.compact,
    tidy: legacy?.tidy ? authorityAwareTidy(legacy.tidy, isCanonical) : undefined,
    writeMemory: legacy?.writeMemory ? authorityAwareWrite(legacy.writeMemory, isCanonical) : undefined,
    memoryRoot: legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    migrationRunner: async () => {
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence, onActivated: selected.bindCanonical });
    },
  };
}

function createCompactionMaintenance(input: MemoryRuntimeInput, utility: UtilitySlot, legacy: MemorySubsystem | null) {
  let maintenance: AutoMemoryMaintenance | undefined = legacy?.maintenance;
  const flush = createMemoryFlushBinding(legacy?.memoryFlush ?? canonicalLocalMemoryFlushPort());
  const operations = createCompactionOperationRepo(input.db);
  const compact = createCompactionPass({
    view: { estimatedTokens: input.estimatedTokens, budget: input.budget,
      measureRequest: input.measureRequest ? (characterId) => input.measureRequest?.(characterId) : undefined,
      effectiveWindowTokens: input.effectiveWindowTokens },
    timeline: input.timeline,
    summaries: input.summaries,
    operations,
    flush: flush.port,
    slot: utility,
    config: { ...input.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
    protectedContent: () => [MEMORY_VOICE_RULE],
    logger: input.logger.child({ mod: "compaction" }),
  });
  const autoMemory = createMaintenanceAutoMemory({
    maintenance: () => maintenance,
    compact,
    logger: input.logger.child({ mod: "memory-auto" }),
  });
  return {
    autoMemory, compact,
    retireLegacy: () => {
      maintenance = undefined;
      flush.bind(canonicalLocalMemoryFlushPort());
    },
  };
}

function runtimeCapabilities(mode: "legacy-markdown" | "canonical-local" | "hindsight"): MemoryProviderCapabilities {
  if (mode === "hindsight") throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
  const canonical = mode === "canonical-local";
  return {
    providerId: canonical ? "local" : mode,
    contractVersion: 1,
    retain: true,
    recall: true,
    reflect: false,
    edit: canonical,
    invalidate: true,
    restore: canonical,
    conditionalMutation: canonical,
    idempotentWrites: canonical,
    sparseRetrieval: true,
    vectorRetrieval: "unavailable",
    derivedMemoryRead: false,
  };
}
