/**
 * INPUT:  the real Hindsight provider/recovery state and Core-owned persona/Block projection
 * OUTPUT: canonical tools, immutable Run memory capture and actual native policy-bearing recall
 * POS:    core/memory/hindsight — foreground engine adapter; legacy generic background/file mutation surfaces refuse explicitly
 */
import type { MemoryEngine } from "../memory-engine.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../../agents/chat-agent.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "../canonical-tools/canonical-memory-tools.ts";
import { captureCanonicalMemoryAssembly } from "../canonical-memory-assembly.ts";
import { createCanonicalMemoryRun } from "../canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import { createFallbackPersonaProvider, createPersonaProvider } from "../persona-provider.ts";
import { captureHindsightRuntimeRows, createHindsightRuntimeTidyView } from "./hindsight-runtime-view.ts";
import { hindsightAvailabilityFailure } from "./hindsight-memory-provider-context.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { createHindsightRuntimeConsumers } from "./hindsight-runtime-consumers.ts";

export function createHindsightMemoryRuntime(input: { state: HindsightRuntimeState; promptDir?: string }) {
  const { state } = input;
  const consumers = createHindsightRuntimeConsumers();
  const persona = input.promptDir ? createPersonaProvider({ promptDir: input.promptDir }) : createFallbackPersonaProvider();
  const capabilities = () => {
    const value = state.provider.capabilitiesSnapshot();
    if (!value) throw new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE"); return value;
  };
  const router = (characterId: string) => {
    const banks = state.runtime.resolveBanks(characterId);
    const global = banks.find((bank) => bank.scope === "global")!; const character = banks.find((bank) => bank.scope === "character")!;
    return { globalBankId: () => global.bankId, characterBankId: () => character.bankId, characterId: () => characterId };
  };
  const assemble = (characterId: string) => captureCanonicalMemoryAssembly({ characterId, persona,
    rows: captureHindsightRuntimeRows(state, { characterId, intentions: true }), pinnedBudget: state.config.pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]),
    now: state.now ? Date.parse(state.now()) : undefined });
  const unsupported = (): never => { throw new Error("MEMORY_CAPABILITY_UNSUPPORTED"); };
  const tidy = createHindsightRuntimeTidyView(state);
  const engine: MemoryEngine = {
    reconcile: () => {
      state.runtime.assertConnection();
      const row = state.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_projections WHERE object_kind='memory_unit' AND operation='upsert'").get();
      return { upserted: 0, deleted: 0, total: Number(row?.n ?? 0), invalid: [] };
    },
    assemble: ({ characterId, currentMessage }) => assemble(characterId)(currentMessage),
    createTools: (characterId) => consumers.wrapTools(createCanonicalMemoryToolsWithCapabilities({ coordinator: state.coordinator,
      authority: state.runtime.authority.authorityEpoch(state.runtime.epoch.epochId), router: router(characterId) }, capabilities())),
    createBackgroundTools: unsupported, writeEntry: unsupported,
    retention: { listActive: unsupported, archive: unsupported, hardDelete: unsupported }, tidy,
  };
  return { engine, tidy, stop: consumers.stop, snapshot: () => createMemoryRunReference({ providerId: "hindsight",
    providerLineageId: state.runtime.epoch.providerLineageId, authorityEpochId: state.runtime.epoch.epochId,
    contractVersion: 1, capabilities: capabilities() }),
    captureRun: (characterId: string, signal?: AbortSignal) => consumers.capture(async () => {
      await synchronizeForCapture(state, { characterId, signal });
      // Both routes and the prompt projection are captured before the coordinator
      // seals capabilities. Later background changes cannot rewrite a queued Run.
      const captured = await createCanonicalMemoryRun({ coordinator: state.coordinator, router: router(characterId),
        assemble: assemble(characterId), prompt: CANONICAL_MEMORY_SYSTEM_PROMPT });
      if (signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
      return captured;
    }) };
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
