/**
 * INPUT:  Core boot dependencies for legacy Markdown and canonical Local memory runtimes
 * OUTPUT: authority-selected engine, retired legacy surfaces, roots, fence, and migration runner factory
 * POS:    core/memory — process composition seam kept out of main.ts; marker selection happens before legacy creation
 */
import type { LanguageModel } from "ai";
import { join } from "node:path";
import type { Database } from "../db/sqlite.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { MemoryProviderCapabilities } from "@taki/shared";
import { authorityAwareAutoMemory, authorityAwareTidy, authorityAwareWrite } from "./authority-aware-legacy-surfaces.ts";
import { createMemorySubsystem } from "./bootstrap.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";

export function composeMemoryRuntime(input: {
  db: Database; dataDir: string; promptDir: string; model: LanguageModel; timeline: TimelineRepo;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
}) {
  const fence = createMemoryAuthorityFence(); let activated = false;
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => createMemorySubsystem({ db: input.db, dataDir: input.dataDir, promptDir: input.promptDir, model: input.model, timeline: input.timeline, windowStart: input.windowStart, compaction: { summaries: input.summaries, view: { estimatedTokens: input.estimatedTokens, budget: input.budget }, config: input.compact }, env: input.env, logger: input.logger, authorityFence: fence, isCanonical: () => activated }),
    createCanonical: (epochId) => createCanonicalLocalRuntime({ db: input.db, epochId, promptDir: input.promptDir }),
  });
  activated = selected.canonical;
  const legacy = selected.legacy; const isCanonical = () => selected.canonical;
  const bindCanonical = (epochId: string): void => { selected.bindCanonical(epochId); activated = true; };
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
    autoMemory: legacy?.autoMemory ? authorityAwareAutoMemory(legacy.autoMemory, isCanonical) : undefined,
    tidy: legacy?.tidy ? authorityAwareTidy(legacy.tidy, isCanonical) : undefined,
    writeMemory: legacy?.writeMemory ? authorityAwareWrite(legacy.writeMemory, isCanonical) : undefined,
    memoryRoot: legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    migrationRunner: async () => {
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence, onActivated: bindCanonical });
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
