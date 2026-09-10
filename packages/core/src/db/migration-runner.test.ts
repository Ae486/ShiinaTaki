import { afterEach, describe, expect, it } from "vitest";
import { runMigrations, type Migration } from "./migration-runner.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

// A clean wrapper with only the migrations table (empty list = no user migrations applied).
function freshDb(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
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

describe("declarative exact schema branches", () => {
  const branchMigration = (sql: string): Migration => ({
    version: 1,
    sql: "SELECT 1;",
    schemaBranches: [{ name: "known-a", schema: [{ type: "table", name: "a", sql }],
      absentObjects: ["b"], sql: "CREATE TABLE b (id INTEGER)" }],
  });

  it("recognizes keyword case, whitespace and comments while preserving quoted CHECK literals", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER, note TEXT CHECK(note='Value, CHECK('))");
    const migration = branchMigration("create table a /* comment, ) */ ( id integer, note text check (note = 'Value, CHECK(') );");
    expect(runMigrations(db, [migration])).toEqual([1]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='b'").get()?.name).toBe("b");
    expect(runMigrations(db, [migration])).toEqual([]);
  });

  it.each(["'value  Text'", "'Value Text'"])("refuses a distinct quoted CHECK value %s without executing branch SQL", (literal) => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER, note TEXT CHECK(note='Value  Text'))");
    const before = db.prepare("SELECT sql FROM sqlite_schema WHERE name='a'").get();
    const migration = branchMigration(`CREATE TABLE a (id INTEGER, note TEXT CHECK(note=${literal}))`);
    expect(() => runMigrations(db, [migration])).toThrowError(expect.objectContaining({
      cause: expect.objectContaining({ message: expect.stringMatching(/unsupported migration schema lineage/) }),
    }));
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='a'").get()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='b'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("refuses an ambiguous branch set instead of choosing the first match", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER)");
    const migration = branchMigration("CREATE TABLE a (id INTEGER)");
    migration.schemaBranches = [...(migration.schemaBranches ?? []), ...(migration.schemaBranches ?? [])];
    expect(() => runMigrations(db, [migration])).toThrowError(expect.objectContaining({
      cause: expect.objectContaining({ message: expect.stringMatching(/exactly one recognized schema branch/) }),
    }));
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='b'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("does not inspect lower-version schema branches below the recorded max", () => {
    const db = freshDb();
    expect(runMigrations(db, [m2])).toEqual([2]);
    expect(runMigrations(db, [branchMigration("CREATE TABLE a (id INTEGER)"), m2])).toEqual([]);
    expect(db.prepare("SELECT version FROM migrations").all()).toEqual([{ version: 2 }]);
  });

  it("rolls back completed branch DDL if a following column guard refuses", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER)");
    const migration: Migration = { ...branchMigration("CREATE TABLE a (id INTEGER)"),
      ensureNullableTextColumns: [{ table: "b", column: "id" }] };
    expect(() => runMigrations(db, [migration])).toThrowError(/migration 1 failed/);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='b'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });
});

