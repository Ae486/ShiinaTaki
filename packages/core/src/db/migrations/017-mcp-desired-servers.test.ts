import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { mcpDesiredServersMigration017 } from "./017-mcp-desired-servers.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(): Database {
  const db = openDatabase({ path: ":memory:", migrations: [] });
  dbs.push(db);
  return db;
}

const ROW = {
  server_id: "github",
  owner_host_id: "11111111-1111-4111-8111-111111111111",
  config: '{"command":"node"}',
  enabled: 1,
  selected_tools: "[]",
  config_revision: 1,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

describe("mcpDesiredServersMigration017", () => {
  it("creates the desired-server table and accepts a sanitized row", () => {
    const db = open();
    runMigrations(db, [mcpDesiredServersMigration017]);
    expect(() =>
      db.prepare(
        "INSERT INTO mcp_desired_servers (server_id, owner_host_id, config, enabled, selected_tools, config_revision, created_at, updated_at) VALUES (:server_id, :owner_host_id, :config, :enabled, :selected_tools, :config_revision, :created_at, :updated_at)",
      ).run(ROW),
    ).not.toThrow();
    expect(db.prepare("SELECT server_id, enabled, config_revision FROM mcp_desired_servers").get()).toEqual({
      server_id: "github",
      enabled: 1,
      config_revision: 1,
    });
  });

  it("enforces STRICT/CHECK: non-integer enabled, zero revision, and duplicate ids are rejected", () => {
    const db = open();
    runMigrations(db, [mcpDesiredServersMigration017]);
    const insert = db.prepare(
      "INSERT INTO mcp_desired_servers (server_id, owner_host_id, config, enabled, selected_tools, config_revision, created_at, updated_at) VALUES (:server_id, :owner_host_id, :config, :enabled, :selected_tools, :config_revision, :created_at, :updated_at)",
    );
    expect(() => insert.run({ ...ROW, enabled: "yes" })).toThrow(); // STRICT: TEXT into INTEGER
    expect(() => insert.run({ ...ROW, enabled: 2 })).toThrow(); // CHECK: not 0/1
    expect(() => insert.run({ ...ROW, config_revision: 0 })).toThrow(); // CHECK: positive
    expect(() => insert.run(ROW)).not.toThrow();
    expect(() => insert.run({ ...ROW })).toThrow(); // PRIMARY KEY uniqueness
  });

  it("is applied once across a reopen-style migration pass", () => {
    const db = open();
    expect(runMigrations(db, [mcpDesiredServersMigration017])).toEqual([17]);
    expect(runMigrations(db, [mcpDesiredServersMigration017])).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM mcp_desired_servers").get()).toEqual({ n: 0 });
  });
});
