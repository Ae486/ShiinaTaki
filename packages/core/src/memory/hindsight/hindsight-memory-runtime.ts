/**
 * INPUT:  the real Hindsight provider/recovery state and Core-owned persona/Block projection
 * OUTPUT: canonical tools, immutable primary/selected-initiative capture and native policy-bearing recall
 * POS:    core/memory/hindsight — foreground engine adapter; legacy generic background/file mutation surfaces refuse explicitly
 */
import type { MemoryEngine } from "../memory-engine.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../../agents/chat-agent.ts";
import { forwardRenderedContextText } from "../../agents/context-attribution.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "../canonical-tools/canonical-memory-tools.ts";
import { captureCanonicalMemoryAssembly } from "../canonical-memory-assembly.ts";
import { createCanonicalMemoryRun, type CapturedMemoryRun } from "../canonical-memory-run.ts";
import type { MemoryToolBankRouter } from "../canonical-tools/canonical-memory-tools.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import { capturePersona, createFallbackPersonaProvider, createPersonaProvider } from "../persona-provider.ts";
import type { MemoryConfig } from "../../config/memory-config.ts";
import { captureHindsightRuntimeRows, createHindsightRuntimeTidyView } from "./hindsight-runtime-view.ts";
import { hindsightAvailabilityFailure } from "./hindsight-memory-provider-context.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { createHindsightRuntimeConsumers } from "./hindsight-runtime-consumers.ts";
import { bindInitiativeAssembly, captureInitiativeMemoryAssembly, captureTrackedInitiativeAssembly } from "../initiative-memory-assembly.ts";

export function createHindsightMemoryRuntime(input: { state: HindsightRuntimeState; promptDir?: string;
  currentPromptDir?: () => string; captureConfig?: () => MemoryConfig }) {
  const { state } = input;
  const consumers = createHindsightRuntimeConsumers();
  const persona = input.promptDir || input.currentPromptDir
    ? createPersonaProvider({ promptDir: input.currentPromptDir ?? input.promptDir! }) : createFallbackPersonaProvider();
  const capabilities = () => {
    const value = state.provider.capabilitiesSnapshot();
    if (!value) throw new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE"); return value;
  };
  const router = (characterId: string) => {
    const banks = state.runtime.resolveBanks(characterId);
    const global = banks.find((bank) => bank.scope === "global")!; const character = banks.find((bank) => bank.scope === "character")!;
    return { globalBankId: () => global.bankId, characterBankId: () => character.bankId, characterId: () => characterId };
  };
  const assemble = (characterId: string, selected = persona, config = input.captureConfig?.() ?? state.config) => captureCanonicalMemoryAssembly({ characterId, persona: selected,
    rows: captureHindsightRuntimeRows(state, { characterId, intentions: true }), pinnedBudget: config.pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]),
    now: state.now ? Date.parse(state.now()) : undefined });
  const unsupported = (): never => { throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); };
  const assemblePrompt = primaryAssembly(assemble);
  const tidy = createHindsightRuntimeTidyView(state);
  const engine: MemoryEngine = {
    reconcile: () => {
      state.runtime.assertConnection();
      const row = state.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_projections WHERE object_kind='memory_unit' AND operation='upsert'").get();
      return { upserted: 0, deleted: 0, total: Number(row?.n ?? 0), invalid: [] };
    },
    assemble: assemblePrompt,
    createTools: (characterId) => consumers.wrapTools(createCanonicalMemoryToolsWithCapabilities({ coordinator: state.coordinator,
      authority: state.runtime.authority.authorityEpoch(state.runtime.epoch.epochId), router: router(characterId) }, capabilities())),
    createBackgroundTools: unsupported, writeEntry: unsupported,
    retention: { listActive: unsupported, archive: unsupported, hardDelete: unsupported }, tidy,
  };
  return { engine, tidy, stop: consumers.stop, snapshot: () => createMemoryRunReference({ providerId: "hindsight",
    providerLineageId: state.runtime.epoch.providerLineageId, authorityEpochId: state.runtime.epoch.epochId,
    contractVersion: 1, capabilities: capabilities() }),
    captureRun: (characterId: string, signal?: AbortSignal) => consumers.capture(async () => {
      const selectedPersona = capturePersona(persona, characterId);
      const selectedConfig = { ...(input.captureConfig?.() ?? state.config) };
      await synchronizeForCapture(state, { characterId, signal });
      // Both routes and the prompt projection are captured before the coordinator
      // seals capabilities. Later background changes cannot rewrite a queued Run.
      const capturedRouter = router(characterId);
      const initiative = captureTrackedInitiativeAssembly(() => captureInitiativeMemoryAssembly({ characterId, persona: selectedPersona,
        global: { reference: capturedRouter.globalBankId(), content: state.blocks.render([{ kind: "global", characterId: null }]) },
        character: { reference: capturedRouter.characterBankId(), content: state.blocks.render([{ kind: "character", characterId }]) } }));
      const captured = await createCanonicalMemoryRun({ coordinator: state.coordinator, router: capturedRouter,
        captureRecallEvidence: state.recallEvidence.read,
        assemble: assemble(characterId, selectedPersona, selectedConfig), prompt: CANONICAL_MEMORY_SYSTEM_PROMPT,
        assembleInitiative: initiative.assemble, initiativeCurrent: initiative.isCurrent });
      if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      return withCurrentRuntimeBinding(captured, capturedRouter, () => router(characterId));
    }) };
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
      // Resolving the same captured routes also checks the original endpoint/credential fingerprint.
      // A held decision may compare current authority, but it must never adopt replacement Banks.
      const actual = current();
      return run.isCurrent?.() !== false && actual.globalBankId() === captured.globalBankId()
        && actual.characterBankId() === captured.characterBankId();
    } catch { return false; }
  };
  return Object.freeze({ ...run, isCurrent, assembleInitiative: bindInitiativeAssembly(run.assembleInitiative, isCurrent) });
}

async function synchronizeForCapture(state: HindsightRuntimeState, input: { characterId: string; signal?: AbortSignal }): Promise<void> {
  if (input.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  let unavailable: unknown;
  for (const bank of state.runtime.resolveBanks(input.characterId)) {
    try { await state.service.synchronize({ bankId: bank.bankId, mode: "foreground",
      context: { timeoutMs: state.runtime.connection.requestTimeoutMs, signal: input.signal } }); }
    catch (error) { if (!hindsightAvailabilityFailure(error)) throw error; unavailable = error; }
  }
  if (input.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  // A readable replica does not prove negotiated capabilities. Missing evidence
  // must not start an implicit coordinator admission without this caller's signal.
  if (!state.provider.capabilitiesSnapshot()) throw unavailable ?? new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE");
}
