import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { memoryEventsMigration007 } from "./007-memory-events.ts";
import { memoryEventsCountMigration009 } from "./009-memory-events-count.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

function seedBatch1Event(db: Database): void {
  db.prepare(
    "INSERT INTO memory_events (kind, character_id, turn_seq, entry_id, created_at) " +
      "VALUES ('reinforce', 'taki', 42, '0007-ramen', '2026-07-29T00:00:00.000Z')",
  ).run();
}

describe("memoryEventsCountMigration009", () => {
  it("leaves a pre-existing batch-1 event readable with a NULL count", () => {
    const db = open();
    runMigrations(db, [memoryEventsMigration007]);
    seedBatch1Event(db);

    runMigrations(db, [memoryEventsMigration007, memoryEventsCountMigration009]);

    // A skip counts nothing and a reinforce points at one entry — NULL is the honest value, not 0.
    expect(db.prepare("SELECT kind, turn_seq, entry_id, count FROM memory_events").get()).toEqual({
      kind: "reinforce",
      turn_seq: 42,
      entry_id: "0007-ramen",
      count: null,
    });
  });

  it("accepts an integer count on the STRICT table (the search kind's hit count)", () => {
    const db = open();
    runMigrations(db, [memoryEventsMigration007, memoryEventsCountMigration009]);

    db.prepare(
      "INSERT INTO memory_events (kind, character_id, turn_seq, entry_id, count, created_at) " +
        "VALUES ('search', 'taki', 7, NULL, 3, '2026-07-29T00:00:00.000Z')",
    ).run();

    expect(db.prepare("SELECT kind, count FROM memory_events WHERE kind = 'search'").get()).toEqual({
      kind: "search",
      count: 3,
    });
  });
});
