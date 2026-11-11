import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  it("reports actual transaction state for wrapper nesting and direct SQL savepoints", () => {
    const db = openDatabase({ path: ":memory:", migrations: [] }); dbs.push(db);
    expect(db.isTransaction).toBe(false);
    db.transaction(() => {
      expect(db.isTransaction).toBe(true);
      expect(() => db.transaction(() => { expect(db.isTransaction).toBe(true); throw new Error("inner"); })).toThrow("inner");
      expect(db.isTransaction).toBe(true);
    });
    expect(db.isTransaction).toBe(false);
    db.exec("BEGIN; SAVEPOINT direct"); expect(db.isTransaction).toBe(true);
    db.exec("ROLLBACK TO direct; RELEASE direct"); expect(db.isTransaction).toBe(true);
    db.exec("ROLLBACK"); expect(db.isTransaction).toBe(false);
    expect(Object.getOwnPropertyDescriptor(db, "isTransaction")?.set).toBeUndefined();
  });

  it("reports ended transactions after deferred COMMIT failure and an implicit SQL rollback", () => {
    const db = openDatabase({ path: ":memory:", migrations: [] }); dbs.push(db);
    db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
    expect(() => db.transaction(() => { db.exec("INSERT INTO child VALUES(2)"); expect(db.isTransaction).toBe(true); })).toThrow();
    expect(db.isTransaction).toBe(false);
    expect(() => db.transaction(() => {
      expect(() => db.exec("INSERT OR ROLLBACK INTO parent VALUES(1)")).toThrow();
      expect(db.isTransaction).toBe(false);
    })).toThrow("transaction was rolled back");
    expect(db.isTransaction).toBe(false);
  });

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

