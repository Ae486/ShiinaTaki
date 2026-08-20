import { afterEach, describe, expect, it } from "vitest";
import type { Migration } from "../migration-runner.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { canonicalMemoryMigration017 } from "./017-canonical-memory.ts";
import { mcpDesiredServersMigration018 } from "./018-mcp-desired-servers.ts";
import { skillPackagesMigration019 } from "./019-skill-packages.ts";
import { parallelFoundationConvergenceMigration020 } from "./020-parallel-foundation-convergence.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

function tableExists(db: Database, name: string): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=:name").get({ name }) !== undefined;
}

describe("parallelFoundationConvergenceMigration020", () => {
  it("repairs the historical T4 lineage where versions 17 and 18 meant MCP and Skill", () => {
    const db = open();
    const legacyT4: Migration[] = [
      { version: 17, sql: mcpDesiredServersMigration018.sql },
      { version: 18, sql: skillPackagesMigration019.sql },
    ];
    expect(runMigrations(db, legacyT4)).toEqual([17, 18]);
    expect(runMigrations(db, [skillPackagesMigration019, parallelFoundationConvergenceMigration020])).toEqual([19, 20]);
    expect(tableExists(db, "mcp_desired_servers")).toBe(true);
    expect(tableExists(db, "skill_packages")).toBe(true);
    expect(tableExists(db, "canonical_memory_units")).toBe(true);
  });

  it("is a no-op schema bridge after the historical Main canonical-memory migration", () => {
    const db = open();
    expect(runMigrations(db, [canonicalMemoryMigration017])).toEqual([17]);
    expect(runMigrations(db, [mcpDesiredServersMigration018, skillPackagesMigration019, parallelFoundationConvergenceMigration020])).toEqual([18, 19, 20]);
    expect(tableExists(db, "mcp_desired_servers")).toBe(true);
    expect(tableExists(db, "skill_packages")).toBe(true);
    expect(tableExists(db, "canonical_memory_units")).toBe(true);
  });
});
