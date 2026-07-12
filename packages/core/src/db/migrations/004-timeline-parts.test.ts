import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { timelineMigration001 } from "./001-timeline.ts";
import { timelinePartsMigration004 } from "./004-timeline-parts.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

describe("timelinePartsMigration004", () => {
  it("preserves pre-existing rows (seq, id, role, content) across the table rebuild", () => {
    const db = open();
    runMigrations(db, [timelineMigration001]);
    db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, created_at) VALUES (:id,:c,:r,:t,:a)",
    ).run({ id: "id-1", c: "taki", r: "assistant", t: "hi", a: "2026-07-12T00:00:00.000Z" });

    runMigrations(db, [timelineMigration001, timelinePartsMigration004]);

    const row = db.prepare("SELECT seq, id, role, content, parts FROM timeline_messages").get();
    expect(row).toMatchObject({ seq: 1, id: "id-1", role: "assistant", content: "hi", parts: null });
  });

  it("continues the seq sequence after the rebuild (AUTOINCREMENT survives the rename)", () => {
    const db = open();
    runMigrations(db, [timelineMigration001]);
    const insert = db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, created_at) VALUES (:id,:c,:r,:t,:a)",
    );
    insert.run({ id: "id-1", c: "taki", r: "user", t: "one", a: "2026-07-12T00:00:00.000Z" });

    runMigrations(db, [timelineMigration001, timelinePartsMigration004]);

    const next = db
      .prepare(
        "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) VALUES (:id,:c,:r,:t,:p,:a)",
      )
      .run({ id: "id-2", c: "taki", r: "tool", t: "two", p: "[]", a: "2026-07-12T00:00:01.000Z" });
    expect(next.lastInsertRowid).toBe(2);
  });

  it("admits the new 'tool' role that migration 1's CHECK rejected", () => {
    const db = open();
    runMigrations(db, [timelineMigration001, timelinePartsMigration004]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO timeline_messages (id, character_id, role, content, created_at) VALUES (:id,:c,:r,:t,:a)",
        )
        .run({ id: "id-1", c: "taki", r: "tool", t: "x", a: "2026-07-12T00:00:00.000Z" }),
    ).not.toThrow();
  });
});
