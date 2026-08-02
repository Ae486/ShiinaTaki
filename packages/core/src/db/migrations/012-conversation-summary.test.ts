import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { conversationSummaryMigration012 } from "./012-conversation-summary.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

describe("conversationSummaryMigration012", () => {
  it("creates the table and round-trips a summary row", () => {
    const db = open();
    runMigrations(db, [conversationSummaryMigration012]);

    db.prepare(
      "INSERT INTO conversation_summary (character_id, through_seq, text, updated_at) " +
        "VALUES ('taki', 160, '那段时间我们聊了旅行', '2026-08-02T00:00:00.000Z')",
    ).run();

    expect(db.prepare("SELECT character_id, through_seq, text FROM conversation_summary").get()).toEqual({
      character_id: "taki",
      through_seq: 160,
      text: "那段时间我们聊了旅行",
    });
  });

  it("character_id is the PRIMARY KEY: the upsert path replaces, a raw duplicate insert throws (one row per character)", () => {
    const db = open();
    runMigrations(db, [conversationSummaryMigration012]);
    const insert = db.prepare(
      "INSERT INTO conversation_summary (character_id, through_seq, text, updated_at) VALUES ('taki', 10, 'a', 't')",
    );
    insert.run();

    expect(() => insert.run()).toThrow(/UNIQUE|PRIMARY/i);

    db.prepare(
      "INSERT INTO conversation_summary (character_id, through_seq, text, updated_at) VALUES ('taki', 20, 'b', 't2') " +
        "ON CONFLICT(character_id) DO UPDATE SET through_seq = excluded.through_seq, text = excluded.text, " +
        "updated_at = excluded.updated_at",
    ).run();
    expect(db.prepare("SELECT through_seq, text FROM conversation_summary").get()).toEqual({
      through_seq: 20,
      text: "b",
    });
  });

  it("is STRICT: a text value in the INTEGER through_seq column is rejected", () => {
    const db = open();
    runMigrations(db, [conversationSummaryMigration012]);

    expect(() =>
      db
        .prepare("INSERT INTO conversation_summary (character_id, through_seq, text, updated_at) VALUES ('t', 'far', 'x', 't')")
        .run(),
    ).toThrow();
  });
});
