/**
 * INPUT:  Core boot dependencies, boot identity and live activity/config signals for selected memory runtimes
 * OUTPUT: selected immutable Runs, trusted primary custody, binding/status recovery, review hints, operation access and transitions
 * POS:    core/memory — one Utility Slot/Compaction owner; symmetric epoch retirement, fresh binding and settled process shutdown;
 *         first activation and same-epoch connection replacement retain their independent receipt contracts
 */
import type { LanguageModel } from "ai";
import { join } from "node:path";
import { BASE_SYSTEM_PROMPT } from "../agents/base-prompt.ts";
import type { RequestMeasurement } from "../agents/request-measurement.ts";
import type { ConfigSource } from "../config/config-source.ts";
import type { ConfigSubscriptions } from "../config/config-subscriptions.ts";
import type { ConfigApplicationTracker } from "../config/config-application.ts";
import { createMemoryRuntimePolicy } from "../config/memory-runtime-policy.ts";
import { forwardRenderedContextText } from "../agents/context-attribution.ts";
import { captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";
import { createPrimaryMemorySourceState } from "./primary-memory-source-state.ts";
import { cleanAbandonedSearchProjections } from "./search-projection-rebuild.ts";
import { captureMemoryConfig, createMemoryRuntimeConfiguration, memoryPolicyPorts, type TidyDispatch } from "./runtime-configuration-application.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { createCanonicalIngestionSourceRepo } from "../db/canonical-ingestion-source-repo.ts";
import { createPrimaryMemoryCustody, type PrimaryMemoryCustody } from "../db/primary-memory-custody-repo.ts";
import type { Database } from "../db/sqlite.ts";
import { createSearchProjectionPolicyRepo, type SearchProjectionIdentity } from "../db/search-projection-policy-repo.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import type { Logger } from "../logging/logger.ts";
import type { AuxiliaryUsageMeter } from "../observability/auxiliary-usage-meter.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MemoryProviderCapabilities } from "@taki/shared";
import { createMemorySubsystem, type MemorySubsystem } from "./bootstrap.ts";
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { createHindsightMemorySubsystem } from "./hindsight/hindsight-memory-subsystem.ts";
import type { HindsightClient } from "./hindsight/hindsight-client.ts";
import type { HindsightActivationLocalRuntime, HindsightActivationRuntime } from "./hindsight-activation/hindsight-activation-service.ts";
import type { HindsightUnavailableRunEvent } from "./hindsight/hindsight-memory-runtime.ts";
import { createHindsightRuntimeBinding, witnessHindsightPrimaryCommit, type HindsightBindingSnapshot, type HindsightSubsystem } from "./hindsight-runtime-binding.ts";
import { readHindsightLiveConnection } from "./hindsight/hindsight-runtime-connection.ts";
import { createUnboundHindsightCapture } from "./hindsight-unbound-run.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createLocalRuntimeBinding, type LocalBindingSnapshot, type LocalSubsystem } from "./local-runtime-binding.ts";
import { createMemoryRunReference } from "./memory-capability-snapshot.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import { readCurrentMemoryAuthorityIdentity } from "./legacy-migration/legacy-activation-repo.ts";
import { createMemoryAuthorityVerification, type MemoryAuthorityVerification } from "./runtime-authority-verification.ts";
import { countPendingHindsightMemoryWrites } from "../db/hindsight-memory-write-repo.ts";
import type { MemoryOperationsRuntime } from "./operations/memory-operation-contract.ts";
import { selectMemoryRuntime, type BindingRecoveryOutcome } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { createCompactionMaintenance } from "./runtime-compaction-composition.ts";
import { createRuntimeLifetime } from "./runtime-lifetime.ts";
import { createMemoryTransitionRuntime } from "./transitions/transition-runtime.ts";
import { createTemplateRuntimeControl } from "./hindsight/template-lifecycle/template-runtime-control.ts";

export interface MemoryRuntimeInput {
  db: Database; dataDir: string; promptDir: string; model?: LanguageModel; timeline: TimelineRepo; bootId: string;
  application?: ConfigApplicationTracker; configuration?: ConfigSource; utilityContextSlot?: () => "main" | "utility";
  currentPromptDir?: () => string; resolveUtilityModel?: () => LanguageModel | undefined;
  primarySources?: PrimaryConversationSourceRepo; usageMeter?: AuxiliaryUsageMeter;
  onSummaryCommitted?: () => void; onMaintenanceChanged?: () => void;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
  hindsight?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
  reviewActivity?: Pick<TurnRegistry, "idleSince" | "observe">;
  configChanges?: Pick<ConfigSubscriptions, "observe">;
  onPolicyReviewChanged?: (bankId: string) => void;
  /** Core's automatic lifecycle trigger (late-bound); called for every memory-unavailable Hindsight Run. */
  onHindsightUnavailable?: (event: HindsightUnavailableRunEvent) => void;
}
type SelectedSubsystem = MemorySubsystem | LocalSubsystem | HindsightSubsystem;
export interface BindingRecovery { binding: BindingRecoveryOutcome; reconciledGroups: number }
export type LocalBindingRecovery = BindingRecovery;

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const environment = { ...(input.configuration?.env() ?? input.env) };
  let promptDir = input.promptDir;
  input = { ...input, env: environment, currentPromptDir: () => promptDir };
  const policy = createMemoryRuntimePolicy(environment,
    readCurrentMemoryAuthorityIdentity(input.db).mode === "hindsight" ? undefined : input.application);
  cleanAbandonedSearchProjections(input.db);
  const tidyDispatch: TidyDispatch = {};
  const utility = createUtilitySlot({ mainModel: input.model, resolveModel: input.resolveUtilityModel,
    config: input.resolveUtilityModel ? null : loadUtilityConfig(input.env), logger: input.logger, usageMeter: input.usageMeter });
  const custody: PrimaryMemoryCustody = createPrimaryMemoryCustody({ db: input.db, bootId: input.bootId,
    onFailure: (failure) => input.logger.warn({ code: failure.code, groupId: failure.groupId }, "primary memory group finalize deferred; recovery will retry") });
  const scope = createSelectedSubsystem(input, utility, { policy, tidyDispatch }); const { selected, current, fence, local, hindsightBinding } = scope;
  const unbound = createUnboundHindsightCapture({ db: input.db, logger: input.logger, promptDir: input.promptDir,
    binding: hindsightBinding.snapshot, onUnavailable: input.onHindsightUnavailable, live: () => input.hindsight
      ? readHindsightLiveConnection({ config: input.hindsight.source, secrets: input.hindsight.secrets }) : null });
  const compaction = createCompactionMaintenance(input, utility, scope);
  const lifecycle = createRuntimeLifetime({ scope, utility, autoMemory: compaction.autoMemory });
  const alive = lifecycle.alive;
  const configuration = createMemoryRuntimeConfiguration({ input, scope, policy, alive, setPromptDir: (value) => { promptDir = value; } });
  const transitions = createMemoryTransitionRuntime({ db: input.db, local, hindsight: hindsightBinding, selected, custody, authority: scope.authority,
    alive, settle: compaction.autoMemory.settle, startHindsight: lifecycle.startHindsight, prepareLocal: configuration.prepareLocal,
    retireBackground: () => { compaction.compact.retirePending(); compaction.autoMemory.retirePending(); utility.retirePending(); } });
  const bindingSeams = createBindingSeams({ input, scope, custody, lifecycle, settle: compaction.autoMemory.settle });
  const templates = createTemplateRuntimeControl({ db: input.db, config: policy.construction(), connection: input.hindsight,
    binding: hindsightBinding, alive, settle: compaction.autoMemory.settle, replaceBinding: bindingSeams.replaceHindsightBinding,
    verifySelectedAuthority: scope.authority.verifySelectedAuthority });
  return {
    selected, memory: selected.memory, fence, custody, transitions, templates, dataDir: input.dataDir, ...scope.authority,
    utility, reconfigure: configuration.reconfigure, searchIndex: configuration.searchIndex, installIndexSubmit: configuration.installIndexSubmit,
    sourceState: createPrimaryMemorySourceState({ db: input.db, assertAlive: alive, hindsight: () => scope.hindsight?.state }),
    tidyOperations: configuration.tidyOperations,
    installTidySubmit: (requestRun: TidyDispatch["requestRun"]) => { alive(); tidyDispatch.requestRun = requestRun; },
    snapshot: () => { alive(); return scope.hindsight ? scope.hindsight.snapshot() : diagnosticSnapshot(input.db); },
    ...createBindingQueries(scope),
    // The ONE live accessor the memory operation owner uses (D-S1-1): resolved per call, never a captured subsystem.
    operations: (): MemoryOperationsRuntime | null => scope.hindsight ? operationsRuntime(scope.hindsight, scope.authority) : null,
    /** Read-only operator port; the observer owns selection verification and the encompassing SQLite snapshot. */
    observeHindsightStatus: () => scope.hindsight ? observeHindsightStatus(input.db, scope.hindsight) : null,
    captureRun: (characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> => configuration.captureRun(characterId, signal, async () => {
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (scope.hindsight) return scope.hindsight.captureRun(characterId, signal);
      const published = local.current();
      if (published) return published.captureRun(characterId);
      // Committed but unbound: a setting-caused state admits a memory-unavailable Run, any other a structured refusal;
      // never a Local or Legacy fallback.
      if (readCurrentMemoryAuthorityIdentity(input.db).mode === "hindsight") return unbound(characterId);
      return captureLegacyRun(input.db, current(), characterId);
    }),
    recordPrimaryCommitted: primaryCommitRecorder(input, scope, alive),
    autoMemory: compaction.autoMemory, compaction: compaction.compact,
    tidy: { maybeRun: (characterId: string) => { alive(); return current().tidy.maybeRun(characterId); },
      runNow: (characterId: string) => { alive(); return current().tidy.runNow(characterId); } },
    writeMemory: ((request) => { alive(); return current().writeMemory(request); }) satisfies MemoryWriteOp,
    start: () => { alive(); lifecycle.start(); configuration.start(); },
    stop: () => {
      tidyDispatch.requestRun = undefined;
      return lifecycle.stop(transitions.stop, configuration.stop);
    },
    memoryRoot: selected.legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    ...bindingSeams,
    migrationRunner: migrationRunnerPort({ input, scope, custody, alive }),
  };
}

function migrationRunnerPort(deps: { input: MemoryRuntimeInput; scope: MemoryRuntimeScope; custody: PrimaryMemoryCustody; alive(): void }) {
  const { input, scope, custody, alive } = deps;
  return async () => {
  alive();
  const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
  return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence: scope.fence,
    onActivated: scope.selected.bindCanonical, reconcileCustody: () => { custody.reconcile(); } });
  };
}

