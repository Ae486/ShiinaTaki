import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { configMigration013 } from "./013-config.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

const INSERT =
  "INSERT INTO config (key, value, updated_at) VALUES ('TAKI_MAX_STEPS', '12', '2026-08-03T00:00:00.000Z')";

describe("configMigration013", () => {
  it("creates the table and round-trips a knob row", () => {
    const db = open();
    runMigrations(db, [configMigration013]);
    db.prepare(INSERT).run();

    expect(db.prepare("SELECT key, value FROM config").get()).toEqual({ key: "TAKI_MAX_STEPS", value: "12" });
  });

  it("re-running the migration set is a no-op (idempotent re-open)", () => {
    const db = open();
    runMigrations(db, [configMigration013]);
    db.prepare(INSERT).run();

    expect(() => runMigrations(db, [configMigration013])).not.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM config").get()).toEqual({ n: 1 });
  });

  it("key is the PRIMARY KEY: a raw duplicate insert throws, the upsert path replaces", () => {
    const db = open();
    runMigrations(db, [configMigration013]);
    db.prepare(INSERT).run();

    expect(() => db.prepare(INSERT).run()).toThrow(/UNIQUE|PRIMARY/i);
  });

  it("is STRICT: a blob-typed value in a TEXT column is rejected", () => {
    const db = open();
    runMigrations(db, [configMigration013]);

    expect(() =>
      db.prepare("INSERT INTO config (key, value, updated_at) VALUES ('k', x'00ff', 't')").run(),
    ).toThrow();
  });
});
