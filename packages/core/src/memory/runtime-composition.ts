/**
 * INPUT:  Core boot dependencies for Legacy, Local and explicitly selected Hindsight memory runtimes
 * OUTPUT: authority-selected engine, immutable Run capture, background maintenance, durability and the operations() live accessor
 * POS:    core/memory — process composition seam; one Utility Slot with independent canonical maintenance and compaction
 */
import type { LanguageModel } from "ai";
import { join } from "node:path";
import { BASE_SYSTEM_PROMPT } from "../agents/base-prompt.ts";
import { createCompactionPass } from "../agents/compaction-pass.ts";
import type { RequestMeasurement } from "../agents/request-measurement.ts";
import type { ConfigSource } from "../config/config-source.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { AuxiliaryUsageMeter } from "../observability/auxiliary-usage-meter.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MemoryProviderCapabilities } from "@taki/shared";
import { createMaintenanceAutoMemory } from "./auto-memory.ts";
import { createMemorySubsystem, type MemorySubsystem } from "./bootstrap.ts";
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { createHindsightMemorySubsystem } from "./hindsight/hindsight-memory-subsystem.ts";
import type { HindsightClient } from "./hindsight/hindsight-client.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createMemoryRunReference } from "./memory-capability-snapshot.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationsRuntime } from "./operations/memory-operation-contract.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";
import { bindInitiativeAssembly, captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";
import { createPrimaryMemorySourceState } from "./primary-memory-source-state.ts";

interface MemoryRuntimeInput {
  db: Database; dataDir: string; promptDir: string; model: LanguageModel; timeline: TimelineRepo;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
  primarySources?: PrimaryConversationSourceRepo;
  usageMeter?: AuxiliaryUsageMeter;
  onSummaryCommitted?: () => void;
  hindsight?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
}
type LocalSubsystem = ReturnType<typeof createCanonicalLocalSubsystem>;
type HindsightSubsystem = ReturnType<typeof createHindsightMemorySubsystem>;
type SelectedSubsystem = MemorySubsystem | LocalSubsystem | HindsightSubsystem;

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const utility = createUtilitySlot({ mainModel: input.model, config: loadUtilityConfig(input.env), logger: input.logger,
    usageMeter: input.usageMeter });
  const scope = createSelectedSubsystem(input, utility); const { selected, current, fence } = scope;
  const compaction = createCompactionMaintenance(input, utility, scope);
  const lifecycle = createRuntimeLifetime({ scope, utility, autoMemory: compaction.autoMemory });
  const alive = lifecycle.alive;
  return {
    selected, memory: selected.memory, fence, utility,
    sourceState: createPrimaryMemorySourceState({ db: input.db, assertAlive: alive, hindsight: () => scope.hindsight?.state }),
    snapshot: () => { alive(); return scope.hindsight ? scope.hindsight.snapshot() : diagnosticSnapshot(input.db); },
    // The ONE live accessor the memory operation owner uses (D-S1-1): resolved per call, never a captured subsystem.
    operations: (): MemoryOperationsRuntime | null => scope.hindsight ? operationsRuntime(scope.hindsight) : null,
    captureRun: async (characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> => {
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      const captured = await (scope.hindsight ? scope.hindsight.captureRun(characterId, signal) : scope.canonical ? scope.canonical.captureRun(characterId)
        : captureLegacyRun(input.db, current(), characterId));
      // The selected provider validates its binding first, preserving its typed stale-authority refusal.
      // This local fence adds held-Run currentness without replacing the provider's admission contract.
      const selection = readMemoryAuthoritySelection(input.db);
      if (captured.isCurrent?.() === false) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      const isCurrent = () => {
        try {
          alive(); const actual = readMemoryAuthoritySelection(input.db);
          return actual.mode === selection.mode && actual.epochId === selection.epochId && captured.isCurrent?.() !== false;
        } catch { return false; }
      };
      return Object.freeze({ ...captured, isCurrent, assembleInitiative: bindInitiativeAssembly(captured.assembleInitiative, isCurrent) });
    },
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => { alive(); (scope.hindsight ?? scope.canonical)?.recordPrimaryCommitted(commit); },
    autoMemory: compaction.autoMemory, compaction: compaction.compact,
    tidy: { maybeRun: (characterId: string) => { alive(); return current().tidy.maybeRun(characterId); },
      runNow: (characterId: string) => { alive(); return current().tidy.runNow(characterId); } },
    writeMemory: ((request) => { alive(); return current().writeMemory(request); }) satisfies MemoryWriteOp,
    start: () => { alive(); scope.hindsight?.start(); }, stop: lifecycle.stop,
    memoryRoot: selected.legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    migrationRunner: async () => {
      alive();
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence, onActivated: selected.bindCanonical });
    },
  };
}

