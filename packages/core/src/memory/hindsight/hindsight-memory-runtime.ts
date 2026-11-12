/**
 * INPUT:  the real Hindsight provider/recovery state and Core-owned persona/Block projection
 * OUTPUT: immutable canonical Runs, bounded admission sync, policy-bearing reads and truthful unavailable captures
 * POS:    core/memory/hindsight — whole-capture transition ownership, permanently retired references and typed write custody;
 *         Core receives per-Bank sync failures and a reconnect signal only after complete capture synchronization
 */
import type { MemoryEngine } from "../memory-engine.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../../agents/chat-agent.ts";
import { forwardRenderedContextText } from "../../agents/context-attribution.ts";
import type { MemoryConfig } from "../../config/memory-config.ts";
import type { MemoryToolBankRouter } from "../canonical-tools/canonical-memory-tools.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "../canonical-tools/canonical-memory-tools.ts";
import { captureCanonicalMemoryAssembly } from "../canonical-memory-assembly.ts";
import { createCanonicalMemoryRun, type CapturedMemoryRun } from "../canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import { capturePersona, createFallbackPersonaProvider, createPersonaProvider, type PersonaProvider } from "../persona-provider.ts";
import { bindInitiativeAssembly, captureInitiativeMemoryAssembly, captureTrackedInitiativeAssembly } from "../initiative-memory-assembly.ts";
import { captureHindsightRuntimeRows, createHindsightRuntimeTidyView } from "./hindsight-runtime-view.ts";
import { synchronizeHindsightCapture, type HindsightCaptureSyncEvent } from "./hindsight-capture-sync.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { createHindsightRuntimeConsumers } from "./hindsight-runtime-consumers.ts";
import { createHindsightUnavailableRun, type HindsightUnavailableRunReason } from "./hindsight-unavailable-run.ts";

export interface HindsightUnavailableRunEvent { characterId: string; reason: HindsightUnavailableRunReason }

interface HindsightMemoryRuntimeInput {
  state: HindsightRuntimeState; promptDir?: string; onUnavailable?: (event: HindsightUnavailableRunEvent) => void; onSynced?: () => void;
  onSync?: (event: HindsightCaptureSyncEvent) => void; admissionBudgetMs: () => number;
  currentPromptDir?: () => string; captureConfig?: () => MemoryConfig;
}

export function createHindsightMemoryRuntime(input: HindsightMemoryRuntimeInput) {
  const { state } = input;
  const consumers = createHindsightRuntimeConsumers(state.workFence);
  const persona = input.promptDir || input.currentPromptDir
    ? createPersonaProvider({ promptDir: input.currentPromptDir ?? input.promptDir! }) : createFallbackPersonaProvider();
  const capabilities = () => {
    const value = state.provider.capabilitiesSnapshot();
    if (!value) throw new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE"); return value;
  };
  const assemble = (characterId: string, selected = persona, config = input.captureConfig?.() ?? state.config) => captureCanonicalMemoryAssembly({ characterId, persona: selected,
    rows: captureHindsightRuntimeRows(state, { characterId, intentions: true }), pinnedBudget: config.pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]),
    now: state.now ? Date.parse(state.now()) : undefined });
  const unsupported = (): never => { throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); };
  const tidy = createHindsightRuntimeTidyView(state);
  const unavailableRun = (characterId: string, reason: HindsightUnavailableRunReason): CapturedMemoryRun => {
    input.onUnavailable?.({ characterId, reason });
    return createHindsightUnavailableRun({ epoch: state.runtime.epoch, characterId, persona });
  };
  const engine: MemoryEngine = {
    reconcile: () => {
      state.runtime.assertConnection();
      const row = state.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_projections WHERE object_kind='memory_unit' AND operation='upsert'").get();
      return { upserted: 0, deleted: 0, total: Number(row?.n ?? 0), invalid: [] };
    },
    assemble: primaryAssembly(assemble),
    createTools: (characterId) => consumers.wrapTools(createCanonicalMemoryToolsWithCapabilities({ coordinator: state.coordinator,
      authority: state.runtime.authority.authorityEpoch(state.runtime.epoch.epochId), router: bankRouter(state, characterId) }, capabilities())),
    createBackgroundTools: unsupported, writeEntry: unsupported,
    retention: { listActive: unsupported, archive: unsupported, hardDelete: unsupported }, tidy,
  };
  return { engine, tidy, stop: consumers.stop, snapshot: () => createMemoryRunReference({ providerId: "hindsight",
    providerLineageId: state.runtime.epoch.providerLineageId, authorityEpochId: state.runtime.epoch.epochId,
    contractVersion: 1, capabilities: capabilities() }),
    unavailableRun,
    captureRun: (characterId: string, signal?: AbortSignal) => consumers.capture(() =>
      captureHindsightRun(input, { persona, assemble, unavailableRun }, { characterId, signal })) };
}