/** Publication queries describe current binding state; full validation has separate explicit entrypoints. */
function createBindingQueries(scope: ReturnType<typeof createSelectedSubsystem>) {
  return {
    /** Presence only: never authorizes a Run, read/write or epoch; failed, retired and stopped drafts are absent. */
    hasPublishedBinding: (provider: "local" | "hindsight"): boolean =>
      (provider === "local" ? scope.local.current() : scope.hindsightBinding.current()) !== undefined,
    /** Detached publication metadata for current status observation; never an authority proof. */
    bindingPublication: (provider: "local" | "hindsight") =>
      provider === "local" ? scope.local.publicationState() : scope.hindsightBinding.publicationState(),
    /** Pure Local binding state for onboarding/authority status; no captureRun or Bank probe. */
    bindingSnapshot: (): LocalBindingSnapshot => scope.local.snapshot(),
    /** Current Hindsight identity and binding state; never reconstructs historical receipt proof. */
    hindsightBindingSnapshot: (): HindsightBindingSnapshot => scope.hindsightBinding.snapshot(),
  };
}

/** Same-epoch binding repair for both providers plus the Local -> Hindsight rebind; every entry proves the marker first. */
function createBindingSeams(deps: {
  input: MemoryRuntimeInput; scope: ReturnType<typeof createSelectedSubsystem>; custody: PrimaryMemoryCustody;
  lifecycle: ReturnType<typeof createRuntimeLifetime>; settle(): Promise<void>;
}) {
  const { scope, custody, lifecycle } = deps; const { selected, local } = scope; const { alive } = lifecycle;
  const committed = (mode: "canonical-local" | "hindsight", epochId: string) => {
    const selection = scope.authority.verifySelectedAuthority();
    if (selection.mode !== mode || selection.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return selection;
  };
  return {
    /** Same-epoch repair: receipt proof, custody reconciliation, then construction only when unavailable. Never activates. */
    recoverLocalBinding: (epochId: string): BindingRecovery => {
      alive();
      committed("canonical-local", epochId);
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
    /** Same-epoch repair after full selected receipt verification; never re-promotes or reopens Local. */
    recoverHindsightBinding: (epochId: string): BindingRecovery => {
      alive();
      committed("hindsight", epochId);
      const reconciledGroups = custody.reconcile();
      const binding = selected.recoverHindsight(epochId);
      lifecycle.startHindsight();
      return { binding, reconciledGroups };
    },
    prepareHindsightActivation: (input: Parameters<HindsightActivationRuntime["prepareHindsightActivation"]>[0]) =>
      prepareHindsightActivation({ scope, alive }, input),
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

/** Activation owns preparation until completion/stop; the foreground Bank owner keeps each HTTP request finite. */
async function prepareHindsightActivation(deps: {
  scope: ReturnType<typeof createSelectedSubsystem>; alive(): void;
}, input: Parameters<HindsightActivationRuntime["prepareHindsightActivation"]>[0]): Promise<void> {
  deps.alive();
  const subsystem = deps.scope.hindsight;
  if (!subsystem || subsystem.state.runtime.epoch.epochId !== input.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  for (const bankId of input.bankIds) {
    await subsystem.state.service.synchronize({ bankId, mode: "foreground",
      context: { timeoutMs: subsystem.state.runtime.connection.requestTimeoutMs, signal: input.signal } });
  }
  if (input.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
  deps.alive();
  if (deps.scope.hindsight !== subsystem) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  subsystem.state.runtime.assertConnection();
}

function createRuntimeBindings(input: MemoryRuntimeInput, utility: UtilitySlot, options: {
  policy: ReturnType<typeof createMemoryRuntimePolicy>; tidyDispatch: TidyDispatch;
}) {
  const { config, common } = memoryPolicyPorts(input, options.policy);
  const binding = (identity: SearchProjectionIdentity) => {
    const projections = createSearchProjectionPolicyRepo(input.db);
    return { appliedStoplist: projections.appliedStoplist(identity), commit: (stoplist: boolean) => projections.write(identity, stoplist) };
  };
  const local = createLocalRuntimeBinding({ db: input.db, logger: input.logger,
    construct: (epochId) => createCanonicalLocalSubsystem({ ...input, ...common, epochId, utility, config: config(),
      searchPolicy: binding({ table: "canonical_memory_fts", epochId }),
      requestRun: async (characterId) => {
        if (options.tidyDispatch.requestRun) await options.tidyDispatch.requestRun(characterId);
        else if (local.current()) await local.current()!.tidy.runNow(characterId);
        else throw new Error("MEMORY_PROVIDER_UNAVAILABLE");
      },
      boundIdentity: () => local.boundIdentity() }) });
  const hindsight = createHindsightRuntimeBinding({ db: input.db, logger: input.logger,
    construct: (epochId) => createHindsightMemorySubsystem({ ...input, ...input.hindsight!, epochId, utility,
      config: captureMemoryConfig(input), captureConfig: () => captureMemoryConfig(input),
      onUnavailable: input.onHindsightUnavailable }) });
  return { local, hindsight, config, common, binding };
}

function createSelectedSubsystem(input: MemoryRuntimeInput, utility: UtilitySlot, options: {
  policy: ReturnType<typeof createMemoryRuntimePolicy>; tidyDispatch: TidyDispatch;
}) {
  const { local, hindsight, config, common, binding } = createRuntimeBindings(input, utility, options);
  const fence = createMemoryAuthorityFence(); let activated = false;
  const authority = createMemoryAuthorityVerification({ db: input.db, local, hindsight });
  const selected = selectMemoryRuntime({ db: input.db,
    verifySelectedAuthority: authority.verifySelectedAuthority,
    createLegacy: () => {
      const legacy = createMemorySubsystem({ ...input, ...common, config: config(), utility,
        searchPolicy: binding({ table: "memory_fts", epochId: null }), authorityFence: fence, isCanonical: () => activated,
        requestTidyRun: async (characterId) => {
          if (options.tidyDispatch.requestRun) await options.tidyDispatch.requestRun(characterId);
          else await legacy.tidy.runNow(characterId);
        } });
      return legacy;
    },
    createCanonical: (epochId) => local.publish(epochId).engine,
    createHindsight: input.hindsight ? (epochId) => hindsight.publish(epochId).engine : undefined,
    replaceHindsight: input.hindsight ? (epochId) => {
      const next = hindsight.replace(epochId);
      return { engine: next.subsystem.engine, retired: next.retired };
    } : undefined,
    onLegacyRetired: () => { activated = true; fence.retire(); },
    onLocalRetired: () => local.retire(),
    onBootUnavailable: (error, selection, invalidAuthority) => {
      if (!selection.epochId) throw error;
      const owner = selection.mode === "hindsight" ? hindsight : local;
      if (invalidAuthority) owner.unavailable(selection.epochId, "MEMORY_AUTHORITY_INVALID");
      else if (owner.publicationState().binding.kind === "none") owner.unavailable(selection.epochId, "MEMORY_RUNTIME_UNAVAILABLE");
    },
    hindsightLive: () => {
      const current = hindsight.current();
      if (!current) return false;
      try { current.state.runtime.assertConnection(); return true; } catch { return false; }
    },
    localLive: () => local.current() !== undefined,
    bindingLive: () => local.current() !== undefined || hindsight.current() !== undefined,
    onHindsightRetired: () => { void hindsight.retire(); },
  });
  activated = selected.canonical;
  const current = (): SelectedSubsystem => {
    const value = hindsight.current() ?? local.current() ?? selected.legacy;
    if (!value) throw new Error("MEMORY_INTEGRITY_ERROR: selected runtime is unavailable");
    return value;
  };
  return { selected, current, fence, local, authority, hindsightBinding: hindsight, get hindsight() { return hindsight.current(); } };
}
export type MemoryRuntimeScope = ReturnType<typeof createSelectedSubsystem>;


function primaryCommitRecorder(input: MemoryRuntimeInput, scope: MemoryRuntimeScope, alive: () => void) {
  return (commit: PrimaryConversationCommit) => {
    alive();
    const binding = scope.hindsightBinding.publicationState().binding;
    const localBinding = scope.local.publicationState().binding;
    if ([binding, localBinding].some((value) => value.kind === "unavailable" && value.code === "MEMORY_AUTHORITY_INVALID")) return;
    if (witnessHindsightPrimaryCommit({ db: input.db, commit, logger: input.logger })) return;
    const selection = readCurrentMemoryAuthorityIdentity(input.db);
    if (selection.mode === "canonical-local" && selection.epochId) {
      // The marker routes witnesses even when selection precedes construction of the new Local binding.
      createCanonicalIngestionSourceRepo(input.db).recordPrimaryCommitted({ ...commit, epochId: selection.epochId });
    }
  };
}

function captureLegacyRun(db: Database, subsystem: SelectedSubsystem, characterId: string): CapturedMemoryRun {
  const snapshot = diagnosticSnapshot(db);
  if (snapshot.providerId !== "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const engine = subsystem.engine;
  const primary = engine.captureAssembly?.(characterId);
  const assemble = (currentMessage: string) => {
    const text = primary ? primary(currentMessage) : engine.assemble({ characterId, currentMessage });
    return forwardRenderedContextText(assemble, primary ?? engine.assemble, text);
  };
  const initiative = engine.captureInitiative ? captureTrackedInitiativeAssembly(() => {
    const capture = engine.captureInitiative?.(characterId);
    if (!capture) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); return capture;
  }) : undefined;
  return Object.freeze({ snapshot: createMemoryRunReference(snapshot),
    tools: Object.freeze(engine.createTools(characterId)), prompt: BASE_SYSTEM_PROMPT,
    assembleInitiative: initiative?.assemble, isCurrent: initiative?.isCurrent, assemble });
}

function operationsRuntime(hindsight: HindsightSubsystem, authority: MemoryAuthorityVerification): MemoryOperationsRuntime {
  const { runtime, pending } = hindsight.state;
  return { epochId: runtime.epoch.epochId, configFingerprint: runtime.configFingerprint, deploymentMode: runtime.connection.deploymentMode,
    scheduler: hindsight.scheduler, writeFence: hindsight.writeFence, banks: runtime.banks, assertConnection: runtime.assertConnection,
    driftReason: runtime.driftReason, verifySelectedAuthority: authority.verifySelectedAuthority,
    pendingSummary: (bankId) => pending.summary({ authorityEpochId: runtime.epoch.epochId, bankId }) };
}

function observeHindsightStatus(db: Database, hindsight: HindsightSubsystem) {
  const { runtime, pending } = hindsight.state;
  const observed = runtime.observeStatus();
  if (observed.drift !== "none") return { ...observed, evidence: null };
  try {
    runtime.assertEvidence();
    return { ...observed, evidence: { replica: hindsight.scheduler.statusForBanks(observed.banks),
      pending: observed.banks.map(({ bankId }) => ({ bankId,
        summary: pending.summary({ authorityEpochId: runtime.epoch.epochId, bankId }),
        parentWritesPending: countPendingHindsightMemoryWrites(db, { authorityEpochId: runtime.epoch.epochId, bankId }) })) } };
  } catch (error) {
    if (error instanceof Error && error.message === "MEMORY_TEMPLATE_IDENTITY_CHANGED") throw error;
    // Unreadable evidence cannot erase the already published template identity.
    return { ...observed, evidence: { error } };
  }
}

function diagnosticSnapshot(db: Database) {
  const selection = readCurrentMemoryAuthorityIdentity(db);
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
