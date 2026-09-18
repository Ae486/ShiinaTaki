/**
 * INPUT:  canonical Local repositories, active epoch and memory policy configuration
 * OUTPUT: Local engine surfaces and admission-bound canonical tools/recall/prompt capture
 * POS:    core/memory — canonical Local composition; no Markdown store or direct replica mutation
 */
import type { ToolSet } from "ai";
import type { Database } from "../db/sqlite.ts";
import { CANONICAL_MEMORY_SYSTEM_PROMPT } from "../agents/chat-agent.ts";
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
import { canonicalMemoryRow } from "./canonical-memory-view.ts";
import { writeCanonicalObservedMemory } from "./canonical-observed-write.ts";
import { createLocalMemoryProvider, LOCAL_MEMORY_CAPABILITIES } from "./local-memory-provider.ts";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import { createPersonaProvider, createFallbackPersonaProvider } from "./persona-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";

interface RuntimeInput { db: Database; epochId: string; promptDir?: string; config?: MemoryConfig; }
export type CanonicalLocalRuntime = ReturnType<typeof createCanonicalLocalRuntime>;
type LocalState = ReturnType<typeof createLocalState>;

export function createCanonicalLocalRuntime(input: RuntimeInput) {
  const state = createLocalState(input);
  const { authority, provider, records, maintenanceStore, blocks, tokenizer, config, coordinator } = state;
  const banks = (characterId: string) => ensureCanonicalLocalBanks({ authority, epochId: input.epochId, characterId });
  const router = (characterId: string) => {
    const scope = banks(characterId);
    return { globalBankId: () => scope.global.bankId, characterBankId: () => scope.character.bankId, characterId: () => characterId };
  };
  const retention = createCanonicalLocalRetention({ repo: maintenanceStore, authority, epochId: input.epochId,
    intentionsDefaultDays: config.intentionsDefaultDays });
  const tidy = createCanonicalLocalTidyView({ repo: maintenanceStore, records, authority, blocks, tokenizer, epochId: input.epochId });
  const engine: MemoryEngine = {
    reconcile: () => ({ upserted: 0, deleted: 0, total: maintenanceStore.listRetention({ epochId: input.epochId }).length, invalid: [] }),
    assemble: ({ characterId, currentMessage }) => captureAssembly(state, characterId)(currentMessage),
    createTools: (characterId): ToolSet => createCanonicalMemoryToolsWithCapabilities({ coordinator,
      authority: authority.activeEpoch(input.epochId), router: router(characterId) }, LOCAL_MEMORY_CAPABILITIES),
    createBackgroundTools: (characterId) => { banks(characterId); return tidy.createTools(characterId); },
    writeEntry: (request) => writeCanonicalObservedMemory({ provider, epochId: input.epochId, banks }, request),
    retention: retention.ops,
    tidy,
  };
  return { ...engine, provider, authority, maintenanceStore, banks, retentionSweep: retention.sweep,
    captureRun: (characterId: string) => createCanonicalMemoryRun({ coordinator, router: router(characterId),
      assemble: captureAssembly(state, characterId), prompt: CANONICAL_MEMORY_SYSTEM_PROMPT }) };
}

function createLocalState(input: RuntimeInput) {
  const authority = createCanonicalMemoryAuthorityRepo(input.db);
  authority.activeEpoch(input.epochId);
  const config = input.config ?? loadMemoryConfig({});
  const persona = input.promptDir ? createPersonaProvider({ promptDir: input.promptDir }) : createFallbackPersonaProvider();
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: config.stoplist });
  const records = createCanonicalMemoryRepo(input.db);
  const maintenanceStore = createCanonicalMemoryMaintenanceRepo(input.db, tokenizer);
  const blocks = createStructuredMemoryBlockRepo(input.db);
  const provider = createLocalMemoryProvider({ authority, records, sparse: createCanonicalMemorySparseRepo(input.db), tokenizer,
    maintenance: maintenanceStore, intentionsDefaultDays: config.intentionsDefaultDays });
  const coordinator = createMemoryCoordinator({ authority, providers: new Map([["local", provider]]) });
  return { ...input, authority, config, persona, tokenizer, records, maintenanceStore, blocks, provider, coordinator };
}

function captureAssembly(state: LocalState, characterId: string) {
  const scope = ensureCanonicalLocalBanks({ authority: state.authority, epochId: state.epochId, characterId });
  const rows = state.maintenanceStore.list({ epochId: state.epochId, characterId }).map((record) =>
    canonicalMemoryRow(record, record.unit.bankId === scope.global.bankId ? null : characterId));
  return captureCanonicalMemoryAssembly({ characterId, rows, persona: state.persona, pinnedBudget: state.config.pinnedBudget,
    blocks: state.blocks.render([{ kind: "global", characterId: null }, { kind: "character", characterId }]) });
}
