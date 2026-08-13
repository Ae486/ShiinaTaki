import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { governancePolicyMigration014 } from "./014-governance-policy.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

describe("governancePolicyMigration014", () => {
  it("creates the standard generation-1 singleton and strict override table", () => {
    const db = open();
    runMigrations(db, [governancePolicyMigration014]);
    expect(db.prepare("SELECT level, policy_generation, registry_revision FROM governance_policy").get()).toEqual({
      level: "standard", policy_generation: 1, registry_revision: 1,
    });
    expect(() => db.prepare("INSERT INTO governance_cell_overrides VALUES ('x','standard','allow',1,'t')").run()).toThrow();
  });

  it("is applied once across a reopen-style migration pass", () => {
    const db = open();
    expect(runMigrations(db, [governancePolicyMigration014])).toEqual([14]);
    expect(runMigrations(db, [governancePolicyMigration014])).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM governance_policy").get()).toEqual({ n: 1 });
  });
});
