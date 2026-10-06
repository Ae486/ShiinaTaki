/**
 * INPUT:  Core boot dependencies for Legacy, Local and explicitly selected Hindsight memory runtimes, plus the boot identity
 * OUTPUT: selected immutable Runs, trusted primary custody, truthful binding/status recovery, operation access and transitions
 * POS:    core/memory — one Utility Slot/Compaction owner; symmetric epoch retirement, fresh binding and settled process shutdown;
 *         first activation and same-epoch connection replacement retain their independent receipt contracts
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
import { createCanonicalIngestionSourceRepo } from "../db/canonical-ingestion-source-repo.ts";
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
import type { HindsightActivationLocalRuntime } from "./hindsight-activation/hindsight-activation-service.ts";
import type { HindsightUnavailableRunEvent } from "./hindsight/hindsight-memory-runtime.ts";
import { createHindsightRuntimeBinding, witnessHindsightPrimaryCommit, type HindsightBindingSnapshot, type HindsightSubsystem } from "./hindsight-runtime-binding.ts";
import { readHindsightLiveConnection } from "./hindsight/hindsight-runtime-connection.ts";
import { createUnboundHindsightCapture } from "./hindsight-unbound-run.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createLocalRuntimeBinding, type LocalBindingSnapshot, type LocalSubsystem } from "./local-runtime-binding.ts";
import { createMemoryRunReference } from "./memory-capability-snapshot.ts";
import type { MemoryFlushPort } from "./memory-flush-port.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readMemoryAuthoritySelection, verifyCanonicalLocalReceipt } from "./legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationsRuntime } from "./operations/memory-operation-contract.ts";
import { selectMemoryRuntime, type BindingRecoveryOutcome } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";
import { createMemoryTransitionRuntime } from "./transitions/transition-runtime.ts";

interface MemoryRuntimeInput {
  db: Database; dataDir: string; promptDir: string; model: LanguageModel; timeline: TimelineRepo; bootId: string;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
  hindsight?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
  /** Core's automatic lifecycle trigger (late-bound); called for every memory-unavailable Hindsight Run. */
  onHindsightUnavailable?: (event: HindsightUnavailableRunEvent) => void;
}
type SelectedSubsystem = MemorySubsystem | LocalSubsystem | HindsightSubsystem;
interface ProviderMaintenance { maintenance: AutoMemoryMaintenance; memoryFlush: MemoryFlushPort }
export interface BindingRecovery { binding: BindingRecoveryOutcome; reconciledGroups: number }
export type LocalBindingRecovery = BindingRecovery;

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const utility = createUtilitySlot({ mainModel: input.model, config: loadUtilityConfig(input.env), logger: input.logger });
  const custody: PrimaryMemoryCustody = createPrimaryMemoryCustody({ db: input.db, bootId: input.bootId,
    onFailure: (failure) => input.logger.warn({ code: failure.code, groupId: failure.groupId }, "primary memory group finalize deferred; recovery will retry") });
  const scope = createSelectedSubsystem(input, utility); const { selected, current, fence, local, hindsightBinding } = scope;
  const unbound = createUnboundHindsightCapture({ db: input.db, logger: input.logger, promptDir: input.promptDir,
    binding: hindsightBinding.snapshot, onUnavailable: input.onHindsightUnavailable, live: () => input.hindsight
      ? readHindsightLiveConnection({ config: input.hindsight.source, secrets: input.hindsight.secrets }) : null });
  const compaction = createCompactionMaintenance(input, utility, current);
  const lifecycle = createRuntimeLifetime({ scope, utility, autoMemory: compaction.autoMemory });
  const alive = lifecycle.alive;
  const transitions = createMemoryTransitionRuntime({ db: input.db, local, hindsight: hindsightBinding, selected, custody,
    alive, settle: compaction.autoMemory.settle, startHindsight: lifecycle.startHindsight });
  return {
    selected, memory: selected.memory, fence, custody, transitions,
    snapshot: () => { alive(); return scope.hindsight ? scope.hindsight.snapshot() : diagnosticSnapshot(input.db); },
    /** Pure Local binding state for onboarding/authority status; no captureRun or Bank probe. */
    bindingSnapshot: (): LocalBindingSnapshot => local.snapshot(),
    /** Pure Hindsight binding state for activation/authority status; truthful before, during and after the rebind. */
    hindsightBindingSnapshot: (): HindsightBindingSnapshot => hindsightBinding.snapshot(),
    // The ONE live accessor the memory operation owner uses (D-S1-1): resolved per call, never a captured subsystem.
    operations: (): MemoryOperationsRuntime | null => scope.hindsight ? operationsRuntime(scope.hindsight) : null,
    captureRun: async (characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> => {
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (scope.hindsight) return scope.hindsight.captureRun(characterId, signal);
      const published = local.current();
      if (published) return published.captureRun(characterId);
      // Committed but unbound: a setting-caused state admits a memory-unavailable Run, any other a structured refusal;
      // never a Local or Legacy fallback.
      if (readMemoryAuthoritySelection(input.db).mode === "hindsight") return unbound(characterId);
      return captureLegacyRun(input.db, current(), characterId);
    },
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => {
      alive();
      if (witnessHindsightPrimaryCommit({ db: input.db, commit, logger: input.logger })) return;
      const selection = readMemoryAuthoritySelection(input.db);
      if (selection.mode === "canonical-local" && selection.epochId) {
        // Selection can precede construction. The marker routes the source witness in both directions, including
        // the interval where an old published Hindsight reference still exists but the new Local binding failed.
        createCanonicalIngestionSourceRepo(input.db).recordPrimaryCommitted({ ...commit, epochId: selection.epochId });
      }
    },
    autoMemory: compaction.autoMemory, compaction: compaction.compact,
    tidy: { maybeRun: (characterId: string) => { alive(); return current().tidy.maybeRun(characterId); },
      runNow: (characterId: string) => { alive(); return current().tidy.runNow(characterId); } },
    writeMemory: ((request) => { alive(); return current().writeMemory(request); }) satisfies MemoryWriteOp,
    start: () => { alive(); lifecycle.start(); },
    stop: () => lifecycle.stop(transitions.stop),
    memoryRoot: selected.legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    ...createBindingSeams({ input, scope, custody, lifecycle, settle: compaction.autoMemory.settle }),
    migrationRunner: async () => {
      alive();
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence,
        onActivated: selected.bindCanonical, reconcileCustody: () => { custody.reconcile(); } });
    },
  };
}

