/**
 * INPUT:  the Database wrapper + a memory root dir (under the Workspace) + optional PersonaProvider / BlockStore /
 *         MemoryConfig / timeline / SearchTokenizer
 * OUTPUT: createMemoryEngine(deps) -> { reconcile, assemble, createTools, createBackgroundTools, writeEntry,
 *         retention, tidy }; TidyEngineView
 * POS:    core/memory — the memory subsystem's composition root: wires store+repo+indexer+retriever+assembler+tools
 */
import { DEFAULT_PINNED_BUDGET, type MemoryConfig } from "../config/memory-config.ts";
import type { Database } from "../db/sqlite.ts";
import { createMemoryEventsRepo, type MemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createMemoryRepo, type MemoryEntryRow, type MemoryRepo } from "../db/memory-repo.ts";
import { createAssembler, type AssembleParams } from "./assembler.ts";
import { getBlock } from "./block-registry.ts";
import type { BlockStore } from "./block-store.ts";
import { findDuplicate } from "./dedupe.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import { indexEntry, reconcile, type IndexDeps, type ReconcileStats } from "./indexer.ts";
import { V1_MEMORY_LAYERS } from "./layer-registry.ts";
import {
  createMemoryTools,
  createBackgroundMemoryTools,
  type MemoryToolOps,
  type MemoryWriteRequest,
  type TurnSeqGetter,
} from "./memory-tools.ts";
import { createFallbackPersonaProvider, type PersonaProvider } from "./persona-provider.ts";
import type { MemoryRetentionOps } from "./retention-sweeper.ts";
import type { Retriever } from "./retriever.ts";
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "./search-tokenizer.ts";
import { createMemoryStore, type MemoryStore } from "./store.ts";
import { createTidyTools, type TidyToolOps } from "./tidy-tools.ts";
import type { ToolSet } from "ai";
import type { InitiativeMemoryAssembler } from "./initiative-memory-assembly.ts";
import type { MemoryTidyFailureReason, MemoryTidyIssue } from "@taki/shared";

// How many memories a single memory_search tool call returns to the model.
const SEARCH_LIMIT = 8;

const ALL_LAYER_IDS = V1_MEMORY_LAYERS.map((layer) => layer.id);

/** Captured canonical review evidence; Legacy keeps its existing bounded-pass semantics. */
export interface TidyReviewOutcome {
  complete: boolean;
  edits: number;
  reason?: MemoryTidyFailureReason;
  issues: MemoryTidyIssue[];
  issueCount: number;
}

/** The tidy pass's engine surface (batch 4b): deterministic report reads + the maintenance toolset. */
export interface TidyEngineView {
  /** Freeze canonical row and block revisions before the report can wait for the Utility Slot. */
  captureReview?(characterId: string): TidyEngineView;
  /** Failed canonical CAS/authority work keeps the report eligible for retry. */
  reviewHealthy?(): boolean;
  /** Canonical completion requires explicit finish, current authority and no unresolved issue; edits exclude replays. */
  reviewOutcome?(): TidyReviewOutcome;
  /** Every active in-scope row across all layers — the report's raw material. */
  listActive(characterId: string): MemoryEntryRow[];
  /** Writes-since-mark for the trigger; updated_at counts — a reinforced store is a changed store. */
  countSince(characterId: string, since: string | null): number;
  readBlock(ref: { id: string; characterId?: string }): string | undefined;
  /** The maintenance verbs the chat agent never gets (Letta tool asymmetry, rc A2). */
  createTools(characterId: string): ToolSet;
}

export interface MemoryEngine {
  /** Startup reconciliation: rebuild the derived index from the files (files are truth). */
  reconcile(): ReconcileStats;
  /** The per-turn assembled context string (persona + emotion + blocks + pinned + intention) — deterministic push only. */
  assemble(params: AssembleParams): string;
  /** Optional compatibility seam: freeze Persona and explicit scope Blocks without primary recall/pinned/intention logic. */
  captureInitiative?(characterId: string): InitiativeMemoryAssembler;
  /** characterId-bound memory tools for one chat stream; `seq` overrides the engine's timeline for the event log. */
  createTools(characterId: string, seq?: TurnSeqGetter): ToolSet;
  /** The same set for an AUTOMATIC pass: memory_write restricted to the auto layers + importance ceiling (Q11-1). */
  createBackgroundTools(characterId: string, seq?: TurnSeqGetter): ToolSet;
  /** Direct file-first-then-index write (auto-memory episodic path; tools cover the LLM-invoked path). */
  writeEntry(input: MemoryWriteRequest): { id: string; layer: string };
  /** The retention sweeper's seam: list a layer's active rows, archive one, hard-delete one (T5-R8). */
  readonly retention: MemoryRetentionOps;
  /** The tidy pass's seam (batch 4b). */
  readonly tidy: TidyEngineView;
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
  // The retriever serves the PULL path only (memory_search via ops.search) — the assembler no longer sees it (T5-R6).
  const retriever = createFts5Retriever({ repo, tokenizer });
  // The persona provider is injected in production (main.ts, reading prompt/); tests without one degrade to fallbacks.
  const assembler = createAssembler({
    repo,
    persona: deps.persona ?? createFallbackPersonaProvider(),
    blocks: deps.blocks,
    pinnedBudget: deps.config?.pinnedBudget ?? DEFAULT_PINNED_BUDGET,
  });
  const turnSeq = (characterId: string): TurnSeqGetter => () => deps.timeline?.latestSeq(characterId);

