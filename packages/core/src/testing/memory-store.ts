/**
 * INPUT:  an optional onAppend sink
 * OUTPUT: createMemoryStore(onAppend?) -> { db, repo, store } backed by a fresh :memory: SQLite timeline
 * POS:    core/testing — test-only store fixture (exercises the real schema + repo); never imported by production code
 */
import type { TimelineEntry } from "@taki/shared";
import { createConversationStore, type ConversationStore } from "../agents/conversation-store.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createTimelineRepo, type TimelineRepo } from "../db/timeline-repo.ts";

export interface MemoryStore {
  db: Database;
  repo: TimelineRepo;
  store: ConversationStore;
}

export function createMemoryStore(onAppend?: (entry: TimelineEntry) => void): MemoryStore {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const repo = createTimelineRepo(db);
  const store = createConversationStore({ repo, onAppend });
  return { db, repo, store };
}
