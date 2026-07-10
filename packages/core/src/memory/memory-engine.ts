/**
 * INPUT:  the Database wrapper + a memory root dir (under the Workspace)
 * OUTPUT: createMemoryEngine({db, memoryRoot}) -> { reconcile, assemble, createTools, writeEntry }
 * POS:    core/memory — the memory subsystem's composition root: wires store+repo+indexer+retriever+assembler+tools
 */
import type { Database } from "../db/sqlite.ts";
import { createMemoryRepo } from "../db/memory-repo.ts";
import { createAssembler, type AssembleParams } from "./assembler.ts";
import { createFts5Retriever } from "./fts5-retriever.ts";
import { indexEntry, reconcile, type ReconcileStats } from "./indexer.ts";
import { createMemoryTools, type MemoryToolOps } from "./memory-tools.ts";
import { createMemoryStore } from "./store.ts";
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
  /** Direct file-first-then-index write (auto-memory episodic path; tools cover the LLM-invoked path). */
  writeEntry(input: {
    characterId: string;
    type: string;
    content: string;
    importance: number;
    disclosure?: string;
  }): { id: string; layer: string };
}

export function createMemoryEngine(deps: { db: Database; memoryRoot: string }): MemoryEngine {
  const store = createMemoryStore({ root: deps.memoryRoot });
  const repo = createMemoryRepo(deps.db);
  const retriever = createFts5Retriever(repo);
  const assembler = createAssembler({ repo, retriever });

  // The write path is file-first, then index (a crash between the two heals at the next startup reconcile).
  const ops: MemoryToolOps = {
    writeEntry({ characterId, type, content, importance, disclosure }) {
      const stored = store.write({ layer: type, characterId, content, importance, disclosure });
      indexEntry(repo, stored);
      return { id: stored.entry.id, layer: stored.entry.layer };
    },
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
    writeEntry: (input) => ops.writeEntry(input),
  };
}