/** Same-epoch binding repair for both providers plus the Local -> Hindsight rebind; every entry proves the marker first. */
function createBindingSeams(deps: {
  input: MemoryRuntimeInput; scope: ReturnType<typeof createSelectedSubsystem>; custody: PrimaryMemoryCustody;
  lifecycle: ReturnType<typeof createRuntimeLifetime>; settle(): Promise<void>;
}) {
  const { input, scope, custody, lifecycle } = deps; const { selected, local } = scope; const { alive } = lifecycle;
  const committed = (mode: "canonical-local" | "hindsight", epochId: string) => {
    const selection = readMemoryAuthoritySelection(input.db);
    if (selection.mode !== mode || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return selection;
  };
  return {
    /** Same-epoch repair: receipt proof, custody reconciliation, then construction only when unavailable. Never activates. */
    recoverLocalBinding: (epochId: string): BindingRecovery => {
      alive();
      verifyCanonicalLocalReceipt(input.db, committed("canonical-local", epochId));
      const reconciledGroups = custody.reconcile();
      return { binding: selected.recoverCanonical(epochId), reconciledGroups };
    },
    /** The published Local seam the activation drain fences and settles; unavailable when no Local runtime is published. */
    activationLocalRuntime: (): HindsightActivationLocalRuntime => {
      alive();
      const published = local.current();
      if (!published) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
      return { fence: published.fence, ingestion: published.ingestion, settle: deps.settle };
    },
    /** After COMMIT: retire Local, then draft -> install -> publish -> start Hindsight as one binding; failure stays observable. */
    bindHindsight: (epochId: string): void => { alive(); selected.bindHindsight(epochId); lifecycle.startHindsight(); },
    /** Same-epoch repair on the verified Hindsight receipt (the marker read proves it); never re-promotes and never reopens Local. */
    recoverHindsightBinding: (epochId: string): BindingRecovery => {
      alive();
      committed("hindsight", epochId);
      const reconciledGroups = custody.reconcile();
      const binding = selected.recoverHindsight(epochId);
      lifecycle.startHindsight();
      return { binding, reconciledGroups };
    },
    /** Revalidation: same-epoch swap onto the current connection, then start; a construct/start failure stays observable. */
    replaceHindsightBinding: async (epochId: string): Promise<void> => {
      alive();
      committed("hindsight", epochId);
      await selected.replaceHindsight(epochId);
      alive();
      lifecycle.startHindsight();
    },
  };
}

function createSelectedSubsystem(input: MemoryRuntimeInput, utility: UtilitySlot) {
  const fence = createMemoryAuthorityFence(); let activated = false;
  const local = createLocalRuntimeBinding({ db: input.db, logger: input.logger,
    construct: (epochId) => createCanonicalLocalSubsystem({ ...input, epochId, utility, config: loadMemoryConfig(input.env) }) });
  const hindsight = createHindsightRuntimeBinding({ db: input.db, logger: input.logger,
    construct: (epochId) => createHindsightMemorySubsystem({ ...input, ...input.hindsight!, epochId, utility, config: loadMemoryConfig(input.env),
      onUnavailable: input.onHindsightUnavailable }) });
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => createMemorySubsystem({ ...input, utility, authorityFence: fence, isCanonical: () => activated }),
    createCanonical: (epochId) => local.publish(epochId).engine,
    createHindsight: input.hindsight ? (epochId) => hindsight.publish(epochId).engine : undefined,
    replaceHindsight: input.hindsight ? (epochId) => {
      const next = hindsight.replace(epochId);
      return { engine: next.subsystem.engine, retired: next.retired };
    } : undefined,
    onLegacyRetired: () => { activated = true; fence.retire(); },
    onLocalRetired: () => local.retire(),
    // The binding already recorded the unavailable state; boot continues with an observable, fail-closed facade.
    onBootUnavailable: () => undefined,
    hindsightLive: () => hindsight.current() !== undefined,
    localLive: () => local.current() !== undefined,
    onHindsightRetired: () => { void hindsight.retire(); },
  });
  activated = selected.canonical;
  const current = (): SelectedSubsystem => {
    const value = hindsight.current() ?? local.current() ?? selected.legacy;
    if (!value) throw new Error("MEMORY_INTEGRITY_ERROR: selected runtime is unavailable");
    return value;
  };
  return { selected, current, fence, local, hindsightBinding: hindsight, get hindsight() { return hindsight.current(); } };
}

