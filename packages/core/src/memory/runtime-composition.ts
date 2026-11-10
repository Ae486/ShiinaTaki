/**
 * INPUT:  Core boot dependencies for Legacy, Local and explicitly selected Hindsight memory runtimes
 * OUTPUT: authority-selected engine, immutable Run capture, background maintenance, durability and the operations() live accessor
 * POS:    core/memory — process composition seam; one Utility Slot with independent canonical maintenance and compaction
 */
import type { LanguageModel } from "ai";
import { join } from "node:path";
import { BASE_SYSTEM_PROMPT } from "../agents/base-prompt.ts";
import { forwardRenderedContextText } from "../agents/context-attribution.ts";
import { createCompactionPass } from "../agents/compaction-pass.ts";
import type { RequestMeasurement } from "../agents/request-measurement.ts";
import type { ConfigSource } from "../config/config-source.ts";
import type { ConfigApplicationTracker } from "../config/config-application.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createMemoryRuntimePolicy, type MemoryRuntimePolicy } from "../config/memory-runtime-policy.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import type { Database } from "../db/sqlite.ts";
import { createSearchProjectionPolicyRepo, type SearchProjectionIdentity } from "../db/search-projection-policy-repo.ts";
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
import type { MemoryOperationsRuntime, MemoryTidyRuntime } from "./operations/memory-operation-contract.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";
import { createUtilitySlot, type UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";
import { loadContextConfig } from "../config/context-config.ts";
import { ServerConfigSchema } from "../config/server-config.ts";
import { bindInitiativeAssembly, captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";
import { createPrimaryMemorySourceState } from "./primary-memory-source-state.ts";
import { cleanAbandonedSearchProjections } from "./search-projection-rebuild.ts";
import { createMemorySearchApplication } from "./memory-search-application.ts";

interface MemoryRuntimeInput {
  application?: ConfigApplicationTracker;
  configuration?: ConfigSource;
  utilityContextSlot?: () => "main" | "utility";
  currentPromptDir?: () => string;
  db: Database; dataDir: string; promptDir: string; model?: LanguageModel;
  resolveUtilityModel?: () => LanguageModel | undefined; timeline: TimelineRepo;
  windowStart: (characterId: string) => number; summaries: SummaryRepo; estimatedTokens: (characterId: string) => number;
  budget: () => number; compact: { triggerRatio: number; keepMessages: number }; env: Record<string, string | undefined>; logger: Logger;
  measureRequest?: (characterId: string) => RequestMeasurement | undefined;
  effectiveWindowTokens?: () => number;
  primarySources?: PrimaryConversationSourceRepo;
  usageMeter?: AuxiliaryUsageMeter;
  onSummaryCommitted?: () => void;
  onMaintenanceChanged?: () => void;
  hindsight?: { source: ConfigSource; secrets: SecretCatalogService; client?: HindsightClient };
}
type LocalSubsystem = ReturnType<typeof createCanonicalLocalSubsystem>;
type HindsightSubsystem = ReturnType<typeof createHindsightMemorySubsystem>;
type SelectedSubsystem = MemorySubsystem | LocalSubsystem | HindsightSubsystem;
interface TidyDispatch { requestRun?: (characterId: string) => Promise<void> }

export function composeMemoryRuntime(input: MemoryRuntimeInput) {
  const environment = { ...(input.configuration?.env() ?? input.env) };
  let promptDir = input.promptDir;
  input = { ...input, env: environment, currentPromptDir: () => promptDir };
  const local = readMemoryAuthoritySelection(input.db).mode !== "hindsight";
  const policy = local ? createMemoryRuntimePolicy(environment, input.application) : undefined;
  if (local) cleanAbandonedSearchProjections(input.db);
  const utility = createUtilitySlot({ mainModel: input.model, resolveModel: input.resolveUtilityModel,
    config: input.resolveUtilityModel ? null : loadUtilityConfig(input.env), logger: input.logger,
    usageMeter: input.usageMeter });
  const tidyDispatch: TidyDispatch = {};
  const scope = createSelectedSubsystem(input, utility, { tidyDispatch, policy }); const { selected, current, fence } = scope;
  if (selected.canonical) input.application?.mark(["TAKI_MEMORY_BM25_WEIGHTS"], "inapplicable", { activeValue: null });
  const search = policy ? createMemorySearchApplication({ memory: selected.memory, policy,
    environment: () => input.configuration?.env() ?? input.env,
    onReady: () => { const value = current(); if ("resumeRetention" in value) value.resumeRetention?.(); },
    epochId: () => readMemoryAuthoritySelection(input.db).epochId, application: input.application }) : undefined;
  const reconfigure = createMemoryReconfiguration({ input, policy, selected, search, setPromptDir: (next) => { promptDir = next; } });
  const compaction = createCompactionMaintenance(input, utility, scope);
  const lifecycle = createRuntimeLifetime({ scope, utility, autoMemory: compaction.autoMemory });
  const stop = createRuntimeStop({ lifecycle, search, tidyDispatch });
  const alive = lifecycle.alive;
  return {
    selected, memory: selected.memory, fence, utility, reconfigure,
    searchIndex: () => search?.current() ?? null,
    installIndexSubmit: (submit: (stoplist: boolean) => Promise<void>) => { search?.installSubmit(submit); },
    sourceState: createPrimaryMemorySourceState({ db: input.db, assertAlive: alive, hindsight: () => scope.hindsight?.state }),
    snapshot: () => { alive(); return scope.hindsight ? scope.hindsight.snapshot() : diagnosticSnapshot(input.db); },
    // The ONE live accessor the memory operation owner uses (D-S1-1): resolved per call, never a captured subsystem.
    operations: (): MemoryOperationsRuntime | null => scope.hindsight ? operationsRuntime(scope.hindsight) : null,
    tidyOperations: () => tidyOperationRuntime({ db: input.db, scope, alive }),
    installTidySubmit: (requestRun: TidyDispatch["requestRun"]) => { alive(); tidyDispatch.requestRun = requestRun; },
    captureRun: (characterId: string, signal?: AbortSignal) => captureRuntimeRun({ input, scope, search, policy, alive }, characterId, signal),
    recordPrimaryCommitted: (commit: PrimaryConversationCommit) => { alive(); (scope.hindsight ?? scope.canonical)?.recordPrimaryCommitted(commit); },
    autoMemory: compaction.autoMemory, compaction: compaction.compact,
    tidy: { maybeRun: (characterId: string) => { alive(); return current().tidy.maybeRun(characterId); },
      runNow: (characterId: string) => { alive(); return current().tidy.runNow(characterId); } },
    writeMemory: ((request) => { alive(); return current().writeMemory(request); }) satisfies MemoryWriteOp,
    start: () => { alive(); scope.hindsight?.start(); search?.start(); }, stop,
    memoryRoot: selected.legacy?.memoryRoot ?? join(input.dataDir, "workspace", "memory"),
    migrationRunner: async () => {
      alive();
      const { createLegacyMigrationRunner } = await import("./legacy-migration/legacy-migration-runner.ts");
      return createLegacyMigrationRunner({ db: input.db, destinationRoot: join(input.dataDir, "workspace", "memory-migration"), fence, onActivated: selected.bindCanonical });
    },
  };
}

function createRuntimeStop(input: {
  lifecycle: ReturnType<typeof createRuntimeLifetime>; search?: ReturnType<typeof createMemorySearchApplication>; tidyDispatch: TidyDispatch;
}) {
  let completion: Promise<void> | undefined;
  return () => {
    if (completion) return completion;
    input.tidyDispatch.requestRun = undefined;
    const search = input.search?.stop();
    const runtime = input.lifecycle.stop();
    completion = search ? Promise.all([search, runtime]).then(() => undefined) : runtime;
    return completion;
  };
}

function createMemoryReconfiguration(options: {
  input: MemoryRuntimeInput; policy?: MemoryRuntimePolicy; selected: ReturnType<typeof selectMemoryRuntime>;
  search?: ReturnType<typeof createMemorySearchApplication>; setPromptDir(value: string): void;
}) {
  const { input, policy, selected, search } = options;
  return async (key?: string) => {
    const next = { ...(input.configuration?.env() ?? input.env) };
    if (key === "TAKI_PROMPT_DIR") options.setPromptDir(ServerConfigSchema.shape.promptDir.parse(next.TAKI_PROMPT_DIR));
    if (key && policy) {
      const group = policy.groupFor(key);
      if (group === "search") await search!.apply();
      else if (group) {
        const prepared = policy.prepare(group, next);
        if (group === "ranking" && !selected.canonical) selected.memory.reconfigureRanking?.(prepared.parsed.bm25Weights);
        policy.commit(prepared);
        input.application?.mark(policy.keys(group), group === "ranking" && selected.canonical ? "inapplicable" : "applied");
      }
    } else if (key === "TAKI_MEMORY_STOPLIST" || key === "TAKI_MEMORY_BM25_WEIGHTS" || key === "TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS") {
      input.application?.mark([key], key === "TAKI_MEMORY_BM25_WEIGHTS" ? "inapplicable" : "restart-required",
        "The selected Hindsight runtime retains its existing policy; live replacement belongs to the dedicated Hindsight task.");
    }
    // Another committed setting may have arrived while search maintenance yielded.
    const latest = { ...(input.configuration?.env() ?? next) };
    for (const key of Object.keys(input.env)) delete input.env[key];
    Object.assign(input.env, latest);
  };
}

async function captureRuntimeRun(options: {
  input: MemoryRuntimeInput; scope: ReturnType<typeof createSelectedSubsystem>; alive(): void;
  search?: ReturnType<typeof createMemorySearchApplication>; policy?: MemoryRuntimePolicy;
}, characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> {
  const { input, scope, alive, search, policy } = options;
  alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  await search?.ensureReady();
  alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  if (!scope.selected.canonical) policy?.capture("ranking");
  const captured = await (scope.hindsight ? scope.hindsight.captureRun(characterId, signal) : scope.canonical
    ? scope.canonical.captureRun(characterId) : captureLegacyRun(input.db, scope.current(), characterId));
  // Provider validation precedes this additional held-Run authority fence.
  const selection = readMemoryAuthoritySelection(input.db);
  if (captured.isCurrent?.() === false) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const isCurrent = () => {
    try {
      alive(); const actual = readMemoryAuthoritySelection(input.db);
      return actual.mode === selection.mode && actual.epochId === selection.epochId && captured.isCurrent?.() !== false;
    } catch { return false; }
  };
  return Object.freeze({ ...captured, isCurrent, assembleInitiative: bindInitiativeAssembly(captured.assembleInitiative, isCurrent) });
}

function tidyOperationRuntime(input: {
  db: Database; scope: ReturnType<typeof createSelectedSubsystem>; alive: () => void;
}): MemoryTidyRuntime {
  input.alive();
  const authorityEpochId = readMemoryAuthoritySelection(input.db).epochId;
  return { authorityEpochId, runNow: (characterId, options) => {
    input.alive();
    if (readMemoryAuthoritySelection(input.db).epochId !== authorityEpochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return input.scope.canonical ? input.scope.canonical.tidy.runNow(characterId, options) : input.scope.current().tidy.runNow(characterId, options);
  } };
}

function createSelectedSubsystem(input: MemoryRuntimeInput, utility: UtilitySlot, options: { tidyDispatch: TidyDispatch; policy?: MemoryRuntimePolicy }) {
  const { tidyDispatch, policy } = options;
  const fence = createMemoryAuthorityFence(); let activated = false;
  const projections = policy ? createSearchProjectionPolicyRepo(input.db) : undefined;
  const binding = (identity: SearchProjectionIdentity) => projections ? {
    appliedStoplist: projections.appliedStoplist(identity), commit: (stoplist: boolean) => projections.write(identity, stoplist),
  } : undefined;
  const { config, common } = memoryPolicyPorts(input, policy);
  let canonical: LocalSubsystem | undefined;
  let hindsight: HindsightSubsystem | undefined;
  const selected = selectMemoryRuntime({ db: input.db,
    createLegacy: () => {
      const legacy = createMemorySubsystem({ ...input, ...common, config: config(), utility,
        searchPolicy: binding({ table: "memory_fts", epochId: null }), authorityFence: fence, isCanonical: () => activated,
        requestTidyRun: async (characterId) => {
          if (tidyDispatch.requestRun) await tidyDispatch.requestRun(characterId);
          else await legacy.tidy.runNow(characterId);
        } });
      return legacy;
    },
    createCanonical: (epochId) => {
      canonical = createCanonicalLocalSubsystem({ ...input, ...common, epochId, utility, config: config(),
        searchPolicy: binding({ table: "canonical_memory_fts", epochId }),
        requestRun: async (characterId) => {
          if (tidyDispatch.requestRun) await tidyDispatch.requestRun(characterId);
          else if (canonical) await canonical.tidy.runNow(characterId);
          else throw new Error("MEMORY_PROVIDER_UNAVAILABLE");
        } });
      return canonical.engine;
    },
    createHindsight: input.hindsight ? (epochId) => {
      hindsight = createHindsightMemorySubsystem({ ...input, ...input.hindsight!, epochId, utility,
        config: captureMemoryConfig(input), captureConfig: () => captureMemoryConfig(input) });
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

function memoryPolicyPorts(input: MemoryRuntimeInput, policy?: MemoryRuntimePolicy) {
  return { config: () => policy?.construction() ?? captureMemoryConfig(input), common: {
    captureConfig: () => policy ? captureLocalTidyConfig(input, policy) : captureMemoryConfig(input),
    captureAssemblyConfig: () => policy?.capture("assembly") ?? captureMemoryConfig(input),
    captureRetentionDays: () => (policy?.capture("retention") ?? captureMemoryConfig(input)).intentionsDefaultDays,
    retentionEnabled: () => policy?.available("retention") ?? true,
  } };
}

function captureLocalTidyConfig(input: MemoryRuntimeInput, policy: MemoryRuntimePolicy) {
  policy.capture("retention");
  const config = policy.capture("tidy");
  const slot = input.utilityContextSlot?.() ?? (loadUtilityConfig(input.env) ? "utility" : "main");
  const key = slot === "utility" ? "TAKI_UTILITY_CONTEXT_TOKENS" : "TAKI_PROVIDER_CONTEXT_TOKENS";
  const window = loadContextConfig({ [key]: input.env[key] }).contextTokens[slot];
  return { ...config, tidyInputTokens: Math.min(config.tidyInputTokens, Math.floor(window / 2)) };
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
    operations: createCompactionOperationRepo(input.db, { onSummaryCommitted: input.onSummaryCommitted, onChanged: input.onMaintenanceChanged }),
    legacyFlush: () => scope.selected.canonical ? undefined : scope.current().memoryFlush, slot: utility,
    config: { ...input.compact, summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 },
    captureConfig: () => ({ ...(input.configuration ? loadContextConfig({
      TAKI_COMPACT_TRIGGER_RATIO: input.env.TAKI_COMPACT_TRIGGER_RATIO,
      TAKI_COMPACT_KEEP_MESSAGES: input.env.TAKI_COMPACT_KEEP_MESSAGES,
    }).compact : input.compact),
      summaryQuality: true, retryBudget: 3, retryCooldownMs: 30_000 }),
    protectedContent: () => [MEMORY_VOICE_RULE],
    logger: input.logger.child({ mod: "compaction" }),
  });
  const autoMemory = createMaintenanceAutoMemory({ maintenance: () => scope.current().maintenance, compact,
    legacyMaintenanceBeforeCompact: () => !scope.selected.canonical,
    logger: input.logger.child({ mod: "memory-auto" }) });
  return { autoMemory, compact };
}

function captureMemoryConfig(input: MemoryRuntimeInput) {
  const env = input.env;
  const config = loadMemoryConfig(env);
  const windows = loadContextConfig(env).contextTokens;
  const slot = input.utilityContextSlot?.() ?? (loadUtilityConfig(env) ? "utility" : "main");
  const window = windows[slot];
  // Reserve half the selected window for tool results and generated output.
  return { ...config, tidyInputTokens: Math.min(config.tidyInputTokens, Math.floor(window / 2)) };
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
    assembleInitiative: initiative?.assemble, isCurrent: initiative?.isCurrent,
    assemble });
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
