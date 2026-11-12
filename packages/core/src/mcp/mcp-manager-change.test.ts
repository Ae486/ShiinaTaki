import { createMCPClient } from "@ai-sdk/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerStatus } from "@taki/shared";
import type { ExtensionChangeObserver, ExtensionChangeTarget } from "../extensions/notify-extension-change.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { AsyncCallTransport, InMemoryTransport, memConnect, type CallHandler } from "../testing/mcp-test-transport.ts";
import type { McpClient, McpConnect } from "./mcp-connect.ts";
import { createMcpManager, type McpDesiredRuntime, type McpManager } from "./mcp-manager.ts";

const TOOL = { name: "echo", inputSchema: { type: "object" } };
const SEARCH = { name: "search", inputSchema: { type: "object" } };
const echo: CallHandler = (message) => ({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "done" }] } });
const managers: McpManager[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
});

function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  releases.push(release);
  return { promise, release };
}

function desired(command = "fixture"): McpDesiredRuntime {
  return { serverId: "srv", ownerHostId: "11111111-1111-4111-8111-111111111111", configRevision: 1, config: { command }, selectedTools: [], enabled: true };
}

interface Observation { targets: readonly ExtensionChangeTarget[]; statuses: McpServerStatus[]; }
function harness(connect: McpConnect, observer?: ExtensionChangeObserver) {
  const changes: Observation[] = [];
  const manager = createMcpManager({
    logger: createCaptureLogger().logger, connect, resolveSecret: () => "fixture-only",
    candidateDeadlineMs: 2_000, drainBudgetMs: 2_000, shutdownBudgetMs: 50,
    onChange: (targets) => { changes.push({ targets: [...targets], statuses: manager.statuses() }); observer?.(targets); },
  });
  managers.push(manager);
  return { manager, changes };
}

function phases(changes: Observation[]) {
  return changes.map(({ targets, statuses }) => ({ targets, phase: statuses[0]?.phase, count: statuses[0]?.toolCount, outcome: statuses[0]?.lastOutcome?.status ?? null }));
}

