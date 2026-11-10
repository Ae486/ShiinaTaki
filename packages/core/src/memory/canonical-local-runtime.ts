/**
 * INPUT:  canonical Local repositories, active epoch and memory policy configuration
 * OUTPUT: Local engine surfaces and admission-bound tools/recall/primary and selected initiative prompt capture
 * POS:    core/memory — canonical Local composition; no Markdown store or direct replica mutation
 */
import type { ToolSet } from "ai";
import type { Database } from "../db/sqlite.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../agents/chat-agent.ts";
import { forwardRenderedContextText } from "../agents/context-attribution.ts";
import { loadMemoryConfig, type MemoryConfig } from "../config/memory-config.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createStructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "./canonical-tools/canonical-memory-tools.ts";
import { createCanonicalLocalRetention } from "./canonical-local-retention.ts";
import { createCanonicalLocalTidyView } from "./canonical-local-tidy.ts";
import { ensureCanonicalLocalBanks } from "./canonical-local-banks.ts";
import { captureCanonicalMemoryAssembly } from "./canonical-memory-assembly.ts";
import { createCanonicalMemoryRun } from "./canonical-memory-run.ts";
import { createLocalRecallEvidence, createRecallEvidenceRegistry } from "./memory-recall-evidence.ts";
import { captureInitiativeMemoryAssembly, captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";
import { canonicalMemoryRow } from "./canonical-memory-view.ts";
import { writeCanonicalObservedMemory } from "./canonical-observed-write.ts";
import { createLocalMemoryProvider, LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import type { MemoryEngine, SearchPolicyBinding } from "./memory-engine.ts";
import { createPersonaProvider, createFallbackPersonaProvider } from "./persona-provider.ts";
import { createLiveSearchTokenizer } from "./live-search-tokenizer.ts";
import { canonicalSearchProjection } from "./canonical-search-projection.ts";
import { rebuildSearchProjection } from "./search-projection-rebuild.ts";

interface RuntimeInput { db: Database; epochId: string; promptDir?: string; config?: MemoryConfig;
  currentPromptDir?: () => string; captureConfig?: () => MemoryConfig; captureAssemblyConfig?: () => MemoryConfig;
  captureRetentionDays?: () => number;
  searchPolicy?: SearchPolicyBinding; }
export type CanonicalLocalRuntime = ReturnType<typeof createCanonicalLocalRuntime>;
type LocalState = ReturnType<typeof createLocalState>;

export function createCanonicalLocalRuntime(input: RuntimeInput) {
  const state = createLocalState(input);
  const assemble: MemoryEngine["assemble"] = ({ characterId, currentMessage }) => {
    const render = captureAssembly(state, characterId);
    return forwardRenderedContextText(assemble, render, render(currentMessage));
  };
  const { authority, provider, records, maintenanceStore, blocks, tokenizer, config } = state;
  const banks = (characterId: string) => ensureCanonicalLocalBanks({ authority, epochId: input.epochId, characterId });
  const router = (characterId: string) => {
    const scope = banks(characterId);
    return { globalBankId: () => scope.global.bankId, characterBankId: () => scope.character.bankId, characterId: () => characterId };
  };
  const retention = createCanonicalLocalRetention({ repo: maintenanceStore, authority, epochId: input.epochId,
    intentionsDefaultDays: input.captureRetentionDays ?? config.intentionsDefaultDays });
  const tidy = createCanonicalLocalTidyView({ repo: maintenanceStore, records, authority, blocks, tokenizer, epochId: input.epochId });
  const engine: MemoryEngine = {
    searchStatus: () => ({ ready: state.search.ready(), stoplist: state.search.appliedStoplist() }),
    reconfigureSearch: (next, signal) => state.search.reconfigure(next.stoplist, (candidate, publish) => rebuildSearchProjection({
      db: input.db, source: canonicalSearchProjection(input.db, input.epochId), tokenizer: candidate,
      assertCurrent: () => { authority.activeEpoch(input.epochId); }, publish, signal,
      commitPolicy: () => input.searchPolicy?.commit(next.stoplist),
    })),
    reconcile: () => ({ upserted: 0, deleted: 0, total: maintenanceStore.listRetention({ epochId: input.epochId }).length, invalid: [] }),
    assemble,
    createTools: (characterId): ToolSet => {
      return createCanonicalMemoryToolsWithCapabilities({ ...captureLocalPolicy(state),
        authority: authority.activeEpoch(input.epochId), router: router(characterId) }, LOCAL_MEMORY_CAPABILITIES);
    },
    createBackgroundTools: (characterId) => { banks(characterId); return tidy.createTools(characterId); },
    writeEntry: (request) => {
      assertSearch(state);
      return writeCanonicalObservedMemory({ provider, epochId: input.epochId, banks,
        intentionsDefaultDays: input.captureRetentionDays?.() ?? config.intentionsDefaultDays }, request);
    },
    retention: retention.ops,
    tidy,
  };
  return { ...engine, provider, authority, maintenanceStore, banks, retentionSweep: retention.sweep,
    captureRun: (characterId: string) => {
      const policy = captureLocalPolicy(state);
      const capturedRouter = router(characterId);
      const initiative = captureTrackedInitiativeAssembly(() => captureInitiativeAssembly(state, characterId));
      return createCanonicalMemoryRun({ ...policy, router: capturedRouter, captureRecallEvidence: state.recallEvidence.read,
        assemble: captureAssembly(state, characterId), assembleInitiative: initiative.assemble, initiativeCurrent: initiative.isCurrent,
        prompt: CANONICAL_MEMORY_SYSTEM_PROMPT });
    } };
}

function captureLocalPolicy(state: LocalState) {
  assertSearch(state);
  const intentionsDefaultDays = state.captureRetentionDays?.() ?? state.config.intentionsDefaultDays;
  const provider = state.provider.captureRetention(intentionsDefaultDays);
  return { intentionsDefaultDays, coordinator: createMemoryCoordinator({ authority: state.authority, providers: new Map([["local", provider]]) }) };
}

function captureInitiativeAssembly(state: LocalState, characterId: string) {
  const banks = state.authority.listBanks(state.epochId);
  const global = banks.find((bank) => bank.scope.kind === "global");
  const character = banks.find((bank) => bank.scope.kind === "character" && bank.scope.characterId === characterId);
  return captureInitiativeMemoryAssembly({ characterId, persona: state.persona,
    global: global ? { reference: global.bankId, content: state.blocks.render([{ kind: "global", characterId: null }]) } : undefined,
    character: character ? { reference: character.bankId, content: state.blocks.render([{ kind: "character", characterId }]) } : undefined });
}

function createLocalState(input: RuntimeInput) {
  const authority = createCanonicalMemoryAuthorityRepo(input.db);
  authority.activeEpoch(input.epochId);
  const config = input.config ?? loadMemoryConfig({});
  const persona = input.promptDir || input.currentPromptDir
    ? createPersonaProvider({ promptDir: input.currentPromptDir ?? input.promptDir! }) : createFallbackPersonaProvider();
  const search = createLiveSearchTokenizer(input.searchPolicy ? input.searchPolicy.appliedStoplist : config.stoplist);
  const { tokenizer } = search;
  const records = createCanonicalMemoryRepo(input.db);
  const maintenanceStore = createCanonicalMemoryMaintenanceRepo(input.db, tokenizer);
  const blocks = createStructuredMemoryBlockRepo(input.db);
  const recallEvidence = createRecallEvidenceRegistry(createLocalRecallEvidence(input.db));
  const provider = createLocalMemoryProvider({ authority, records, sparse: createCanonicalMemorySparseRepo(input.db), tokenizer,
    maintenance: maintenanceStore, intentionsDefaultDays: config.intentionsDefaultDays, observeRecallEvidence: recallEvidence.observe });
  return { ...input, authority, config, persona, search, tokenizer, records, maintenanceStore, blocks, provider, recallEvidence };
}

function captureAssembly(state: LocalState, characterId: string) {
  const scope = ensureCanonicalLocalBanks({ authority: state.authority, epochId: state.epochId, characterId });
  const rows = state.maintenanceStore.list({ epochId: state.epochId, characterId }).map((record) =>
    canonicalMemoryRow(record, record.unit.bankId === scope.global.bankId ? null : characterId));
  return captureCanonicalMemoryAssembly({ characterId, rows, persona: state.persona,
    pinnedBudget: ((state.captureAssemblyConfig ?? state.captureConfig)?.() ?? state.config).pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]) });
}

function assertSearch(state: LocalState): void {
  if (!state.search.ready()) throw new Error("MEMORY_SEARCH_INDEX_UNAVAILABLE");
}