describe("declarative nullable-TEXT column guards", () => {
  const guarded: Migration = {
    version: 1,
    ensureNullableTextColumns: [{ table: "a", column: "detail" }],
    sql: "CREATE INDEX a_detail ON a(detail)",
  };

  it("adds a missing column before SQL in the same migration", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER); INSERT INTO a (id) VALUES (7)");

    expect(runMigrations(db, [guarded])).toEqual([1]);

    expect(db.prepare("SELECT * FROM a").get()).toEqual({ id: 7, detail: null });
    expect(db.prepare("PRAGMA table_info(a)").all().find((column) => column.name === "detail"))
      .toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a_detail'").get()?.name).toBe("a_detail");
  });

  it("accepts an existing compatible column case-insensitively and preserves its bytes", () => {
    const db = freshDb();
    const original = '{ "value": "café 🐈", "empty": "" }\r\n';
    db.exec("CREATE TABLE a (id INTEGER, DETAIL text)");
    db.prepare("INSERT INTO a (id,detail) VALUES (7,:detail)").run({ detail: original });
    const before = db.prepare("SELECT *,hex(CAST(detail AS BLOB)) AS bytes FROM a").get();

    expect(runMigrations(db, [guarded])).toEqual([1]);

    expect(db.prepare("SELECT *,hex(CAST(detail AS BLOB)) AS bytes FROM a").get()).toEqual(before);
    expect(db.prepare("PRAGMA table_info(a)").all()).toHaveLength(2);
  });

  it.each([
    ["non-TEXT type", "INTEGER"],
    ["non-nullable", "TEXT NOT NULL"],
    ["value default", "TEXT DEFAULT ''"],
    ["explicit NULL default", "TEXT DEFAULT NULL"],
    ["primary key", "TEXT PRIMARY KEY"],
    ["virtual generated column", "TEXT GENERATED ALWAYS AS ('computed') VIRTUAL"],
    ["stored generated column", "TEXT GENERATED ALWAYS AS ('computed') STORED"],
    ["value check", "TEXT CHECK (detail IS NOT NULL)"],
    ["unique constraint", "TEXT UNIQUE"],
    ["foreign key", "TEXT REFERENCES a(id)"],
    ["collation", "TEXT COLLATE NOCASE"],
  ])("rejects an incompatible %s without recording a migration", (_label, definition) => {
    const db = freshDb();
    db.exec(`CREATE TABLE a (id INTEGER, detail ${definition})`);
    const before = db.prepare("SELECT sql FROM sqlite_schema WHERE name='a'").get();

    expect(() => runMigrations(db, [guarded])).toThrowError(/migration 1 failed/);

    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='a'").get()).toEqual(before);
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a_detail'").get()).toBeUndefined();
  });

  it("quotes declarative identifiers and binds introspection values", () => {
    const db = freshDb();
    db.exec('CREATE TABLE "odd "" table" (id INTEGER)');
    const migration: Migration = {
      version: 1, sql: "SELECT 1",
      ensureNullableTextColumns: [{ table: 'odd " table', column: 'odd " column' }],
    };

    expect(runMigrations(db, [migration])).toEqual([1]);

    expect(db.prepare("SELECT name,type FROM pragma_table_info(:table) ORDER BY cid").all({ table: 'odd " table' }))
      .toEqual([{ name: "id", type: "INTEGER" }, { name: 'odd " column', type: "TEXT" }]);
  });

  it("refuses a missing table without executing later SQL", () => {
    const db = freshDb();

    expect(() => runMigrations(db, [guarded])).toThrowError(/migration 1 failed/);

    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('a','a_detail')").all()).toEqual([]);
  });

  it.each([
    "UNIQUE(detail)",
    "UNIQUE('detail')",
    "CHECK(detail IS NOT NULL)",
    "FOREIGN KEY(detail) REFERENCES a(id)",
    "FOREIGN KEY('detail') REFERENCES a(id)",
  ])("refuses a table constraint on the guarded column: %s", (constraint) => {
    const db = freshDb();
    db.exec(`CREATE TABLE a (id INTEGER, detail TEXT, ${constraint})`);

    expect(() => runMigrations(db, [guarded])).toThrowError(/migration 1 failed/);

    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a_detail'").get()).toBeUndefined();
  });

  it("refuses an independently created unique index that constrains the guarded column", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER, detail TEXT); CREATE UNIQUE INDEX a_unique_detail ON a(lower(detail))");

    expect(() => runMigrations(db, [guarded])).toThrowError(/migration 1 failed/);

    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("recognizes an existing escaped bare TEXT declaration with comments and quoted delimiters", () => {
    const db = freshDb();
    db.exec(`CREATE TABLE "odd "" table" (
      id INTEGER CHECK (id > 0),
      note TEXT DEFAULT 'odd " column, TEXT)',
      "odd "" column" /* commas, closing ) and constraint words are comments */ "TEXT"
    )`);
    const migration: Migration = {
      version: 1, sql: "SELECT 1",
      ensureNullableTextColumns: [{ table: 'odd " table', column: 'odd " column' }],
    };

    expect(runMigrations(db, [migration])).toEqual([1]);

    expect(db.prepare("SELECT name,type FROM pragma_table_info(:table) ORDER BY cid").all({ table: 'odd " table' }))
      .toEqual([{ name: "id", type: "INTEGER" }, { name: "note", type: "TEXT" }, { name: 'odd " column', type: "TEXT" }]);
  });

  it("does not execute guards below the recorded max, even when that lower receipt is absent", () => {
    const db = freshDb();
    runMigrations(db, [m2]);

    expect(runMigrations(db, [guarded, m2])).toEqual([]);

    expect(db.prepare("SELECT version FROM migrations").all()).toEqual([{ version: 2 }]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a'").get()).toBeUndefined();
  });

  it("rolls back an added column and completed SQL when a later SQL statement fails", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER); INSERT INTO a (id) VALUES (7)");
    const migration: Migration = { ...guarded, sql: "CREATE TABLE b (id INTEGER); NOT SQL;" };

    expect(() => runMigrations(db, [migration])).toThrowError(/migration 1 failed/);

    expect(db.prepare("SELECT * FROM a").get()).toEqual({ id: 7 });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='b'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("rolls back an earlier added column when a later column guard fails", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER); CREATE TABLE b (detail INTEGER)");
    const migration: Migration = {
      ...guarded,
      ensureNullableTextColumns: [{ table: "a", column: "detail" }, { table: "b", column: "detail" }],
    };

    expect(() => runMigrations(db, [migration])).toThrowError(/migration 1 failed/);

    expect(db.prepare("PRAGMA table_info(a)").all().map((column) => column.name)).toEqual(["id"]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a_detail'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("rolls back conditional DDL and SQL when the receipt cannot be committed", () => {
    const db = freshDb();
    db.exec(`CREATE TABLE a (id INTEGER);
      CREATE TRIGGER refuse_receipt BEFORE INSERT ON migrations
      BEGIN SELECT RAISE(ABORT, 'receipt refused'); END;`);

    expect(() => runMigrations(db, [guarded])).toThrowError(/migration 1 failed/);

    expect(db.prepare("PRAGMA table_info(a)").all().map((column) => column.name)).toEqual(["id"]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='a_detail'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
  });

  it("rolls back guarded DDL, data, and the receipt when COMMIT rejects a deferred foreign key", () => {
    const db = freshDb();
    db.exec("CREATE TABLE a (id INTEGER); CREATE TABLE parent (id INTEGER PRIMARY KEY); " +
      "CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
    const migration: Migration = { ...guarded, sql: "INSERT INTO child (parent_id) VALUES (7)" };

    expect(() => runMigrations(db, [migration])).toThrowError(/migration 1 failed/);

    expect(db.prepare("PRAGMA table_info(a)").all().map((column) => column.name)).toEqual(["id"]);
    expect(db.prepare("SELECT * FROM child").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM migrations").all()).toEqual([]);
    db.prepare("INSERT INTO parent (id) VALUES (7)").run();
    expect(runMigrations(db, [migration])).toEqual([1]);
    expect(db.prepare("SELECT * FROM child").all()).toEqual([{ parent_id: 7 }]);
  });
});
