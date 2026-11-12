/**
 * INPUT: selected memory bindings, application configuration and the existing policy/search/maintenance owners
 * OUTPUT: live consumer-specific application, held-Run identity fencing and durable Tidy/index accessors
 * POS: core/memory — configuration adapter; never replaces Hindsight connection, custody or transition authority
 */
import { loadContextConfig } from "../config/context-config.ts";
import type { MemoryRuntimePolicy } from "../config/memory-runtime-policy.ts";
import { loadUtilityConfig } from "../config/utility-config.ts";
import { ServerConfigSchema } from "../config/server-config.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { bindInitiativeAssembly } from "./initiative-memory-assembly.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import { readCurrentMemoryAuthorityIdentity } from "./legacy-migration/legacy-activation-repo.ts";
import { sameMemoryAuthorityIdentity } from "./runtime-authority-verification.ts";
import { createMemorySearchApplication } from "./memory-search-application.ts";
import type { MemoryRuntimeInput, MemoryRuntimeScope } from "./runtime-composition.ts";
import type { MemoryTidyRuntime } from "./operations/memory-operation-contract.ts";

export interface TidyDispatch { requestRun?: (characterId: string) => Promise<void> }

export function memoryPolicyPorts(input: MemoryRuntimeInput, policy: MemoryRuntimePolicy) {
  return { config: () => policy.construction(), common: {
    captureConfig: () => captureLocalTidyConfig(input, policy),
    captureAssemblyConfig: () => policy.capture("assembly"),
    captureRetentionDays: () => policy.capture("retention").intentionsDefaultDays,
    retentionEnabled: () => policy.available("retention"),
  } };
}

export function captureMemoryConfig(input: MemoryRuntimeInput) {
  const config = loadMemoryConfig(input.env);
  const windows = loadContextConfig(input.env).contextTokens;
  const slot = input.utilityContextSlot?.() ?? (loadUtilityConfig(input.env) ? "utility" : "main");
  return { ...config, tidyInputTokens: Math.min(config.tidyInputTokens, Math.floor(windows[slot] / 2)) };
}

function captureLocalTidyConfig(input: MemoryRuntimeInput, policy: MemoryRuntimePolicy) {
  policy.capture("retention");
  const config = policy.capture("tidy");
  const slot = input.utilityContextSlot?.() ?? (loadUtilityConfig(input.env) ? "utility" : "main");
  const key = slot === "utility" ? "TAKI_UTILITY_CONTEXT_TOKENS" : "TAKI_PROVIDER_CONTEXT_TOKENS";
  const window = loadContextConfig({ [key]: input.env[key] }).contextTokens[slot];
  return { ...config, tidyInputTokens: Math.min(config.tidyInputTokens, Math.floor(window / 2)) };
}

