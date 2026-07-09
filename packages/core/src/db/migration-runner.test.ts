import { describe, expect, it } from "vitest";
import { runMigrations, type Migration } from "./migration-runner.ts";
import { openDatabase, type Database } from "./sqlite.ts";

// A clean wrapper with only the migrations table (empty list = no user migrations applied).
function freshDb(): Database {
  return openDatabase({ path: ":memory:", migrations: [] });
}

const m1: Migration = { version: 1, sql: "CREATE TABLE a (id INTEGER)" };
const m2: Migration = { version: 2, sql: "CREATE TABLE b (id INTEGER)" };

describe("runMigrations", () => {
  it("applies pending migrations and records their versions", () => {
    const db = freshDb();
    expect(runMigrations(db, [m1, m2])).toEqual([1, 2]); // returns the versions applied this run
    const rows = db.prepare("SELECT version FROM migrations ORDER BY version").all();
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    db.close();
  });

  it("applies only versions newer than the recorded max on a later run", () => {
    const db = freshDb();
    runMigrations(db, [m1]);
    expect(runMigrations(db, [m1, m2])).toEqual([2]); // m1 skipped (already applied), only m2 applied
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(2);
    expect(db.prepare("SELECT count(*) AS n FROM b").get()?.n).toBe(0); // table b now exists
    db.close();
  });

  it("is a no-op when re-run with the same list", () => {
    const db = freshDb();
    runMigrations(db, [m1]);
    expect(runMigrations(db, [m1])).toEqual([]); // nothing new to apply
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(1);
    db.close();
  });

  it("rolls back a failing migration and records nothing", () => {
    const db = freshDb();
    const bad: Migration = { version: 1, sql: "CREATE TABLE good (id INTEGER); NOT SQL;" };
    expect(() => runMigrations(db, [bad])).toThrowError(/migration 1 failed/);
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(0);
    // the good table created earlier in the same migration was rolled back with it
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='good'").all();
    expect(tables).toHaveLength(0);
    db.close();
  });
});
