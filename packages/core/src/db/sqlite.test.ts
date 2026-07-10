import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, toSafeInteger, type Database } from "./sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";

const dbs: Database[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of dbs) db.close(); // idempotent close, safe even if the test closed it already
  dbs.length = 0;
  for (const dir of dirs) rmTempDir(dir);
  dirs.length = 0;
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-db-"));
  dirs.push(dir);
  return join(dir, "taki.db");
}

const INSERT_ONE =
  "INSERT INTO timeline_messages (id, character_id, role, content, created_at) " +
  "VALUES ('11111111-1111-4111-8111-111111111111','taki','user','hi','2026-07-10T00:00:00.000Z')";

describe("openDatabase", () => {
  it("opens :memory:, applies the schema, and records the migration", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    db.exec(INSERT_ONE); // table exists only if migration 001 ran
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(MIGRATIONS.length);
  });

  it("opens a file db in WAL mode with foreign keys on", () => {
    const db = openDatabase({ path: tempFile(), migrations: MIGRATIONS });
    dbs.push(db);
    expect(db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
  });

  it("persists across close/reopen and does not re-run migrations", () => {
    const file = tempFile();

    const first = openDatabase({ path: file, migrations: MIGRATIONS });
    first.exec(INSERT_ONE);
    expect(first.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(MIGRATIONS.length);
    first.close(); // releases the OS file handle

    const second = openDatabase({ path: file, migrations: MIGRATIONS });
    dbs.push(second);
    expect(second.prepare("SELECT content FROM timeline_messages").get()?.content).toBe("hi");
    // still exactly the same migration rows: every version was tracked, not re-applied on reopen
    expect(second.prepare("SELECT count(*) AS n FROM migrations").get()?.n).toBe(MIGRATIONS.length);
  });

  it("throws a readable fatal error when a migration is bad SQL", () => {
    const bad = [{ version: 1, sql: "CREATE TABLE ok (id INTEGER); THIS IS NOT SQL;" }];
    expect(() => openDatabase({ path: ":memory:", migrations: bad })).toThrowError(/migration 1 failed/);
  });
});

describe("toSafeInteger", () => {
  it("passes a number through unchanged", () => {
    expect(toSafeInteger(42)).toBe(42);
  });

  it("narrows a safe bigint to a number", () => {
    expect(toSafeInteger(9007199254740991n)).toBe(9_007_199_254_740_991);
  });

  it("throws on a bigint beyond MAX_SAFE_INTEGER", () => {
    expect(() => toSafeInteger(9007199254740993n)).toThrowError(/MAX_SAFE_INTEGER/);
  });
});
