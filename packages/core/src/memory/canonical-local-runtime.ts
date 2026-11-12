/**
 * INPUT:  canonical Local repositories, active epoch, bound identity and memory policy configuration
 * OUTPUT: Local engine surfaces and admission-bound canonical tools/recall/prompt capture
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
import { createCanonicalLocalProvider } from "./canonical-local-provider.ts";
import { createCanonicalLocalTidyView } from "./canonical-local-tidy.ts";
import { ensureCanonicalLocalBanks } from "./canonical-local-banks.ts";
import { captureCanonicalMemoryAssembly } from "./canonical-memory-assembly.ts";
import { createCanonicalMemoryRun } from "./canonical-memory-run.ts";
import { canonicalMemoryRow } from "./canonical-memory-view.ts";
import { writeCanonicalObservedMemory } from "./canonical-observed-write.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import type { MemoryEngine, SearchPolicyBinding } from "./memory-engine.ts";
import { createPersonaProvider, createFallbackPersonaProvider } from "./persona-provider.ts";
import { createLocalRecallEvidence, createRecallEvidenceRegistry } from "./memory-recall-evidence.ts";
import { captureInitiativeMemoryAssembly, captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";
import { createLiveSearchTokenizer } from "./live-search-tokenizer.ts";
import { canonicalSearchProjection } from "./canonical-search-projection.ts";
import { rebuildSearchProjection } from "./search-projection-rebuild.ts";
import { transitionQueuedProvider } from "./transitions/transition-queued-provider.ts";
import type { CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { createUnavailableMemoryRun } from "./hindsight/hindsight-unavailable-run.ts";
import { readCurrentMemoryAuthorityIdentity, type MemoryAuthorityIdentity } from "./legacy-migration/legacy-activation-repo.ts";
import { sameMemoryAuthorityIdentity } from "./runtime-authority-verification.ts";

interface RuntimeInput { db: Database; epochId: string; promptDir?: string; config?: MemoryConfig; writeFence?: CanonicalLocalWriteFence;
  currentPromptDir?: () => string; captureConfig?: () => MemoryConfig; captureAssemblyConfig?: () => MemoryConfig;
  captureRetentionDays?: () => number; searchPolicy?: SearchPolicyBinding;
  boundIdentity?(): MemoryAuthorityIdentity | undefined }
export type CanonicalLocalRuntime = ReturnType<typeof createCanonicalLocalRuntime>;
type LocalState = ReturnType<typeof createLocalState>;

export function createCanonicalLocalRuntime(input: RuntimeInput) {
  const state = createLocalState(input);
  const { authority, provider, records, maintenanceStore, blocks, tokenizer, config } = state;
  const banks = (characterId: string) => ensureCanonicalLocalBanks({ authority, epochId: input.epochId, characterId, writeFence: input.writeFence });
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
      assertCurrent: state.assertCurrentAuthority, publish, signal, commitPolicy: () => input.searchPolicy?.commit(next.stoplist),
    })),
    reconcile: () => { state.assertCurrentAuthority(); return { upserted: 0, deleted: 0,
      total: maintenanceStore.listRetention({ epochId: input.epochId }).length, invalid: [] }; },
    assemble: ({ characterId, currentMessage }) => {
      const render = captureAssembly(state, characterId);
      return forwardRenderedContextText(engine.assemble, render, render(currentMessage));
    },
    createTools: (characterId): ToolSet => createCanonicalMemoryToolsWithCapabilities({ ...captureLocalPolicy(state),
      authority: authority.activeEpoch(input.epochId), router: router(characterId) }, LOCAL_MEMORY_CAPABILITIES),
    createBackgroundTools: (characterId) => { banks(characterId); return tidy.createTools(characterId); },
    writeEntry: (request) => { assertSearch(state); return writeCanonicalObservedMemory({ provider, epochId: input.epochId, banks,
      intentionsDefaultDays: input.captureRetentionDays?.() ?? config.intentionsDefaultDays }, request); },
    retention: {
      listActive: (layer) => { state.assertCurrentAuthority(); return retention.ops.listActive(layer); },
      archive: (ref) => { state.assertCurrentAuthority(); return retention.ops.archive(ref); },
      hardDelete: (ref) => { state.assertCurrentAuthority(); return retention.ops.hardDelete(ref); },
    },
    tidy: { ...tidy, readBlock: (ref) => { state.assertCurrentAuthority(); return tidy.readBlock(ref); } },
  };
  return { ...engine, provider, authority, maintenanceStore, banks, retentionSweep: retention.sweep,
    unavailableRun: (characterId: string) => createUnavailableMemoryRun({ providerId: "local",
      epoch: authority.activeEpoch(input.epochId), characterId, persona: state.persona }),
    captureRun: (characterId: string) => {
      const policy = captureLocalPolicy(state);
      const initiative = captureTrackedInitiativeAssembly(() => captureInitiativeAssembly(state, characterId));
      return createCanonicalMemoryRun({ ...policy, router: router(characterId), captureRecallEvidence: state.recallEvidence.read,
        assemble: captureAssembly(state, characterId), assembleInitiative: initiative.assemble, initiativeCurrent: initiative.isCurrent,
        prompt: CANONICAL_MEMORY_SYSTEM_PROMPT });
    } };
}

function createLocalState(input: RuntimeInput) {
  const { authority, assertCurrentAuthority } = currentLocalAuthority(input);
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
  const provider = createCanonicalLocalProvider({ deps: { authority, records, sparse: createCanonicalMemorySparseRepo(input.db), tokenizer,
    maintenance: maintenanceStore, intentionsDefaultDays: config.intentionsDefaultDays,
    observeRecallEvidence: recallEvidence.observe }, assertCurrentAuthority, writeFence: input.writeFence });
  const coordinator = createMemoryCoordinator({ authority, providers: new Map([["local", transitionQueuedProvider(input.db, provider, assertCurrentAuthority)]]) });
  return { ...input, authority, config, persona, search, tokenizer, records, maintenanceStore, blocks, provider, coordinator,
    recallEvidence, assertCurrentAuthority };
}

function currentLocalAuthority(input: RuntimeInput) {
  const raw = createCanonicalMemoryAuthorityRepo(input.db);
  const assertCurrentAuthority = () => {
    input.writeFence?.assertAlive();
    const bound = input.boundIdentity?.();
    // Only an alive unpublished draft may lack the existing owner's identity. Standalone preparation has no owner port.
    if (!bound) {
      if (input.boundIdentity && !input.writeFence) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      return;
    }
    if (!sameMemoryAuthorityIdentity(bound, readCurrentMemoryAuthorityIdentity(input.db))) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  };
  const authority = { ...raw,
    authorityEpoch: (expected?: string) => { assertCurrentAuthority(); return raw.authorityEpoch(expected); },
    activeEpoch: (expected?: string) => { assertCurrentAuthority(); return raw.activeEpoch(expected); },
  };
  return { authority, assertCurrentAuthority };
}

function captureAssembly(state: LocalState, characterId: string) {
  const scope = ensureCanonicalLocalBanks({ authority: state.authority, epochId: state.epochId, characterId, writeFence: state.writeFence });
  const rows = state.maintenanceStore.list({ epochId: state.epochId, characterId }).map((record) =>
    canonicalMemoryRow(record, record.unit.bankId === scope.global.bankId ? null : characterId));
  const assemble = captureCanonicalMemoryAssembly({ characterId, rows, persona: state.persona,
    pinnedBudget: ((state.captureAssemblyConfig ?? state.captureConfig)?.() ?? state.config).pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]) });
  const render = (currentMessage: string) => {
    state.assertCurrentAuthority(); return forwardRenderedContextText(render, assemble, assemble(currentMessage));
  };
  return render;
}

function captureLocalPolicy(state: LocalState) {
  assertSearch(state);
  const intentionsDefaultDays = state.captureRetentionDays?.() ?? state.config.intentionsDefaultDays;
  const provider = state.provider.captureRetention(intentionsDefaultDays);
  return { intentionsDefaultDays, coordinator: createMemoryCoordinator({ authority: state.authority,
    providers: new Map([["local", transitionQueuedProvider(state.db, provider, state.assertCurrentAuthority)]]) }) };
}

function captureInitiativeAssembly(state: LocalState, characterId: string) {
  state.assertCurrentAuthority();
  const banks = state.authority.listBanks(state.epochId);
  const global = banks.find((bank) => bank.scope.kind === "global");
  const character = banks.find((bank) => bank.scope.kind === "character" && bank.scope.characterId === characterId);
  return captureInitiativeMemoryAssembly({ characterId, persona: state.persona,
    global: global ? { reference: global.bankId, content: state.blocks.render([{ kind: "global", characterId: null }]) } : undefined,
    character: character ? { reference: character.bankId, content: state.blocks.render([{ kind: "character", characterId }]) } : undefined });
}

function assertSearch(state: LocalState): void {
  state.assertCurrentAuthority();
  if (!state.search.ready()) throw new Error("MEMORY_SEARCH_INDEX_UNAVAILABLE");
}
