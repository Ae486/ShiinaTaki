import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { ExtensionChangeObserver, ExtensionChangeTarget } from "../extensions/notify-extension-change.ts";
import { createMcpDesiredRepo } from "./mcp-desired-repo.ts";
import { createMcpLifecycleService } from "./mcp-lifecycle-service.ts";
import type { McpManager } from "./mcp-manager.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function harness(onChange?: ExtensionChangeObserver) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  databases.push(db);
  const repo = createMcpDesiredRepo(db, { ownerHostId: OWNER });
  const runtime = {
    tools: () => ({}), snapshot: () => [], describe: () => undefined, statuses: () => [],
    reconcile: vi.fn(), applyDesired: vi.fn(), disableServer: vi.fn(), removeServer: vi.fn(),
    secretCleared: vi.fn(), secretUpdated: vi.fn(), test: vi.fn(), close: vi.fn(),
  } satisfies McpManager;
  const changes: { targets: readonly ExtensionChangeTarget[]; rows: { revision: number; enabled: boolean }[] }[] = [];
  const service = createMcpLifecycleService({ repo, manager: runtime, onChange: (targets) => {
    changes.push({ targets: [...targets], rows: repo.list().map((row) => ({ revision: row.configRevision, enabled: row.enabled })) });
    onChange?.(targets);
  } });
  return { repo, runtime, service, changes };
}

describe("MCP committed desired change observation", () => {
  it("observes every accepted durable mutation, including a disabled add before any runtime work", async () => {
    const h = harness();
    await h.service.add({ serverId: "srv", config: { command: "fixture" }, enabled: false });
    expect(h.runtime.applyDesired).not.toHaveBeenCalled();
    expect(h.changes).toEqual([{ targets: ["mcp"], rows: [{ revision: 1, enabled: false }] }]);

    await h.service.edit({ serverId: "srv", config: { command: "next" }, selectedTools: [], expectedConfigRevision: 1 });
    await h.service.enable({ serverId: "srv", expectedConfigRevision: 2 });
    h.service.disable({ serverId: "srv", expectedConfigRevision: 3 });
    h.service.remove({ serverId: "srv", expectedConfigRevision: 4 });
    expect(h.changes).toEqual([
      { targets: ["mcp"], rows: [{ revision: 1, enabled: false }] },
      { targets: ["mcp"], rows: [{ revision: 2, enabled: false }] },
      { targets: ["mcp"], rows: [{ revision: 3, enabled: true }] },
      { targets: ["mcp"], rows: [{ revision: 4, enabled: false }] },
      { targets: ["mcp"], rows: [] },
    ]);
  });

  it("invalidates the surviving commit before a candidate settles or a later runtime step fails", async () => {
    const h = harness();
    let release = (): void => undefined;
    h.runtime.applyDesired.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const adding = h.service.add({ serverId: "srv", config: { command: "fixture" } });
    expect(h.changes).toEqual([{ targets: ["mcp"], rows: [{ revision: 1, enabled: true }] }]);
    release();
    await adding;

    h.changes.length = 0;
    h.runtime.applyDesired.mockRejectedValueOnce(new Error("post-commit runtime failure"));
    await expect(h.service.edit({ serverId: "srv", config: { command: "replacement" }, selectedTools: [], expectedConfigRevision: 1 }))
      .rejects.toThrow("post-commit runtime failure");
    expect(h.repo.get("srv")?.configRevision).toBe(2);
    expect(h.changes).toEqual([{ targets: ["mcp"], rows: [{ revision: 2, enabled: true }] }]);
  });

  it("does not notify precommit refusals, conflicts, management reads, private Test or unchanged reconnect", async () => {
    const h = harness();
    await h.service.add({ serverId: "srv", config: { command: "fixture" } });
    h.changes.length = 0;
    await expect(h.service.add({ serverId: "srv", config: { command: "fixture" } })).rejects.toMatchObject({ reason: "duplicate-server" });
    await expect(h.service.edit({ serverId: "srv", config: { command: "next" }, selectedTools: [], expectedConfigRevision: 9 })).rejects.toThrow();
    expect(() => h.service.remove({ serverId: "missing", expectedConfigRevision: 1 })).toThrow();
    h.service.list(); h.service.get({ serverId: "srv" }); h.service.statuses();
    await h.service.test({ serverId: "srv" });
    await h.service.reconnect({ serverId: "srv" });
    expect(h.changes).toEqual([]);
  });

  it("keeps committed results and subsequent mutations independent of a throwing observer", async () => {
    const h = harness(() => { throw new Error("observer failure"); });
    await expect(h.service.add({ serverId: "srv", config: { command: "fixture" }, enabled: false })).resolves.toMatchObject({ configRevision: 1 });
    await expect(h.service.enable({ serverId: "srv", expectedConfigRevision: 1 })).resolves.toMatchObject({ configRevision: 2 });
    expect(h.changes).toHaveLength(2);
    expect(h.runtime.applyDesired).toHaveBeenCalledTimes(1);
  });
});
