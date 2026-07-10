/**
 * INPUT:  optional dbPath (default :memory:)
 * OUTPUT: createCompanionFixture() -> { root, conversation, memory, reconcile, reopen, cleanup }
 * POS:    core/testing — agent-level fixture (conversation store + memory engine over one db); never imported by production
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationStore, type ConversationStore } from "../agents/conversation-store.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createMemoryEngine, type MemoryEngine } from "../memory/memory-engine.ts";
import { rmTempDir } from "./rm-temp.ts";

export interface CompanionFixture {
  root: string;
  readonly db: Database;
  readonly conversation: ConversationStore;
  readonly memory: MemoryEngine;
  /** Fresh engine + conversation instances over the same workspace + db (simulates a core restart). */
  reopen(): void;
  cleanup(): void;
}

export function createCompanionFixture(opts: { dbPath?: string } = {}): CompanionFixture {
  const root = mkdtempSync(join(tmpdir(), "taki-companion-"));
  const memoryRoot = join(root, "memory");
  const dbPath = opts.dbPath ?? ":memory:";

  let db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  let conversation = createConversationStore({ repo: createTimelineRepo(db) });
  let memory = createMemoryEngine({ db, memoryRoot });
  memory.reconcile();

  return {
    root,
    get db() {
      return db;
    },
    get conversation() {
      return conversation;
    },
    get memory() {
      return memory;
    },
    reopen() {
      db.close();
      db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
      conversation = createConversationStore({ repo: createTimelineRepo(db) });
      memory = createMemoryEngine({ db, memoryRoot });
      memory.reconcile();
    },
    cleanup() {
      db.close();
      rmTempDir(root);
    },
  };
}