describe("MCP runtime change producers", () => {
  it("observes candidate ownership, active publication and coherent final outcome/removal", async () => {
    const transport = new InMemoryTransport([TOOL], echo);
    const connect = vi.fn((entry: Parameters<McpConnect>[0]) => {
      if ("command" in entry.config && entry.config.command === "fail") return Promise.reject(new Error("private connection detail"));
      return createMCPClient({ transport });
    });
    const { manager, changes } = harness(connect);
    await manager.applyDesired(desired());
    expect(phases(changes)).toEqual([
      { targets: ["mcp"], phase: "connecting", count: 0, outcome: null },
      { targets: ["mcp", "extension-status"], phase: "connecting", count: 1, outcome: null },
      { targets: ["mcp"], phase: "connected", count: 1, outcome: "published" },
    ]);
    changes.length = 0;
    await manager.applyDesired({ ...desired("fail"), configRevision: 2 });
    expect(phases(changes)).toEqual([
      { targets: ["mcp"], phase: "connecting", count: 1, outcome: "published" },
      { targets: ["mcp"], phase: "connected", count: 1, outcome: "failed" },
    ]);
    expect(JSON.stringify(changes)).not.toContain("private connection detail");
    expect(transport.closedCount).toBe(0);
  });

  it("keeps superseded candidates and their delayed cleanup from notifying a new current result", async () => {
    const blocked = gate();
    const old = new InMemoryTransport([TOOL], echo);
    const current = new InMemoryTransport([SEARCH], echo);
    const { manager, changes } = harness(async (entry) => {
      const isOld = "command" in entry.config && entry.config.command === "old";
      if (isOld) await blocked.promise;
      return createMCPClient({ transport: isOld ? old : current });
    });
    const pending = manager.applyDesired(desired("old"));
    await manager.applyDesired({ ...desired("new"), configRevision: 2 });
    await pending;
    expect(phases(changes)).toEqual([
      { targets: ["mcp"], phase: "connecting", count: 0, outcome: null },
      { targets: ["mcp"], phase: "connecting", count: 0, outcome: null },
      { targets: ["mcp", "extension-status"], phase: "connecting", count: 1, outcome: null },
      { targets: ["mcp"], phase: "connected", count: 1, outcome: "published" },
    ]);
    changes.length = 0;
    blocked.release();
    await vi.waitFor(() => expect(old.closedCount).toBe(1));
    expect(changes).toEqual([]);
    expect(manager.snapshot()[0]?.configRevision).toBe(2);
    expect(current.closedCount).toBe(0);
  });

  it("observes the displayed draining fallback closing while a replacement candidate is still connecting", async () => {
    const callGate = gate(); const closeGate = gate(); const candidateGate = gate();
    const old = new AsyncCallTransport([TOOL], async (message) => { await callGate.promise; return echo(message); });
    const replacement = new InMemoryTransport([SEARCH], echo);
    let client: McpClient | undefined;
    let connects = 0;
    const { manager, changes } = harness(async () => {
      connects += 1;
      if (connects > 1) { await candidateGate.promise; return createMCPClient({ transport: replacement }); }
      client = await createMCPClient({ transport: old });
      const close = client.close.bind(client);
      vi.spyOn(client, "close").mockImplementation(async () => { await closeGate.promise; await close(); });
      return client;
    });
    const input = { ...desired(), config: { command: "fixture", env: { TOKEN: "secret-ref:mcp.srv.env.TOKEN" } } };
    await manager.applyDesired(input);
    const captured = manager.snapshot()[0]!;
    const running = captured.tool.execute!({}, { toolCallId: "held", messages: [], context: undefined });
    await new Promise((resolve) => setImmediate(resolve));
    expect(manager.statuses()[0]?.leaseCount).toBe(1);
    manager.secretCleared("mcp.srv.env.TOKEN");
    expect(manager.statuses()[0]?.phase).toBe("draining");
    manager.secretUpdated("mcp.srv.env.TOKEN");
    expect(manager.statuses()[0]).toMatchObject({ phase: "connecting", toolCount: 1 });
    changes.length = 0;
    callGate.release();
    await running;
    expect(phases(changes)).toEqual([{ targets: ["mcp"], phase: "connecting", count: 0, outcome: "failed" }]);
    expect(client!.close).toHaveBeenCalledTimes(1);
    expect(old.closedCount).toBe(0);
    expect(captured.isCurrent()).toBe(false);
    closeGate.release();
    await vi.waitFor(() => expect(old.closedCount).toBe(1));
    expect(changes).toHaveLength(1);
    candidateGate.release();
    await vi.waitFor(() => expect(manager.statuses()[0]?.phase).toBe("connected"));
    expect(phases(changes).slice(-2)).toEqual([
      { targets: ["mcp", "extension-status"], phase: "connecting", count: 1, outcome: "failed" },
      { targets: ["mcp"], phase: "connected", count: 1, outcome: "published" },
    ]);
    expect(connects).toBe(2);
  });

  it("does not turn management reads, ordinary tool leases or a private Test into shared changes", async () => {
    const live = new InMemoryTransport([TOOL], echo); const test = new InMemoryTransport([SEARCH], echo);
    const connect = vi.fn(memConnect(new Map([["srv", live], ["probe", test]])));
    const { manager, changes } = harness(connect);
    manager.statuses(); manager.tools(); manager.snapshot();
    expect(connect).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    await manager.applyDesired(desired());
    changes.length = 0;
    await manager.tools().srv_echo!.execute!({}, { toolCallId: "ordinary", messages: [], context: undefined });
    await expect(manager.test({ serverId: "probe", config: { command: "private-test" }, selectedTools: [] })).resolves.toMatchObject({ status: "ok" });
    manager.describe("srv_echo"); manager.statuses(); manager.snapshot();
    expect(changes).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(live.closedCount).toBe(0);
    expect(test.closedCount).toBe(1);
  });

  it("covers boot reconciliation and disabled tracking without running a connection for the disabled entry", async () => {
    const transport = new InMemoryTransport([TOOL], echo);
    const connect = vi.fn(memConnect(new Map([["srv", transport]])));
    const { manager, changes } = harness(connect);
    await manager.reconcile([desired(), { ...desired(), serverId: "off", enabled: false }]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(manager.statuses().find((status) => status.serverId === "off")?.phase).toBe("disabled");
    expect(changes.some((change) => change.statuses.some((status) => status.serverId === "off" && status.phase === "disabled"))).toBe(true);
    expect(changes.some((change) => change.targets.includes("extension-status"))).toBe(true);
  });

  it("does not let a throwing observer change lifecycle outcomes or prevent later notifications", async () => {
    const transport = new InMemoryTransport([TOOL], echo);
    const observer = vi.fn(() => { throw new Error("observer failed"); });
    const { manager } = harness(memConnect(new Map([["srv", transport]])), observer);
    await expect(manager.applyDesired(desired())).resolves.toMatchObject({ status: "published" });
    expect(() => manager.disableServer({ ...desired(), enabled: false, configRevision: 2 })).not.toThrow();
    expect(manager.tools()).toEqual({});
    expect(observer.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(transport.closedCount).toBe(1);
  });
});
