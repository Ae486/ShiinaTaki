/**
 * INPUT:  canonical Local SQLite repositories and one prepared active epoch selected by the migration marker
 * OUTPUT: MemoryEngine-compatible canonical assembly/tools plus inert legacy maintenance surfaces
 * POS:    core/memory — post-activation runtime; no Markdown store, BlockStore, reconcile, or legacy writer dependency
 */
import type { ToolSet } from "ai";
import type { Database } from "../db/sqlite.ts";
import type { MemoryEngine, TidyEngineView } from "./memory-engine.ts";
import type { MemoryRetentionOps } from "./retention-sweeper.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createLocalMemoryProvider } from "./local-memory-provider.ts";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import { createCanonicalMemoryToolsWithCapabilities } from "./canonical-tools/canonical-memory-tools.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { createPersonaProvider, createFallbackPersonaProvider, type PersonaProvider } from "./persona-provider.ts";
import { V1_BLOCKS } from "./block-registry.ts";
import { estimateTokens, fitToBudget } from "./token-estimator.ts";

const EMPTY_RETENTION: MemoryRetentionOps = { listActive: () => [], archive: () => undefined, hardDelete: () => undefined };
const EMPTY_TIDY: TidyEngineView = { listActive: () => [], countSince: () => 0, readBlock: () => undefined, createTools: () => ({}) };

export function createCanonicalLocalRuntime(input: { db: Database; epochId: string; promptDir?: string }): MemoryEngine {
  const authority = createCanonicalMemoryAuthorityRepo(input.db); authority.activeEpoch(input.epochId);
  const persona = input.promptDir ? createPersonaProvider({ promptDir: input.promptDir }) : createFallbackPersonaProvider();
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const provider = createLocalMemoryProvider({ authority, records: createCanonicalMemoryRepo(input.db), sparse: createCanonicalMemorySparseRepo(input.db), tokenizer });
  const coordinator = createMemoryCoordinator({ authority, providers: new Map([["local", provider]]) });
  return {
    reconcile: () => ({ upserted: 0, deleted: 0, total: 0, invalid: [] }),
    assemble: ({ characterId }) => assemble({ db: input.db, epochId: input.epochId, characterId, persona }),
    createTools: (characterId) => toolsFor({ db: input.db, coordinator, authority, epochId: input.epochId, characterId }),
    createBackgroundTools: () => ({}),
    writeEntry: () => { throw new Error("MEMORY_LEGACY_WRITE_RETIRED"); },
    retention: EMPTY_RETENTION,
    tidy: EMPTY_TIDY,
  };
}

function assemble(input: { db: Database; epochId: string; characterId: string; persona: PersonaProvider }): string {
  const { db, epochId, characterId, persona } = input;
  const sections = [persona.assistantLayer(), persona.persona(characterId)];
  const blocks = db.prepare("SELECT block_id,content FROM taki_memory_blocks WHERE scope_kind='global' OR (scope_kind='character' AND character_id=:character) ORDER BY CASE block_id WHEN 'user-card' THEN 0 WHEN 'user-model' THEN 1 ELSE 2 END").all({ character: characterId });
  for (const row of blocks) {
    const definition = V1_BLOCKS.find((block) => block.id === row.block_id);
    if (!definition) continue;
    const content = fitToBudget(String(row.content).split("\n"), definition.budgetTokens, (line) => line).join("\n");
    if (content.length > 0) sections.push(`${definition.header} [budget: ${estimateTokens(content)}/${definition.budgetTokens} tokens]\n${content}`);
  }
  const pinned = db.prepare("SELECT u.text FROM canonical_memory_units u JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id JOIN canonical_memory_banks b ON b.authority_epoch_id=u.authority_epoch_id AND b.bank_id=u.bank_id WHERE u.authority_epoch_id=:epoch AND u.state='valid' AND p.visibility='pinned' AND (b.scope_kind='global' OR b.character_id=:character) ORDER BY p.importance DESC,u.updated_at DESC LIMIT 32").all({ epoch: epochId, character: characterId }).map((row) => String(row.text));
  sections.push(...pinned);
  return sections.filter(Boolean).join("\n\n");
}

function toolsFor(input: { db: Database; coordinator: ReturnType<typeof createMemoryCoordinator>; authority: ReturnType<typeof createCanonicalMemoryAuthorityRepo>; epochId: string; characterId: string }): ToolSet {
  const banks = input.db.prepare("SELECT bank_id,scope_kind FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND (scope_kind='global' OR character_id=:character)").all({ epoch: input.epochId, character: input.characterId });
  const global = banks.find((row) => row.scope_kind === "global"); const character = banks.find((row) => row.scope_kind === "character");
  if (!global || !character) return {};
  const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
  return createCanonicalMemoryToolsWithCapabilities({ coordinator: input.coordinator, authority: input.authority.activeEpoch(input.epochId), router: { globalBankId: () => String(global.bank_id), characterBankId: () => String(character.bank_id), characterId: () => input.characterId } }, caps);
}
