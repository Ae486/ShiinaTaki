/**
 * INPUT:  the Database wrapper + a memory root dir (under the Workspace) + optional PersonaProvider / BlockStore /
 *         MemoryConfig / timeline / SearchTokenizer
 * OUTPUT: createMemoryEngine(deps) -> { reconcile, assemble, createTools, createBackgroundTools, writeEntry }
 * POS:    core/memory — the memory subsystem's composition root: wires store+repo+indexer+retriever+assembler+tools
 */
import { DEFAULT_PINNED_BUDGET, type MemoryConfig } from "../config/memory-config.ts";
import type { Database } from "../db/sqlite.ts";
import { createMemoryEventsRepo, type MemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createMemoryRepo } from "../db/memory-repo.ts";
import { createAssembler, type AssembleParams } from "./assembler.ts";
import type { BlockStore } from "./block-store.ts";
import { findDuplicate } from "./dedupe.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import { indexEntry, reconcile, type IndexDeps, type ReconcileStats } from "./indexer.ts";
import {
  createMemoryTools,
  createBackgroundMemoryTools,
  type MemoryToolOps,
  type MemoryWriteRequest,
  type TurnSeqGetter,
} from "./memory-tools.ts";
import { createFallbackPersonaProvider, type PersonaProvider } from "./persona-provider.ts";
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "./search-tokenizer.ts";
import { createMemoryStore, type MemoryStore } from "./store.ts";
import type { ToolSet } from "ai";

// How many memories a single memory_search tool call returns to the model.
const SEARCH_LIMIT = 8;

export interface MemoryEngine {
  /** Startup reconciliation: rebuild the derived index from the files (files are truth). */
  reconcile(): ReconcileStats;
  /** The per-turn assembled context string (persona + emotion + pinned + retrieved + intention). */
  assemble(params: AssembleParams): string;
  /** characterId-bound memory tools for one chat stream; `seq` overrides the engine's timeline for the event log. */
  createTools(characterId: string, seq?: TurnSeqGetter): ToolSet;
  /** The same set for an AUTOMATIC pass: memory_write restricted to the auto layers + importance ceiling (Q11-1). */
  createBackgroundTools(characterId: string, seq?: TurnSeqGetter): ToolSet;
  /** Direct file-first-then-index write (auto-memory episodic path; tools cover the LLM-invoked path). */
  writeEntry(input: MemoryWriteRequest): { id: string; layer: string };
}

export interface MemoryEngineDeps {
  db: Database;
  memoryRoot: string;
  persona?: PersonaProvider;
  /** The always-visible Memory Blocks (Workspace `blocks/` tree); absent = the assembler emits no block sections. */
  blocks?: BlockStore;
  /** The memory subsystem's tunable numbers (T5-R13): pinned budget, bm25 weights, stoplist. Absent = defaults. */
  config?: MemoryConfig;
  /** Turn context for the memory event log — a NARROW structural type (zero coupling to the timeline module). It is
   *  the DEFAULT seq source because the chat path builds its tools inside the D1-frozen turn, which passes no getter. */
  timeline?: { latestSeq(characterId: string): number };
  /** The D53 swap point; absent = the Intl.Segmenter v1 impl built from `config.stoplist`. */
  tokenizer?: SearchTokenizer;
}

export function createMemoryEngine(deps: MemoryEngineDeps): MemoryEngine {
  const store = createMemoryStore({ root: deps.memoryRoot });
  const repo = createMemoryRepo(deps.db, deps.config?.bm25Weights);
  // ONE tokenizer instance for the whole subsystem: the index side and the query side must segment identically.
  const tokenizer = deps.tokenizer ?? createIntlSegmenterTokenizer({ stoplist: deps.config?.stoplist ?? true });
  const index: IndexDeps = { repo, tokenizer };
  // Created here rather than injected: the engine already owns the db, so the write path can never ship unwired.
  const events = createMemoryEventsRepo(deps.db);
  const retriever = createFts5Retriever({ repo, tokenizer });
  // The persona provider is injected in production (main.ts, reading prompt/); tests without one degrade to fallbacks.
  const assembler = createAssembler({
    repo,
    retriever,
    persona: deps.persona ?? createFallbackPersonaProvider(),
    blocks: deps.blocks,
    pinnedBudget: deps.config?.pinnedBudget ?? DEFAULT_PINNED_BUDGET,
  });
  const turnSeq = (characterId: string): TurnSeqGetter => () => deps.timeline?.latestSeq(characterId);

  // The write path is file-first, then index (a crash between the two heals at the next startup reconcile).
  const ops: MemoryToolOps = {
    writeEntry: (input) => writeEntry({ store, index, events }, input),
    archiveEntry({ characterId, id }) {
      const path = repo.resolvePath({ id, characterId });
      if (!path) return false;
      indexEntry(index, store.archiveAtPath(path));
      return true;
    },
    search({ characterId, query, layer }) {
      return retriever.retrieve({ text: query, characterId, layers: layer ? [layer] : undefined, limit: SEARCH_LIMIT });
    },
    recordSearch: (input) => events.record({ kind: "search", ...input }),
  };

  return {
    reconcile: () => reconcile({ repo, tokenizer, store }),
    assemble: (params) => assembler.assemble(params),
    createTools: (characterId, seq) => createMemoryTools(ops, characterId, seq ?? turnSeq(characterId)),
    createBackgroundTools: (characterId, seq) =>
      createBackgroundMemoryTools(ops, characterId, seq ?? turnSeq(characterId)),
    writeEntry: (input) => ops.writeEntry(input),
  };
}

interface WriteDeps {
  store: MemoryStore;
  index: IndexDeps;
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
  const scope = deps.index.repo.listActiveByLayers({ characterId, layers: [type], now });
  const duplicate = findDuplicate(scope, content);
  if (duplicate) {
    const reinforced = deps.store.reinforceAtPath(duplicate.path, importance);
    indexEntry(deps.index, reinforced);
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
  indexEntry(deps.index, stored);
  return { id: stored.entry.id, layer: stored.entry.layer };
}