function createRuntimeLifetime(input: {
  scope: ReturnType<typeof createSelectedSubsystem>; utility: ReturnType<typeof createUtilitySlot>;
  autoMemory: ReturnType<typeof createMaintenanceAutoMemory>;
}) {
  let stopped = false; let started = false; let completion: Promise<void> | undefined;
  const { scope } = input;
  return { alive: () => { if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); },
    // A boot start failure is recorded by the binding as unavailable (recover repairs it); Core keeps serving.
    start: () => { started = true; try { scope.hindsightBinding.start(); } catch { /* observable through the binding snapshot */ } },
    /** A binding published after start() (activation, recovery) starts immediately; before it, start() will. */
    startHindsight: () => { if (started) scope.hindsightBinding.start(); },
    stop: (stopTransitions: () => Promise<void>) => {
      if (completion) return completion;
      stopped = true; scope.selected.stop();
      // Abort producers concurrently, then settle every retired/failed binding before the caller closes SQLite.
      // The transition executor still owns its in-flight target receipt lookup until stopTransitions settles.
      completion = Promise.allSettled([stopTransitions(), input.autoMemory.stop(), input.utility.stop(),
        scope.hindsightBinding.stop(), scope.local.stop(), Promise.resolve(scope.selected.legacy?.stop?.())])
        .then((results) => { if (results.some((result) => result.status === "rejected")) throw new Error("MEMORY_SHUTDOWN_FAILED"); });
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
  return { epochId: runtime.epoch.epochId, configFingerprint: runtime.configFingerprint, deploymentMode: runtime.connection.deploymentMode,
    scheduler: hindsight.scheduler, writeFence: hindsight.writeFence, banks: runtime.banks, assertConnection: runtime.assertConnection,
    driftReason: runtime.driftReason, pendingSummary: (bankId) => pending.summary({ authorityEpochId: runtime.epoch.epochId, bankId }) };
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
