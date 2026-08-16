import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { McpConfigConflictError, createMcpDesiredRepo } from "./mcp-desired-repo.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): ReturnType<typeof createMcpDesiredRepo> {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createMcpDesiredRepo(db, { ownerHostId: OWNER });
}

function tempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-desired-seed-"));
  dirs.push(dir);
  const path = join(dir, "mcp-servers.json");
  writeFileSync(path, body);
  return path;
}

const STDIO = { command: "node", args: ["server.mjs"], env: { TOKEN: "secret-ref:mcp.demo.env.TOKEN" } };

describe("mcp desired repo", () => {
  it("adds, lists, and round-trips a sanitized row starting at revision 1", () => {
    const repo = makeRepo();
    repo.add({ serverId: "demo", config: STDIO, selectedTools: [], enabled: true });
    const row = repo.get("demo");
    expect(row).toMatchObject({
      serverId: "demo",
      ownerHostId: OWNER,
      enabled: true,
      configRevision: 1,
      selectedTools: [],
    });
    expect(row?.config).toEqual(STDIO);
    expect(repo.list().map((server) => server.serverId)).toEqual(["demo"]);
    expect(repo.get("missing")).toBeNull();
  });

  it("edit and setEnabled increment the revision exactly once per accepted write", () => {
    const repo = makeRepo();
    repo.add({ serverId: "demo", config: STDIO, selectedTools: [], enabled: true });
    const edited = repo.edit({
      serverId: "demo", config: { url: "https://mcp.example" }, selectedTools: ["echo"], expectedConfigRevision: 1,
    });
    expect(edited.configRevision).toBe(2);
    expect(edited.config).toEqual({ url: "https://mcp.example" });
    const disabled = repo.setEnabled({ serverId: "demo", enabled: false, expectedConfigRevision: 2 });
    expect(disabled.enabled).toBe(false);
    expect(disabled.configRevision).toBe(3);
  });

  it("a stale expectedConfigRevision refuses with the current revision (two-window base case)", () => {
    const repo = makeRepo();
    repo.add({ serverId: "demo", config: STDIO, selectedTools: [], enabled: true });
    repo.edit({ serverId: "demo", config: { command: "node" }, selectedTools: [], expectedConfigRevision: 1 }); // window B wins
    expect(() =>
      repo.edit({ serverId: "demo", config: { command: "deno" }, selectedTools: [], expectedConfigRevision: 1 })
    ).toThrow(McpConfigConflictError);
    try {
      repo.setEnabled({ serverId: "demo", enabled: false, expectedConfigRevision: 1 });
      expect.unreachable("conflict must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(McpConfigConflictError);
      expect((error as McpConfigConflictError).currentConfigRevision).toBe(2);
    }
    // The refused write mutated nothing.
    expect(repo.get("demo")).toMatchObject({ configRevision: 2, enabled: true });
  });

  it("remove deletes the row under the optimistic revision", () => {
    const repo = makeRepo();
    repo.add({ serverId: "demo", config: STDIO, selectedTools: [], enabled: true });
    repo.remove({ serverId: "demo", expectedConfigRevision: 1 });
    expect(repo.get("demo")).toBeNull();
    expect(() => repo.remove({ serverId: "demo", expectedConfigRevision: 1 })).toThrow(McpConfigConflictError);
  });
});

describe("legacy mcp-servers.json seed", () => {
  it("seeds a fully marker-migrated file once, then never again (table-not-empty)", () => {
    const repo = makeRepo();
    const path = tempFile(JSON.stringify({ demo: STDIO }, null, 2));
    const { logger } = createCaptureLogger();
    expect(repo.seedFromLegacyFile(path, logger)).toEqual({ status: "seeded", servers: 1 });
    expect(repo.get("demo")).toMatchObject({ serverId: "demo", enabled: true, configRevision: 1, config: STDIO });
    // A later hand-edit of the legacy file is inert: the table is authoritative now.
    writeFileSync(path, JSON.stringify({ other: { command: "node" } }, null, 2));
    expect(repo.seedFromLegacyFile(path, logger)).toEqual({ status: "skipped", reason: "table-not-empty" });
    expect(repo.list().map((server) => server.serverId)).toEqual(["demo"]);
  });

  it("defers the seed when plaintext values remain (locked catalog boot) so a later boot can retry", () => {
    const repo = makeRepo();
    const path = tempFile(JSON.stringify({ demo: { command: "node", env: { TOKEN: "plaintext-sentinel" } } }, null, 2));
    const { logger } = createCaptureLogger();
    expect(repo.seedFromLegacyFile(path, logger)).toEqual({ status: "skipped", reason: "not-migrated" });
    expect(repo.list()).toEqual([]);
    // Next boot: the file has been rewritten to markers — the seed now succeeds.
    writeFileSync(path, JSON.stringify({ demo: STDIO }, null, 2));
    expect(repo.seedFromLegacyFile(path, logger)).toEqual({ status: "seeded", servers: 1 });
  });

  it("a missing or malformed file is a normal empty state; an unstable key is skipped permanently", () => {
    const repo = makeRepo();
    const { logger, records } = createCaptureLogger();
    expect(repo.seedFromLegacyFile(join(tmpdir(), "definitely-missing-mcp.json"), logger)).toEqual({
      status: "skipped",
      reason: "no-config",
    });
    const path = tempFile(JSON.stringify({ "demo.key": STDIO, demo: STDIO }, null, 2));
    expect(repo.seedFromLegacyFile(path, logger)).toEqual({ status: "seeded", servers: 1 });
    expect(repo.get("demo.key")).toBeNull();
    expect(records.some((record) => record.level === "warn" && JSON.stringify(record.obj).includes("demo.key"))).toBe(true);
  });
});