describe("transaction", () => {
  it("rolls back a deferred COMMIT failure from a nested write and keeps the file connection usable", () => {
    const path = tempFile();
    const db = openDatabase({ path, migrations: [] });
    dbs.push(db);
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY); " +
      "CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
    db.prepare("INSERT INTO parent (id) VALUES (1)").run();

    expect(() => db.transaction(() => {
      db.exec("ALTER TABLE parent ADD COLUMN detail TEXT");
      db.transaction(() => { db.prepare("INSERT INTO child (parent_id) VALUES (2)").run(); });
    })).toThrowError(/FOREIGN KEY constraint failed/);

    expect(db.prepare("PRAGMA table_info(parent)").all().map((column) => column.name)).toEqual(["id"]);
    expect(db.prepare("SELECT * FROM child").all()).toEqual([]);
    db.transaction(() => { db.prepare("INSERT INTO child (parent_id) VALUES (1)").run(); });
    db.close();
    const reopened = openDatabase({ path, migrations: [] });
    dbs.push(reopened);
    expect(reopened.prepare("SELECT * FROM child").all()).toEqual([{ parent_id: 1 }]);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("isolates caught savepoint failures and still rolls back every surviving write with the outer transaction", () => {
    const db = openDatabase({ path: ":memory:", migrations: [] });
    dbs.push(db);
    db.exec("CREATE TABLE entry (id INTEGER PRIMARY KEY)");
    const insert = db.prepare("INSERT INTO entry (id) VALUES (:id)");

    expect(() => db.transaction(() => {
      insert.run({ id: 1 });
      expect(() => db.transaction(() => {
        insert.run({ id: 2 });
        throw new Error("inner failure");
      })).toThrow("inner failure");
      db.transaction(() => { insert.run({ id: 3 }); });
      expect(db.prepare("SELECT id FROM entry ORDER BY id").all()).toEqual([{ id: 1 }, { id: 3 }]);
      throw new Error("outer failure");
    })).toThrow("outer failure");

    expect(db.prepare("SELECT * FROM entry").all()).toEqual([]);
    db.transaction(() => { db.transaction(() => { insert.run({ id: 4 }); }); });
    expect(db.prepare("SELECT * FROM entry").all()).toEqual([{ id: 4 }]);
  });

  it("preserves the original error when SQLite has already rolled back the transaction", () => {
    const db = openDatabase({ path: ":memory:", migrations: [] });
    dbs.push(db);
    db.exec("CREATE TABLE entry (id INTEGER PRIMARY KEY); INSERT INTO entry (id) VALUES (1)");

    expect(() => db.transaction(() => {
      db.prepare("INSERT INTO entry (id) VALUES (2)").run();
      db.prepare("INSERT OR ROLLBACK INTO entry (id) VALUES (1)").run();
    })).toThrowError(/UNIQUE constraint failed/);

    expect(db.prepare("SELECT * FROM entry").all()).toEqual([{ id: 1 }]);
    db.transaction(() => { db.prepare("INSERT INTO entry (id) VALUES (3)").run(); });
    expect(db.prepare("SELECT * FROM entry ORDER BY id").all()).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it.each(["exec", "new statement", "run", "get", "all", "nested transaction"] as const)(
    "prevents %s from escaping an outer callback after a caught SQLite rollback", (method) => {
      const db = openDatabase({ path: ":memory:", migrations: [] });
      dbs.push(db);
      db.exec("CREATE TABLE entry (id INTEGER PRIMARY KEY); INSERT INTO entry (id) VALUES (1)");
      // Preparing before entry must not detach a statement from its connection's current boundary.
      const insert = db.prepare("INSERT INTO entry (id) VALUES (3)");
      const returning = db.prepare("INSERT INTO entry (id) VALUES (3) RETURNING id");
      let nestedStarted = false;
      const attempt = () => {
        switch (method) {
          case "exec": db.exec("INSERT INTO entry (id) VALUES (3)"); break;
          case "new statement": db.prepare("INSERT INTO entry (id) VALUES (3)").run(); break;
          case "run": insert.run(); break;
          case "get": returning.get(); break;
          case "all": returning.all(); break;
          case "nested transaction": db.transaction(() => { nestedStarted = true; insert.run(); }); break;
        }
      };

      expect(() => db.transaction(() => {
        db.prepare("INSERT INTO entry (id) VALUES (2)").run();
        expect(() => db.transaction(() => {
          db.prepare("INSERT OR ROLLBACK INTO entry (id) VALUES (1)").run();
        })).toThrowError(/UNIQUE constraint failed/);
        expect(attempt).toThrowError(/transaction was rolled back/);
      })).toThrowError(/transaction was rolled back/);

      expect(nestedStarted).toBe(false);
      expect(db.prepare("SELECT * FROM entry").all()).toEqual([{ id: 1 }]);
      db.transaction(() => { db.prepare("INSERT INTO entry (id) VALUES (4)").run(); });
      expect(db.prepare("SELECT * FROM entry ORDER BY id").all()).toEqual([{ id: 1 }, { id: 4 }]);
    },
  );
});

describe("backupTo", () => {
  function sourceWithRows(): Database {
    const db = openDatabase({ path: tempFile(), migrations: [] });
    dbs.push(db);
    // No INTEGER PRIMARY KEY: implicit rowids with gaps, the shape VACUUM INTO may renumber and Core orders by.
    db.exec("CREATE TABLE bulk (payload TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO bulk (payload) VALUES (:payload)");
    db.transaction(() => { for (let index = 0; index < 4000; index++) insert.run({ payload: `${index}:${"x".repeat(1000)}` }); });
    db.exec("DELETE FROM bulk WHERE rowid % 7 = 0");
    return db;
  }
  function openCopy(path: string): Database {
    const copy = openDatabase({ path, migrations: [] });
    dbs.push(copy);
    return copy;
  }
  const rows = (db: Database) => db.prepare("SELECT rowid AS id, payload FROM bulk ORDER BY rowid").all();

  it("copies an openable, intact database whose implicit rowids are unchanged", async () => {
    const db = sourceWithRows();
    const target = join(dirname(tempFile()), "copy.sqlite");
    expect(await db.backupTo(target)).toBeGreaterThan(100);
    const copy = openCopy(target);
    expect(copy.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    expect(rows(copy)).toEqual(rows(db));
  });

  it("reflects a same-connection write made while the copy is still running", async () => {
    const db = sourceWithRows();
    const target = join(dirname(tempFile()), "copy.sqlite");
    let settled = false;
    const copying = db.backupTo(target).finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    db.prepare("INSERT INTO bulk (payload) VALUES ('during')").run();
    await copying;
    const copy = openCopy(target);
    expect(copy.prepare("SELECT count(*) AS n FROM bulk WHERE payload='during'").get()?.n).toBe(1);
    expect(rows(copy)).toEqual(rows(db));
  });

  it("refuses to start inside a transaction and rejects when the target cannot be created", async () => {
    const db = sourceWithRows();
    const dir = dirname(tempFile());
    let inside: Promise<number> | undefined;
    db.transaction(() => { inside = db.backupTo(join(dir, "inside.sqlite")); });
    await expect(inside).rejects.toThrow(/inside a transaction/);
    await expect(db.backupTo(join(dir, "missing", "copy.sqlite"))).rejects.toThrow();
  });
});
