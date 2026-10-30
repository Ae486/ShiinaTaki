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
describe("outermost afterCommit", () => {
  function database(onAfterCommitError?: (error: unknown) => void) {
    const db = openDatabase({ path: ":memory:", migrations: [], onAfterCommitError }); dbs.push(db);
    db.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
    return db;
  }

  it("runs only after the outer commit and preserves registration order across savepoints", () => {
    const db = database(); const seen: string[] = [];
    db.transaction(() => {
      db.afterCommit(() => { expect(db.prepare("SELECT id FROM records").all()).toHaveLength(1); seen.push("outer-first"); });
      db.transaction(() => { db.exec("INSERT INTO records VALUES (1)"); db.afterCommit(() => { seen.push("inner"); }); });
      db.afterCommit(() => { seen.push("outer-last"); });
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(["outer-first", "inner", "outer-last"]);
  });

  it("discards failed children and their merged grandchildren while a caught outer transaction can commit", () => {
    const db = database(); const seen: string[] = [];
    db.transaction(() => {
      db.afterCommit(() => { seen.push("kept"); });
      expect(() => db.transaction(() => {
        db.transaction(() => { db.afterCommit(() => { seen.push("lost-grandchild"); }); });
        db.afterCommit(() => { seen.push("lost-child"); });
        db.exec("INSERT INTO records VALUES (1)"); throw new Error("inner");
      })).toThrow("inner");
      db.exec("INSERT INTO records VALUES (2)");
    });
    expect(seen).toEqual(["kept"]);
    expect(db.prepare("SELECT id FROM records").all()).toEqual([{ id: 2 }]);
  });

  it("discards callbacks on outer rollback and actual deferred-FK COMMIT failure", () => {
    const db = database(); let calls = 0;
    expect(() => db.transaction(() => {
      db.transaction(() => { db.afterCommit(() => { calls += 1; }); });
      throw new Error("outer");
    })).toThrow("outer");
    db.exec("CREATE TABLE child (parent INTEGER REFERENCES records(id) DEFERRABLE INITIALLY DEFERRED)");
    expect(() => db.transaction(() => { db.exec("INSERT INTO child VALUES (99)"); db.afterCommit(() => { calls += 1; }); })).toThrow();
    expect(calls).toBe(0);
    expect(db.prepare("SELECT * FROM child").all()).toEqual([]);
    db.transaction(() => { db.afterCommit(() => { calls += 1; }); });
    expect(calls).toBe(1);
  });

  it("refuses callback registration after implicit rollback and never leaks frames to another transaction", () => {
    const db = database(); let calls = 0;
    expect(() => db.transaction(() => {
      db.afterCommit(() => { calls += 1; }); db.exec("INSERT INTO records VALUES (1)");
      expect(() => db.transaction(() => { db.exec("INSERT OR ROLLBACK INTO records VALUES (1)"); })).toThrow();
      expect(() => db.afterCommit(() => { calls += 100; })).toThrow("rolled back");
    })).toThrow("rolled back");
    db.transaction(() => { db.afterCommit(() => { calls += 10; }); });
    expect(calls).toBe(10);
  });

  it("isolates callback and diagnostic errors while allowing FIFO reentrant commits", () => {
    const errors: unknown[] = []; const db = database((error) => { errors.push(error); throw new Error("reporter"); });
    const seen: string[] = [];
    expect(() => db.transaction(() => {
      db.exec("INSERT INTO records VALUES (1)");
      db.afterCommit(() => { throw new Error("callback"); });
      db.afterCommit(() => {
        seen.push("first");
        db.transaction(() => { db.exec("INSERT INTO records VALUES (2)"); db.afterCommit(() => { seen.push("reentrant"); }); });
        db.afterCommit(() => { seen.push("outside"); });
      });
      db.afterCommit(() => { seen.push("second"); });
    })).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(seen).toEqual(["first", "second", "reentrant", "outside"]);
    expect(db.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("refuses unmanaged raw transactions rather than prematurely notifying", () => {
    const db = database(); let calls = 0; db.exec("BEGIN");
    expect(() => db.afterCommit(() => { calls += 1; })).toThrow("wrapper-managed");
    db.exec("ROLLBACK"); db.afterCommit(() => { calls += 1; }); expect(calls).toBe(1);
  });
});