/** The consumer lifetime owns cancellation; this helper captures one immutable, synchronized projection. */
async function captureHindsightRun(input: HindsightMemoryRuntimeInput, projection: {
  persona: PersonaProvider;
  assemble(characterId: string, persona: PersonaProvider, config: MemoryConfig): ReturnType<typeof captureCanonicalMemoryAssembly>;
  unavailableRun(characterId: string, reason: HindsightUnavailableRunReason): CapturedMemoryRun;
}, request: { characterId: string; signal?: AbortSignal }): Promise<CapturedMemoryRun> {
  const { state } = input;
  const { persona, assemble, unavailableRun } = projection;
  const { characterId, signal } = request;
      const selectedPersona = capturePersona(persona, characterId);
      const selectedConfig = { ...(input.captureConfig?.() ?? state.config) };
      const banks = state.runtime.routedBanks(characterId);
      if (!banks) return unavailableRun(characterId, "bank_not_ready");
      const synced = await synchronizeHindsightCapture(state, { characterId, banks, signal,
        budgetMs: input.admissionBudgetMs(), onEvent: input.onSync });
      if (synced !== "synced" && synced !== "partial") return unavailableRun(characterId, synced);
      if (synced === "synced") input.onSynced?.();
      // Both routes and the prompt projection are captured before the coordinator
      // seals capabilities. Later background changes cannot rewrite a queued Run.
      const capturedRouter = bankRouter(state, characterId);
      const initiative = captureTrackedInitiativeAssembly(() => captureInitiativeMemoryAssembly({ characterId, persona: selectedPersona,
        global: { reference: capturedRouter.globalBankId(), content: state.blocks.render([{ kind: "global", characterId: null }]) },
        character: { reference: capturedRouter.characterBankId(), content: state.blocks.render([{ kind: "character", characterId }]) } }));
      const captured = await createCanonicalMemoryRun({ coordinator: state.coordinator, router: capturedRouter,
        captureRecallEvidence: state.recallEvidence.read,
        assemble: assemble(characterId, selectedPersona, selectedConfig), prompt: CANONICAL_MEMORY_SYSTEM_PROMPT,
        assembleInitiative: initiative.assemble, initiativeCurrent: initiative.isCurrent });
      if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      return withCurrentRuntimeBinding(captured, capturedRouter, () => bankRouter(state, characterId));
}

function primaryAssembly(capture: (characterId: string) => (currentMessage: string) => string): MemoryEngine["assemble"] {
  const assemble: MemoryEngine["assemble"] = ({ characterId, currentMessage }) => {
    const render = capture(characterId);
    return forwardRenderedContextText(assemble, render, render(currentMessage));
  };
  return assemble;
}

function withCurrentRuntimeBinding(run: CapturedMemoryRun, captured: MemoryToolBankRouter,
  current: () => MemoryToolBankRouter): CapturedMemoryRun {
  const isCurrent = () => {
    try {
      const actual = current();
      return run.isCurrent?.() !== false && actual.globalBankId() === captured.globalBankId()
        && actual.characterBankId() === captured.characterBankId();
    } catch { return false; }
  };
  return Object.freeze({ ...run, isCurrent, assembleInitiative: bindInitiativeAssembly(run.assembleInitiative, isCurrent) });
}

function bankRouter(state: HindsightRuntimeState, characterId: string) {
  const [global, character] = state.runtime.resolveBanks(characterId);
  return { globalBankId: () => global.bankId, characterBankId: () => character.bankId, characterId: () => characterId };
}
