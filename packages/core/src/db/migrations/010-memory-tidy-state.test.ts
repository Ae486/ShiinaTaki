import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { memoryAutoStateMigration003 } from "./003-memory-auto-state.ts";
import { memoryTidyStateMigration010 } from "./010-memory-tidy-state.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

function seedWatermarks(db: Database): void {
  db.prepare(
    "INSERT INTO memory_auto_state (character_id, last_episodic_seq, last_flush_seq) VALUES ('taki', 40, 12)",
  ).run();
}

describe("memoryTidyStateMigration010", () => {
  it("leaves an existing watermark row intact with a NULL last_tidy_at (never tidied)", () => {
    const db = open();
    runMigrations(db, [memoryAutoStateMigration003]);
    seedWatermarks(db);

    runMigrations(db, [memoryAutoStateMigration003, memoryTidyStateMigration010]);

    // NULL, not a boot timestamp: a fabricated mark would hide every write made before the first pass ever ran.
    expect(db.prepare("SELECT last_episodic_seq, last_flush_seq, last_tidy_at FROM memory_auto_state").get()).toEqual({
      last_episodic_seq: 40,
      last_flush_seq: 12,
      last_tidy_at: null,
    });
  });

  it("accepts an ISO timestamp on the STRICT table", () => {
    const db = open();
    runMigrations(db, [memoryAutoStateMigration003, memoryTidyStateMigration010]);

    db.prepare(
      "INSERT INTO memory_auto_state (character_id, last_tidy_at) VALUES ('taki', '2026-07-30T09:00:00.000Z')",
    ).run();

    expect(db.prepare("SELECT last_tidy_at FROM memory_auto_state").get()).toEqual({
      last_tidy_at: "2026-07-30T09:00:00.000Z",
    });
  });
});
