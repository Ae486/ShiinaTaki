import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";
import { openDatabase, type Database } from "../sqlite.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(migrations = MIGRATIONS): Database {
  const db = openDatabase({ path: ":memory:", migrations }); dbs.push(db); return db;
}

describe("migration 050 reviewed deployment mode", () => {
  it("applies on a database at 049 and leaves the legacy connection row with a NULL reviewed mode", () => {
    const db = open(MIGRATIONS.slice(0, 49));
    db.exec(`UPDATE hindsight_connection_state SET revision=3, phase='configured', config_fingerprint='${"a".repeat(64)}' WHERE singleton=1`);
    const before = db.prepare("SELECT * FROM hindsight_connection_state").get();
    db.exec(MIGRATIONS[49]!.sql);
    expect(db.prepare("SELECT * FROM hindsight_connection_state").get()).toEqual({ ...before, reviewed_deployment_mode: null });
  });

  it("accepts only the Shared deployment modes", () => {
    const db = open();
    const set = db.prepare("UPDATE hindsight_connection_state SET reviewed_deployment_mode=:mode WHERE singleton=1");
    for (const mode of ["existing-instance", "managed-helper", null]) expect(() => set.run({ mode })).not.toThrow();
    expect(() => set.run({ mode: "docker" })).toThrow(/CHECK/);
  });
});