export function createMemoryRuntimeConfiguration(options: {
  input: MemoryRuntimeInput; scope: MemoryRuntimeScope; policy: MemoryRuntimePolicy; alive(): void;
  setPromptDir(value: string): void;
}) {
  const { input, scope, policy, alive } = options;
  const local = () => readCurrentMemoryAuthorityIdentity(input.db).mode !== "hindsight";
  let search: ReturnType<typeof createMemorySearchApplication> | undefined;
  let submitIndex: ((stoplist: boolean) => Promise<void>) | undefined;
  const localSearch = () => {
    if (!local() || (scope.selected.canonical && !scope.local.current())) return undefined;
    if (!search) {
      search = createMemorySearchApplication({ memory: scope.selected.memory, policy,
        environment: () => input.configuration?.env() ?? input.env, application: input.application,
        onReady: () => { const current = scope.current(); if ("resumeRetention" in current) current.resumeRetention?.(); },
        epochId: () => readCurrentMemoryAuthorityIdentity(input.db).epochId });
      search.installSubmit(submitIndex);
    }
    return search;
  };
  localSearch();
  return {
    reconfigure: createMemoryReconfiguration({ ...options, localSearch }),
    searchIndex: () => localSearch()?.current() ?? null,
    installIndexSubmit: (submit: (stoplist: boolean) => Promise<void>) => { submitIndex = submit; localSearch()?.installSubmit(submit); },
    start: () => localSearch()?.start(), stop: () => search?.stop() ?? Promise.resolve(),
    prepareLocal: async () => {
      alive(); const admitted = readCurrentMemoryAuthorityIdentity(input.db);
      const application = localSearch();
      if (admitted.mode !== "canonical-local" || !application) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
      await application.ensureReady();
      alive();
      if (!sameMemoryAuthorityIdentity(admitted, readCurrentMemoryAuthorityIdentity(input.db))) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    },
    captureRun: (characterId: string, signal: AbortSignal | undefined, capture: () => Promise<CapturedMemoryRun>) =>
      captureConfiguredRun({ input, scope, policy, alive, localSearch, signal }, capture),
    tidyOperations: (): MemoryTidyRuntime => {
      alive(); const authorityEpochId = readCurrentMemoryAuthorityIdentity(input.db).epochId;
      return { authorityEpochId, runNow: (characterId, options) => {
        alive();
        if (readCurrentMemoryAuthorityIdentity(input.db).epochId !== authorityEpochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
        const selected = scope.local.current() ?? scope.hindsight ?? scope.current();
        return selected.tidy.runNow(characterId, options);
      } };
    },
  };
}

/** Prepare local policy before capture, then retain the exact selected identity across later configuration changes. */
async function captureConfiguredRun(options: {
  input: MemoryRuntimeInput; scope: MemoryRuntimeScope; policy: MemoryRuntimePolicy; alive(): void; signal?: AbortSignal;
  localSearch(): ReturnType<typeof createMemorySearchApplication> | undefined;
}, capture: () => Promise<CapturedMemoryRun>) {
  const { input, scope, policy, alive, localSearch, signal } = options;
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      await localSearch()?.ensureReady();
      alive(); if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (!scope.selected.canonical) policy.capture("ranking");
      const captured = await capture();
      const selection = readCurrentMemoryAuthorityIdentity(input.db);
      if (captured.isCurrent?.() === false) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      const isCurrent = () => {
        try {
          alive(); const current = readCurrentMemoryAuthorityIdentity(input.db);
          return current.mode === selection.mode && current.epochId === selection.epochId && captured.isCurrent?.() !== false;
        } catch { return false; }
      };
      return Object.freeze({ ...captured, isCurrent, assembleInitiative: bindInitiativeAssembly(captured.assembleInitiative, isCurrent) });
}

function createMemoryReconfiguration(options: {
  input: MemoryRuntimeInput; scope: MemoryRuntimeScope; policy: MemoryRuntimePolicy; setPromptDir(value: string): void;
  localSearch(): ReturnType<typeof createMemorySearchApplication> | undefined;
}) {
  const { input, scope, policy } = options;
  return async (key?: string) => {
    const next = { ...(input.configuration?.env() ?? input.env) };
    if (key === "TAKI_PROMPT_DIR") options.setPromptDir(ServerConfigSchema.shape.promptDir.parse(next.TAKI_PROMPT_DIR));
    if (key && readCurrentMemoryAuthorityIdentity(input.db).mode !== "hindsight") {
      const group = policy.groupFor(key);
      if (group === "search") await options.localSearch()?.apply();
      else if (group) {
        const prepared = policy.prepare(group, next);
        if (group === "ranking" && !scope.selected.canonical) scope.selected.memory.reconfigureRanking?.(prepared.parsed.bm25Weights);
        policy.commit(prepared);
        input.application?.mark(policy.keys(group), group === "ranking" && scope.selected.canonical ? "inapplicable" : "applied");
      }
    } else if (key === "TAKI_MEMORY_STOPLIST" || key === "TAKI_MEMORY_BM25_WEIGHTS" || key === "TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS") {
      input.application?.mark([key], key === "TAKI_MEMORY_BM25_WEIGHTS" ? "inapplicable" : "restart-required",
        "The selected Hindsight runtime retains its admitted policy; replacement belongs to its dedicated owner.");
    }
    const latest = { ...(input.configuration?.env() ?? next) };
    for (const key of Object.keys(input.env)) delete input.env[key];
    Object.assign(input.env, latest);
  };
}
