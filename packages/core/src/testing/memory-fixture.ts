/**
 * INPUT:  optional dbPath (default :memory:) and bm25 weights
 * OUTPUT: createMemoryFixture() -> { root, db, store, repo, tokenizer, reconcile, reopenDb, cleanup }
 * POS:    core/testing — test-only memory fixture (real store + real schema); never imported by production code
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bm25Weights } from "../config/memory-config.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createMemoryRepo, type MemoryRepo } from "../db/memory-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { reconcile as reconcileIndex, type ReconcileStats } from "../memory/indexer.ts";
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "../memory/search-tokenizer.ts";
import { createMemoryStore, type MemoryStore } from "../memory/store.ts";
import { rmTempDir } from "./rm-temp.ts";

export interface MemoryFixture {
  root: string;
  readonly db: Database;
  readonly repo: MemoryRepo;
  store: MemoryStore;
  /** The same instance the fixture indexes with — tests that hand-craft rows must segment through it, not around it. */
  tokenizer: SearchTokenizer;
  reconcile(): ReconcileStats;
  /** Simulate "delete the DB": drop the connection and open a fresh one (empty for :memory:, persisted for a file path). */
  reopenDb(): void;
  cleanup(): void;
}

export function createMemoryFixture(opts: { dbPath?: string; weights?: Bm25Weights; stoplist?: boolean } = {}): MemoryFixture {
  const root = mkdtempSync(join(tmpdir(), "taki-mem-"));
  const dbPath = opts.dbPath ?? ":memory:";
  const store = createMemoryStore({ root });
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: opts.stoplist ?? true });
  let db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  let repo = createMemoryRepo(db, opts.weights);

  return {
    root,
    store,
    tokenizer,
    get db() {
      return db;
    },
    get repo() {
      return repo;
    },
    reconcile: () => reconcileIndex({ repo, tokenizer, store }),
    reopenDb() {
      db.close();
      db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
      repo = createMemoryRepo(db, opts.weights);
    },
    cleanup() {
      db.close();
      rmTempDir(root);
    },
  };
}