  // The write path is file-first, then index (a crash between the two heals at the next startup reconcile).
  const ops = buildToolOps({ store, index, events, repo, retriever });
  const tidy = createTidyView({ repo, store, index, ops, blocks: deps.blocks });

  return {
    reconcile: () => reconcile({ repo, tokenizer, store }),
    assemble: (params) => assembler.assemble(params),
    captureInitiative: assembler.captureInitiative,
    createTools: (characterId, seq) => createMemoryTools(ops, characterId, seq ?? turnSeq(characterId)),
    createBackgroundTools: (characterId, seq) =>
      createBackgroundMemoryTools(ops, characterId, seq ?? turnSeq(characterId)),
    writeEntry: (input) => ops.writeEntry(input),
    // Same file-first-then-index discipline as every other write path; the POLICY lives in retention-sweeper.ts.
    retention: {
      listActive: (layer) => repo.listActiveInLayer(layer),
      archive: (path) => indexEntry(index, store.archiveAtPath(path)),
      hardDelete: (path) => {
        store.deleteAtPath(path);
        repo.deleteByPath(path);
      },
    },
    tidy,
  };
}

interface WriteDeps {
  store: MemoryStore;
  index: IndexDeps;
  events: MemoryEventsRepo;
}

function buildToolOps(w: WriteDeps & { repo: MemoryRepo; retriever: Retriever }): MemoryToolOps {
  return {
    writeEntry: (input) => writeEntry(w, input),
    archiveEntry({ characterId, id }) {
      const path = w.repo.resolvePath({ id, characterId });
      if (!path) return false;
      indexEntry(w.index, w.store.archiveAtPath(path));
      return true;
    },
    search({ characterId, query, layer }) {
      return w.retriever.retrieve({ text: query, characterId, layers: layer ? [layer] : undefined, limit: SEARCH_LIMIT });
    },
    recordSearch: (input) => w.events.record({ kind: "search", ...input }),
  };
}

interface TidyWiring {
  repo: MemoryRepo;
  store: MemoryStore;
  index: IndexDeps;
  ops: MemoryToolOps;
  blocks?: BlockStore;
}

function createTidyView(w: TidyWiring): TidyEngineView {
  const tidyOps = buildTidyOps(w);
  return {
    listActive: (characterId) =>
      w.repo.listActiveByLayers({ characterId, layers: ALL_LAYER_IDS, now: new Date().toISOString() }),
    countSince: (characterId, since) => w.repo.countActiveSince({ characterId, since }),
    readBlock: (ref) => w.blocks?.readBlock(ref),
    createTools: (characterId) => createTidyTools(tidyOps, characterId),
  };
}

/**
 * Maintenance verbs behind tidy-tools.ts. Q11-1's importance ceiling deliberately does NOT bind these: tidy
 * promotion is one of the two sanctioned routes to the always-visible rung, so writes ride the UNRESTRICTED engine
 * path — where R9 dedupe stays live by choice (a tidy that would mint a duplicate should reinforce instead).
 */
function buildTidyOps(w: TidyWiring): TidyToolOps {
  const { repo, store, index, ops } = w;
  return {
    reinforce({ characterId, id }) {
      const path = repo.resolvePath({ id, characterId });
      if (!path) return false;
      // Incoming importance 1 = keep the existing rung (reinforceAtPath maxes): a tidy "still alive" refreshes
      // recency + count only; promotion goes through archive-supersede with a deliberate importance.
      indexEntry(index, store.reinforceAtPath(path, 1));
      return true;
    },
    archive: (input) => ops.archiveEntry(input),
    writeEntry: (input) => ops.writeEntry(input),
    setDisclosure({ characterId, id, disclosure }) {
      const path = repo.resolvePath({ id, characterId });
      if (!path) return false;
      indexEntry(index, store.setDisclosureAtPath(path, disclosure));
      return true;
    },
    refile({ characterId, id, layer }) {
      const path = repo.resolvePath({ id, characterId });
      if (!path) return undefined;
      const { stored, oldPath } = store.refileAtPath(path, layer, characterId);
      if (oldPath !== stored.filePath) repo.deleteByPath(oldPath);
      indexEntry(index, stored);
      return { id: stored.entry.id, layer: stored.entry.layer };
    },
    rethinkBlock({ id, characterId, content }) {
      if (!w.blocks) return { ok: false, reason: "no block store configured" };
      // Ownership decides whether the bound characterId applies; an unknown id falls through to the store's refusal.
      return w.blocks.writeBlock({
        id,
        content,
        caller: "background",
        characterId: getBlock(id)?.ownership === "per-character" ? characterId : undefined,
      });
    },
  };
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
