/**
 * INPUT:  Core boot dependencies for Legacy, Local and explicitly selected Hindsight memory runtimes, plus the boot identity
 * OUTPUT: authority-selected engine, immutable Run capture, background maintenance, durability, the operations() live
 *         accessor, trusted primary custody, the pure Local binding snapshot and same-epoch binding recovery
 * POS:    core/memory — process composition seam; one Utility Slot, one selected provider chain and ONE published Local binding
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
import { createPrimaryMemoryCustody, type PrimaryMemoryCustody } from "../db/primary-memory-custody-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MemoryProviderCapabilities } from "@taki/shared";
import { createMaintenanceAutoMemory, type AutoMemoryMaintenance } from "./auto-memory.ts";
import { createMemorySubsystem, type MemorySubsystem } from "./bootstrap.ts";
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { createHindsightMemorySubsystem } from "./hindsight/hindsight-memory-subsystem.ts";
import type { HindsightClient } from "./hindsight/hindsight-client.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createLocalRuntimeBinding, type LocalBindingSnapshot, type LocalSubsystem } from "./local-runtime-binding.ts";
import { createMemoryRunReference } from "./memory-capability-snapshot.ts";
import type { MemoryFlushPort } from "./memory-flush-port.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readMemoryAuthoritySelection, verifyCanonicalLocalReceipt } from "./legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationsRuntime } from "./operations/memory-operation-contract.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";

interface MemoryRuntimeInput {
  db: Database; dataDir: string; promptDir: string; model: LanguageModel; timeline: TimelineRepo; bootId: string;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
  hindsight?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
}
type HindsightSubsystem = ReturnType<typeof createHindsightMemorySubsystem>;
type SelectedSubsystem = MemorySubsystem | LocalSubsystem | HindsightSubsystem;
interface ProviderMaintenance { maintenance: AutoMemoryMaintenance; memoryFlush: MemoryFlushPort }
export interface LocalBindingRecovery { binding: "healthy" | "published"; reconciledGroups: number }

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const utility = createUtilitySlot({ mainModel: input.model, config: loadUtilityConfig(input.env), logger: input.logger });
  const custody: PrimaryMemoryCustody = createPrimaryMemoryCustody({ db: input.db, bootId: input.bootId,
    onFailure: (failure) => input.logger.warn({ code: failure.code, groupId: failure.groupId }, "primary memory group finalize deferred; recovery will retry") });
  const scope = createSelectedSubsystem(input, utility); const { selected, current, fence, local } = scope;
  const compaction = createCompactionMaintenance(input, utility, current);
  const lifecycle = createRuntimeLifetime({ scope, utility, autoMemory: compaction.autoMemory });
  const alive = lifecycle.alive;
  return {
    selected, memory: selected.memory, fence, custody,
    snapshot: () => { alive(); return scope.hindsight ? scope.hindsight.snapshot() : diagnosticSnapshot(input.db); },
    /** Pure Local binding state for onboarding/authority status; no captureRun or Bank probe. */
    bindingSnapshot: (): LocalBindingSnapshot => local.snapshot(),
    // The ONE live accessor the memory operation owner uses (D-S1-1): resolved per call, never a captured subsystem.
    operations: (): MemoryOperationsRuntime | null => scope.hindsight ? operationsRuntime(scope.hindsight) : null,
    captureRun: async (characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> => {
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      const published = local.current();
      return scope.hindsight ? scope.hindsight.captureRun(characterId, signal) : published ? published.captureRun(characterId)
        : captureLegacyRun(input.db, current(), characterId);
    },
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => { alive(); (scope.hindsight ?? local.current())?.recordPrimaryCommitted(commit); },
    autoMemory: compaction.autoMemory, compaction: compaction.compact,
    tidy: { maybeRun: (characterId: string) => { alive(); return current().tidy.maybeRun(characterId); },
      runNow: (characterId: string) => { alive(); return current().tidy.runNow(characterId); } },
    writeMemory: ((request) => { alive(); return current().writeMemory(request); }) satisfies MemoryWriteOp,
    start: () => { alive(); scope.hindsight?.start(); }, stop: lifecycle.stop,
    memoryRoot: selected.legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    /** Same-epoch repair: receipt proof, custody reconciliation, then construction only when unavailable. Never activates. */
    recoverLocalBinding: (epochId: string): LocalBindingRecovery => {
      alive();
      const selection = readMemoryAuthoritySelection(input.db);
      if (selection.mode !== "canonical-local" || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      verifyCanonicalLocalReceipt(input.db, selection);
      const reconciledGroups = custody.reconcile();
      return { binding: selected.recoverCanonical(epochId), reconciledGroups };
    },
    migrationRunner: async () => {
      alive();
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence,
        onActivated: selected.bindCanonical, reconcileCustody: () => { custody.reconcile(); } });
    },
  };
}

