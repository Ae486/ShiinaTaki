import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";
import { openDatabase, type Database } from "../sqlite.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(migrations = MIGRATIONS): Database {
  const db = openDatabase({ path: ":memory:", migrations }); dbs.push(db); return db;
}

const insert = `INSERT INTO memory_operations (operation_id,kind,family,state,reason,authority_epoch_id,request_json,producer_json,
  result_json,error_code,owner_boot_id,created_at,updated_at,terminal_at)
  VALUES (:id,'replica.sync',:family,:state,NULL,NULL,'{"kind":"replica.sync"}',NULL,NULL,NULL,'boot','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z',:terminal)`;

describe("migration 048 memory operations", () => {
  it("applies on a fresh database and on a database at 047", () => {
    expect(open().prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(55);
    const upgraded = open(MIGRATIONS.slice(0, 47));
    expect(upgraded.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(47);
    upgraded.exec(MIGRATIONS[47]!.sql);
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_operations'").get()).toBeDefined();
  });

  it("allows one active operation per family and any number of terminal ones", () => {
    const db = open();
    db.prepare(insert).run({ id: "a", family: "replica:global", state: "running", terminal: null });
    expect(() => db.prepare(insert).run({ id: "b", family: "replica:global", state: "admitted", terminal: null })).toThrow(/UNIQUE/);
    db.prepare(insert).run({ id: "c", family: "replica:global", state: "completed", terminal: "2026-09-19T00:01:00.000Z" });
    db.prepare(insert).run({ id: "d", family: "replica:global", state: "failed", terminal: "2026-09-19T00:02:00.000Z" });
    db.prepare(insert).run({ id: "e", family: "replica:character", state: "admitted", terminal: null });
    expect(db.prepare("SELECT count(*) AS n FROM memory_operations").get()?.n).toBe(4);
    expect(() => db.prepare("UPDATE memory_operations SET request_json='not json' WHERE operation_id='a'").run()).toThrow();
  });
});
