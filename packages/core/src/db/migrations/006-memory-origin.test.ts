import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { memoryMigration002 } from "./002-memory.ts";
import { memoryOriginMigration006 } from "./006-memory-origin.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

// A pre-T5 metadata row: the columns that existed before this migration, nothing more.
function seedLegacyEntry(db: Database): void {
  db.prepare(
    "INSERT INTO memory_entries (path, id, layer, character_id, importance, status, created_at, expires_at, content_hash) " +
      "VALUES (:path, :id, :layer, :c, :imp, :st, :created, NULL, :hash)",
  ).run({
    path: "/m/0001-ramen.md",
    id: "0001-ramen",
    layer: "episodes",
    c: "taki",
    imp: 5,
    st: "active",
    created: "2026-07-01T00:00:00.000Z",
    hash: "a".repeat(64),
  });
}

describe("memoryOriginMigration006", () => {
  it("defaults every pre-existing row to origin 'self' with no updated_at", () => {
    const db = open();
    runMigrations(db, [memoryMigration002]);
    seedLegacyEntry(db);

    runMigrations(db, [memoryMigration002, memoryOriginMigration006]);

    expect(db.prepare("SELECT origin, updated_at FROM memory_entries").get()).toMatchObject({
      origin: "self",
      updated_at: null,
    });
  });

  it("blanks content_hash so the next boot reconcile re-reads the files and backfills the new columns", () => {
    const db = open();
    runMigrations(db, [memoryMigration002]);
    seedLegacyEntry(db);

    runMigrations(db, [memoryMigration002, memoryOriginMigration006]);

    // The reconciler re-indexes any row whose stored hash differs from the file's; "" can never equal a sha256,
    // so origin/updated_at are derived from the markdown (which is truth) rather than guessed in SQL.
    expect(db.prepare("SELECT content_hash FROM memory_entries").get()).toMatchObject({ content_hash: "" });
  });

  it("keeps the rest of the row untouched (a migration must not lose a memory's metadata)", () => {
    const db = open();
    runMigrations(db, [memoryMigration002]);
    seedLegacyEntry(db);

    runMigrations(db, [memoryMigration002, memoryOriginMigration006]);

    expect(db.prepare("SELECT path, id, layer, character_id, importance, created_at FROM memory_entries").get()).toEqual(
      {
        path: "/m/0001-ramen.md",
        id: "0001-ramen",
        layer: "episodes",
        character_id: "taki",
        importance: 5,
        created_at: "2026-07-01T00:00:00.000Z",
      },
    );
  });
});