function createSelectedSubsystem(input: MemoryRuntimeInput, utility: UtilitySlot) {
  const fence = createMemoryAuthorityFence(); let activated = false;
  let hindsight: HindsightSubsystem | undefined;
  const local = createLocalRuntimeBinding({ db: input.db, logger: input.logger,
    construct: (epochId) => createCanonicalLocalSubsystem({ ...input, epochId, utility, config: loadMemoryConfig(input.env) }) });
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => createMemorySubsystem({ ...input, utility, authorityFence: fence, isCanonical: () => activated }),
    createCanonical: (epochId) => local.publish(epochId).engine,
    createHindsight: input.hindsight ? (epochId) => {
      hindsight = createHindsightMemorySubsystem({ ...input, ...input.hindsight!, epochId, utility,
        config: loadMemoryConfig(input.env) });
      return hindsight.engine;
    } : undefined,
    onLegacyRetired: () => { activated = true; fence.retire(); },
    // The binding already recorded the unavailable state; boot continues with an observable, fail-closed Local facade.
    onBootUnavailable: () => undefined,
  });
  activated = selected.canonical;
  const current = (): SelectedSubsystem => {
    const value = hindsight ?? local.current() ?? selected.legacy;
    if (!value) throw new Error("MEMORY_INTEGRITY_ERROR: selected runtime is unavailable");
    return value;
  };
  return { selected, current, fence, local, get hindsight() { return hindsight; } };
}

function createRuntimeLifetime(input: {
  scope: ReturnType<typeof createSelectedSubsystem>; utility: ReturnType<typeof createUtilitySlot>;
  autoMemory: ReturnType<typeof createMaintenanceAutoMemory>;
}) {
  let stopped = false; let completion: Promise<void> | undefined;
  const stopCurrent = (): Promise<unknown> => {
    // An unavailable binding has no subsystem to stop; the draft was already disposed at publication failure.
    try { return Promise.resolve(input.scope.current().stop?.()); } catch { return Promise.resolve(); }
  };
  return { alive: () => { if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); },
    stop: () => {
      if (completion) return completion;
      stopped = true; input.scope.selected.stop();
      completion = Promise.allSettled([input.autoMemory.stop(), input.utility.stop(), stopCurrent()])
        .then((results) => { input.scope.local.stop(); if (results.some((result) => result.status === "rejected")) throw new Error("MEMORY_SHUTDOWN_FAILED"); });
      return completion;
    } };
}

function createCompactionMaintenance(input: MemoryRuntimeInput, utility: UtilitySlot, current: () => ProviderMaintenance) {
  const compact = createCompactionPass({
    view: { estimatedTokens: input.estimatedTokens, budget: input.budget,
      measureRequest: input.measureRequest ? (characterId) => input.measureRequest?.(characterId) : undefined,
      effectiveWindowTokens: input.effectiveWindowTokens },
    timeline: input.timeline, summaries: input.summaries, operations: createCompactionOperationRepo(input.db),
    flush: publishedFlushPort(current), slot: utility,
    config: { ...input.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
    protectedContent: () => [MEMORY_VOICE_RULE],
    logger: input.logger.child({ mod: "compaction" }),
  });
  const autoMemory = createMaintenanceAutoMemory({ maintenance: () => current().maintenance, compact,
    logger: input.logger.child({ mod: "memory-auto" }) });
  return { autoMemory, compact };
}

/** Flush resolves from the same published binding per call; a retired or unavailable runtime fails every retirement. */
function publishedFlushPort(current: () => ProviderMaintenance): MemoryFlushPort {
  return { prepareRetirement: (request) => {
    let port: MemoryFlushPort;
    try { port = current().memoryFlush; }
    catch { return Promise.resolve({ status: "retryable_failure", code: "MEMORY_FLUSH_FAILED" }); }
    return port.prepareRetirement(request);
  } };
}

function captureLegacyRun(db: Database, subsystem: SelectedSubsystem, characterId: string): CapturedMemoryRun {
  const snapshot = diagnosticSnapshot(db);
  if (snapshot.providerId !== "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const engine = subsystem.engine;
  return Object.freeze({ snapshot: createMemoryRunReference(snapshot),
    tools: Object.freeze(engine.createTools(characterId)), prompt: BASE_SYSTEM_PROMPT,
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
