import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { slotWindowStateMigration011 } from "./011-slot-window-state.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

describe("slotWindowStateMigration011", () => {
  it("creates the table and round-trips a calibration row", () => {
    const db = open();
    runMigrations(db, [slotWindowStateMigration011]);

    db.prepare(
      "INSERT INTO slot_window_state (slot, effective_window, factor, updated_at) " +
        "VALUES ('main', 29491, 1.25, '2026-08-01T00:00:00.000Z')",
    ).run();

    expect(db.prepare("SELECT slot, effective_window, factor FROM slot_window_state").get()).toEqual({
      slot: "main",
      effective_window: 29491,
      factor: 1.25,
    });
  });

  it("slot is the PRIMARY KEY: the upsert path replaces, a raw duplicate insert throws", () => {
    const db = open();
    runMigrations(db, [slotWindowStateMigration011]);
    const insert = db.prepare(
      "INSERT INTO slot_window_state (slot, effective_window, factor, updated_at) VALUES ('main', 100, 1.0, 't')",
    );
    insert.run();

    expect(() => insert.run()).toThrow(/UNIQUE|PRIMARY/i);

    db.prepare(
      "INSERT INTO slot_window_state (slot, effective_window, factor, updated_at) VALUES ('main', 90, 2.0, 't2') " +
        "ON CONFLICT(slot) DO UPDATE SET effective_window = excluded.effective_window, factor = excluded.factor, " +
        "updated_at = excluded.updated_at",
    ).run();
    expect(db.prepare("SELECT effective_window, factor FROM slot_window_state").get()).toEqual({
      effective_window: 90,
      factor: 2,
    });
  });

  it("is STRICT: a text value in the INTEGER window column is rejected", () => {
    const db = open();
    runMigrations(db, [slotWindowStateMigration011]);

    expect(() =>
      db
        .prepare("INSERT INTO slot_window_state (slot, effective_window, factor, updated_at) VALUES ('m', 'big', 1.0, 't')")
        .run(),
    ).toThrow();
  });
});