function createSelectedSubsystem(input: MemoryRuntimeInput, utility: UtilitySlot) {
  const fence = createMemoryAuthorityFence(); let activated = false;
  let canonical: LocalSubsystem | undefined;
  let hindsight: HindsightSubsystem | undefined;
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => createMemorySubsystem({ ...input, utility, authorityFence: fence, isCanonical: () => activated }),
    createCanonical: (epochId) => {
      canonical = createCanonicalLocalSubsystem({ ...input, epochId, utility, config: loadMemoryConfig(input.env) });
      return canonical.engine;
    },
    createHindsight: input.hindsight ? (epochId) => {
      hindsight = createHindsightMemorySubsystem({ ...input, ...input.hindsight!, epochId, utility,
        config: loadMemoryConfig(input.env) });
      return hindsight.engine;
    } : undefined,
    onLegacyRetired: () => { activated = true; fence.retire(); },
  });
  activated = selected.canonical;
  const current = (): SelectedSubsystem => {
    const value = hindsight ?? canonical ?? selected.legacy;
    if (!value) throw new Error("MEMORY_INTEGRITY_ERROR: selected runtime is unavailable");
    return value;
  };
  return { selected, current, fence, get canonical() { return canonical; }, get hindsight() { return hindsight; } };
}

function createRuntimeLifetime(input: {
  scope: ReturnType<typeof createSelectedSubsystem>; utility: ReturnType<typeof createUtilitySlot>;
  autoMemory: ReturnType<typeof createMaintenanceAutoMemory>;
}) {
  let stopped = false; let completion: Promise<void> | undefined;
  return { alive: () => { if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); },
    stop: () => {
      if (completion) return completion;
      stopped = true; input.scope.selected.stop();
      completion = Promise.allSettled([input.autoMemory.stop(), input.utility.stop(), Promise.resolve(input.scope.current().stop?.())])
        .then((results) => { if (results.some((result) => result.status === "rejected")) throw new Error("MEMORY_SHUTDOWN_FAILED"); });
      return completion;
    } };
}

function createCompactionMaintenance(input: MemoryRuntimeInput, utility: UtilitySlot, scope: ReturnType<typeof createSelectedSubsystem>) {
  const compact = createCompactionPass({
    view: { estimatedTokens: input.estimatedTokens, budget: input.budget,
      measureRequest: input.measureRequest ? (characterId) => input.measureRequest?.(characterId) : undefined,
      effectiveWindowTokens: input.effectiveWindowTokens },
    timeline: input.timeline, summaries: input.summaries,
    operations: createCompactionOperationRepo(input.db, { onSummaryCommitted: input.onSummaryCommitted }),
    legacyFlush: () => scope.selected.canonical ? undefined : scope.current().memoryFlush, slot: utility,
    config: { ...input.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
    protectedContent: () => [MEMORY_VOICE_RULE],
    logger: input.logger.child({ mod: "compaction" }),
  });
  const autoMemory = createMaintenanceAutoMemory({ maintenance: () => scope.current().maintenance, compact,
    legacyMaintenanceBeforeCompact: () => !scope.selected.canonical,
    logger: input.logger.child({ mod: "memory-auto" }) });
  return { autoMemory, compact };
}

function captureLegacyRun(db: Database, subsystem: SelectedSubsystem, characterId: string): CapturedMemoryRun {
  const snapshot = diagnosticSnapshot(db);
  if (snapshot.providerId !== "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const engine = subsystem.engine;
  const initiative = engine.captureInitiative ? captureTrackedInitiativeAssembly(() => {
    const capture = engine.captureInitiative?.(characterId);
    if (!capture) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); return capture;
  }) : undefined;
  return Object.freeze({ snapshot: createMemoryRunReference(snapshot),
    tools: Object.freeze(engine.createTools(characterId)), prompt: BASE_SYSTEM_PROMPT,
    assembleInitiative: initiative?.assemble, isCurrent: initiative?.isCurrent,
    assemble: (currentMessage: string) => engine.assemble({ characterId, currentMessage }) });
}

function operationsRuntime(hindsight: HindsightSubsystem): MemoryOperationsRuntime {
  const { runtime, pending } = hindsight.state;
  return { epochId: runtime.epoch.epochId, scheduler: hindsight.scheduler, banks: runtime.banks, assertConnection: runtime.assertConnection,
    pendingSummary: (bankId) => pending.summary({ authorityEpochId: runtime.epoch.epochId, bankId }) };
}

function diagnosticSnapshot(db: Database) {
  const selection = readMemoryAuthoritySelection(db);
  return { providerId: selection.mode === "canonical-local" ? "local" : selection.mode,
    providerLineageId: selection.providerLineageId ?? undefined, authorityEpochId: selection.epochId ?? undefined,
    contractVersion: 1, capabilities: runtimeCapabilities(selection.mode) };
}

function runtimeCapabilities(mode: "legacy-markdown" | "canonical-local" | "hindsight"): MemoryProviderCapabilities {
  if (mode === "hindsight") throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
  if (mode === "canonical-local") return LOCAL_MEMORY_CAPABILITIES;
  return { providerId: mode, contractVersion: 1, retain: true, recall: true, reflect: false,
    edit: false, invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
    sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false };
}
