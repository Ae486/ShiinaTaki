import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database, type SqlStatement } from "../db/sqlite.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createMcpDesiredRepo } from "./mcp-desired-repo.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const input = { serverId: "srv", config: { command: "fixture" }, selectedTools: [], enabled: false };
const databases: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  let readBack: SqlStatement | undefined;
  const repo = createMcpDesiredRepo({ ...db, prepare(sql) {
    const statement = db.prepare(sql);
    if (sql.startsWith("SELECT server_id") && sql.includes("WHERE server_id")) readBack = statement;
    return statement;
  } }, { ownerHostId: OWNER });
  return { repo, readBack: readBack! };
}

describe("MCP actual SQLite commit observation", () => {
  it.each(["add", "edit", "enable"] as const)("observes a committed %s before its projection read-back fails", (operation) => {
    const { repo, readBack } = fixture();
    if (operation !== "add") repo.add(input);
    const observedRevisions: number[][] = [];
    const committed = vi.fn(() => { observedRevisions.push(repo.list().map((row) => row.configRevision)); });
    vi.spyOn(readBack, "get").mockImplementationOnce(() => { throw new Error("projection read-back failed"); });
    const run = () => {
      if (operation === "add") return repo.add(input, committed);
      if (operation === "edit") return repo.edit({ ...input, config: { command: "next" }, expectedConfigRevision: 1 }, committed);
      return repo.setEnabled({ serverId: "srv", enabled: true, expectedConfigRevision: 1 }, committed);
    };
    expect(run).toThrow("projection read-back failed");
    expect(committed).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(observedRevisions).toEqual([[operation === "add" ? 1 : 2]]);
    expect(repo.get("srv")).toMatchObject({ configRevision: operation === "add" ? 1 : 2 });
  });

  it("does not report refused or rolled-back writes and observes an actual removal once", () => {
    const { repo } = fixture(); const committed = vi.fn();
    repo.add(input);
    expect(() => repo.add(input, committed)).toThrow();
    expect(() => repo.edit({ ...input, expectedConfigRevision: 9 }, committed)).toThrow();
    expect(() => repo.remove({ serverId: "srv", expectedConfigRevision: 9 }, committed)).toThrow();
    expect(committed).not.toHaveBeenCalled();
    repo.remove({ serverId: "srv", expectedConfigRevision: 1 }, committed);
    expect(committed).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(repo.list()).toEqual([]);
  });

  it("observes a seed before a post-commit logger failure and stays silent for skipped seeds", () => {
    const { repo } = fixture(); const root = mkdtempSync(join(tmpdir(), "mcp-seed-change-")); roots.push(root);
    const path = join(root, "mcp-servers.json"); const { logger } = createCaptureLogger(); const committed = vi.fn();
    writeFileSync(path, "{}");
    repo.seedFromLegacyFile(path, logger, committed);
    expect(committed).not.toHaveBeenCalled();
    writeFileSync(path, JSON.stringify({ srv: { command: "fixture" } }));
    vi.spyOn(logger, "info").mockImplementationOnce(() => { throw new Error("post-commit logging failed"); });
    expect(() => repo.seedFromLegacyFile(path, logger, committed)).toThrow("post-commit logging failed");
    expect(committed).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(repo.list()).toHaveLength(1);
    repo.seedFromLegacyFile(path, logger, committed);
    expect(committed).toHaveBeenCalledTimes(1);
  });
});
