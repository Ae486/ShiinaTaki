/**
 * INPUT:  optional dbPath (default :memory:)
 * OUTPUT: createMemoryFixture() -> { root, db, store, repo, reconcile, reopenDb, cleanup }
 * POS:    core/testing — test-only memory fixture (real store + real schema); never imported by production code
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createMemoryRepo, type MemoryRepo } from "../db/memory-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { reconcile as reconcileIndex, type ReconcileStats } from "../memory/indexer.ts";
import { createMemoryStore, type MemoryStore } from "../memory/store.ts";
import { rmTempDir } from "./rm-temp.ts";

export interface MemoryFixture {
  root: string;
  readonly db: Database;
  readonly repo: MemoryRepo;
  store: MemoryStore;
  reconcile(): ReconcileStats;
  /** Simulate "delete the DB": drop the connection and open a fresh one (empty for :memory:, persisted for a file path). */
  reopenDb(): void;
  cleanup(): void;
}

export function createMemoryFixture(opts: { dbPath?: string } = {}): MemoryFixture {
  const root = mkdtempSync(join(tmpdir(), "taki-mem-"));
  const dbPath = opts.dbPath ?? ":memory:";
  const store = createMemoryStore({ root });
  let db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  let repo = createMemoryRepo(db);

  return {
    root,
    store,
    get db() {
      return db;
    },
    get repo() {
      return repo;
    },
    reconcile: () => reconcileIndex({ repo, store }),
    reopenDb() {
      db.close();
      db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
      repo = createMemoryRepo(db);
    },
    cleanup() {
      db.close();
      rmTempDir(root);
    },
  };
}
