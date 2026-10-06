/**
 * INPUT:  the real Hindsight provider/recovery state and Core-owned persona/Block projection
 * OUTPUT: immutable canonical Runs, bounded admission sync, policy-bearing reads and truthful unavailable captures
 * POS:    core/memory/hindsight — whole-capture transition ownership, permanently retired references and typed write custody;
 *         Core receives per-Bank sync failures and a reconnect signal only after complete capture synchronization
 */
import type { MemoryEngine } from "../memory-engine.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../../agents/chat-agent.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "../canonical-tools/canonical-memory-tools.ts";
import { captureCanonicalMemoryAssembly } from "../canonical-memory-assembly.ts";
import { createCanonicalMemoryRun, type CapturedMemoryRun } from "../canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import { createFallbackPersonaProvider, createPersonaProvider } from "../persona-provider.ts";
import { captureHindsightRuntimeRows, createHindsightRuntimeTidyView } from "./hindsight-runtime-view.ts";
import { synchronizeHindsightCapture, type HindsightCaptureSyncEvent } from "./hindsight-capture-sync.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { createHindsightRuntimeConsumers } from "./hindsight-runtime-consumers.ts";
import { createHindsightUnavailableRun, type HindsightUnavailableRunReason } from "./hindsight-unavailable-run.ts";

export interface HindsightUnavailableRunEvent { characterId: string; reason: HindsightUnavailableRunReason }

export function createHindsightMemoryRuntime(input: {
  state: HindsightRuntimeState; promptDir?: string; onUnavailable?: (event: HindsightUnavailableRunEvent) => void; onSynced?: () => void;
  onSync?: (event: HindsightCaptureSyncEvent) => void; admissionBudgetMs: () => number;
}) {
  const { state } = input;
  const consumers = createHindsightRuntimeConsumers(state.workFence);
  const persona = input.promptDir ? createPersonaProvider({ promptDir: input.promptDir }) : createFallbackPersonaProvider();
  const capabilities = () => {
    const value = state.provider.capabilitiesSnapshot();
    if (!value) throw new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE"); return value;
  };
  const assemble = (characterId: string) => captureCanonicalMemoryAssembly({ characterId, persona,
    rows: captureHindsightRuntimeRows(state, { characterId, intentions: true }), pinnedBudget: state.config.pinnedBudget,
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
    assemble: ({ characterId, currentMessage }) => assemble(characterId)(currentMessage),
    createTools: (characterId) => consumers.wrapTools(createCanonicalMemoryToolsWithCapabilities({ coordinator: state.coordinator,
      authority: state.runtime.authority.authorityEpoch(state.runtime.epoch.epochId), router: bankRouter(state, characterId) }, capabilities())),
    createBackgroundTools: unsupported, writeEntry: unsupported,
    retention: { listActive: unsupported, archive: unsupported, hardDelete: unsupported }, tidy,
  };
  return { engine, tidy, stop: consumers.stop, snapshot: () => createMemoryRunReference({ providerId: "hindsight",
    providerLineageId: state.runtime.epoch.providerLineageId, authorityEpochId: state.runtime.epoch.epochId,
    contractVersion: 1, capabilities: capabilities() }),
    unavailableRun,
    captureRun: (characterId: string, signal?: AbortSignal) => consumers.capture(async () => {
      const banks = state.runtime.routedBanks(characterId);
      if (!banks) return unavailableRun(characterId, "bank_not_ready");
      const synced = await synchronizeHindsightCapture(state, { characterId, banks, signal,
        budgetMs: input.admissionBudgetMs(), onEvent: input.onSync });
      if (synced !== "synced" && synced !== "partial") return unavailableRun(characterId, synced);
      if (synced === "synced") input.onSynced?.();
      // Both routes and the prompt projection are captured before the coordinator
      // seals capabilities. Later background changes cannot rewrite a queued Run.
      const captured = await createCanonicalMemoryRun({ coordinator: state.coordinator, router: bankRouter(state, characterId),
        assemble: assemble(characterId), prompt: CANONICAL_MEMORY_SYSTEM_PROMPT });
      if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      return captured;
    }) };
}

function bankRouter(state: HindsightRuntimeState, characterId: string) {
  const [global, character] = state.runtime.resolveBanks(characterId);
  return { globalBankId: () => global.bankId, characterBankId: () => character.bankId, characterId: () => characterId };
}
