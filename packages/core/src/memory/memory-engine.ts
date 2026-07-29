/**
 * INPUT:  the Database wrapper + a memory root dir (under the Workspace) + an optional PersonaProvider (prompt cards)
 * OUTPUT: createMemoryEngine({db, memoryRoot, persona?}) -> { reconcile, assemble, createTools, writeEntry }
 * POS:    core/memory — the memory subsystem's composition root: wires store+repo+indexer+retriever+assembler+tools
 */
import type { Database } from "../db/sqlite.ts";
import { createMemoryEventsRepo, type MemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createMemoryRepo, type MemoryRepo } from "../db/memory-repo.ts";
import { createAssembler, type AssembleParams } from "./assembler.ts";
import { findDuplicate } from "./dedupe.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import { indexEntry, reconcile, type ReconcileStats } from "./indexer.ts";
import { createMemoryTools, createBackgroundMemoryTools, type MemoryToolOps, type MemoryWriteRequest } from "./memory-tools.ts";
import { createFallbackPersonaProvider, type PersonaProvider } from "./persona-provider.ts";
import { createMemoryStore, type MemoryStore } from "./store.ts";
import type { ToolSet } from "ai";

// How many memories a single memory_search tool call returns to the model.
const SEARCH_LIMIT = 8;

export interface MemoryEngine {
  /** Startup reconciliation: rebuild the derived index from the files (files are truth). */
  reconcile(): ReconcileStats;
  /** The per-turn assembled context string (persona + emotion + pinned + retrieved + intention). */
  assemble(params: AssembleParams): string;
  /** characterId-bound memory tools for one chat stream. */
  createTools(characterId: string): ToolSet;
  /** The same set for an AUTOMATIC pass: memory_write restricted to the auto layers + importance ceiling (Q11-1). */
  createBackgroundTools(characterId: string): ToolSet;
  /** Direct file-first-then-index write (auto-memory episodic path; tools cover the LLM-invoked path). */
  writeEntry(input: MemoryWriteRequest): { id: string; layer: string };
}

export function createMemoryEngine(deps: { db: Database; memoryRoot: string; persona?: PersonaProvider }): MemoryEngine {
  const store = createMemoryStore({ root: deps.memoryRoot });
  const repo = createMemoryRepo(deps.db);
  // Created here rather than injected: the engine already owns the db, so the write path can never ship unwired.
  const events = createMemoryEventsRepo(deps.db);
  const retriever = createFts5Retriever(repo);
  // The persona provider is injected in production (main.ts, reading prompt/); tests without one degrade to fallbacks.
  const assembler = createAssembler({ repo, retriever, persona: deps.persona ?? createFallbackPersonaProvider() });

  // The write path is file-first, then index (a crash between the two heals at the next startup reconcile).
  const ops: MemoryToolOps = {
    writeEntry: (input) => writeEntry({ store, repo, events }, input),
    archiveEntry({ characterId, id }) {
      const path = repo.resolvePath({ id, characterId });
      if (!path) return false;
      indexEntry(repo, store.archiveAtPath(path));
      return true;
    },
    search({ characterId, query, layer }) {
      return retriever.retrieve({ text: query, characterId, layers: layer ? [layer] : undefined, limit: SEARCH_LIMIT });
    },
  };

  return {
    reconcile: () => reconcile({ repo, store }),
    assemble: (params) => assembler.assemble(params),
    createTools: (characterId) => createMemoryTools(ops, characterId),
    createBackgroundTools: (characterId) => createBackgroundMemoryTools(ops, characterId),
    writeEntry: (input) => ops.writeEntry(input),
  };
}

interface WriteDeps {
  store: MemoryStore;
  repo: MemoryRepo;
  events: MemoryEventsRepo;
}

/**
 * T5-R9: a near-duplicate write is evidence that recall FAILED for that item — she would not have written it again
 * had she seen it. So the duplicate REINFORCES the existing entry (importance up, recency refreshed) instead of
 * adding a second row that dilutes the search she is only allowed to run once.
 */
function writeEntry(deps: WriteDeps, input: MemoryWriteRequest): { id: string; layer: string } {
  const { characterId, type, content, importance } = input;
  const now = new Date().toISOString();
  const scope = deps.repo.listActiveByLayers({ characterId, layers: [type], now });
  const duplicate = findDuplicate(scope, content);
  if (duplicate) {
    const reinforced = deps.store.reinforceAtPath(duplicate.path, importance);
    indexEntry(deps.repo, reinforced);
    deps.events.record({ kind: "reinforce", characterId, turnSeq: input.turnSeq, entryId: duplicate.id });
    return { id: duplicate.id, layer: duplicate.layer };
  }

  const stored = deps.store.write({
    layer: type,
    characterId,
    content,
    importance,
    disclosure: input.disclosure,
    origin: input.origin,
  });
  indexEntry(deps.repo, stored);
  return { id: stored.entry.id, layer: stored.entry.layer };
}
