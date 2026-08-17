import { describe, expect, it, vi } from "vitest";
import type { McpListResult } from "@taki/shared";
import { createMcpController, type McpPageClient } from "./mcp-controller.ts";
import { emptyDraft, type McpServerDraft } from "./mcp-state.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HOST = "11111111-1111-4111-8111-111111111111";

function servers(...ids: string[]): McpListResult {
  return {
    servers: ids.map((serverId, index) => ({
      serverId,
      ownerHostId: HOST,
      config: { command: "node" },
      enabled: true,
      selectedTools: [],
      configRevision: index + 1,
      createdAt: NOW,
      updatedAt: NOW,
      status: { serverId, phase: "connected" as const, runtimeGeneration: 1, leaseCount: 0, toolCount: 1, lastOutcome: null },
    })),
  };
}

function client(behavior: Partial<Record<keyof McpPageClient, (...args: unknown[]) => unknown>>): McpPageClient & { calls: string[] } {
  const calls: string[] = [];
  const base = {
    mcpList: async () => { calls.push("mcpList"); return servers("github"); },
    mcpAdd: async () => { calls.push("mcpAdd"); return { server: servers("github", "added").servers[1]! }; },
    mcpEdit: async () => { calls.push("mcpEdit"); return { server: servers("github").servers[0]! }; },
    mcpEnable: async () => { calls.push("mcpEnable"); return { server: servers("github").servers[0]! }; },
    mcpDisable: async () => { calls.push("mcpDisable"); return { server: servers("github").servers[0]! }; },
    mcpRemove: async () => { calls.push("mcpRemove"); return { status: "removed" as const, serverId: "github" }; },
    mcpTest: async () => { calls.push("mcpTest"); return { status: "ok" as const, toolNames: ["echo"], skipped: [], pages: 1, durationMs: 5 }; },
    mcpReconnect: async () => { calls.push("mcpReconnect"); return { server: servers("github").servers[0]! }; },
    secretSet: async () => { calls.push("secretSet"); return {
      secretRef: "mcp.d.env.K", present: true,
      provenance: { source: "catalog" as const, keyVersion: 1, updatedAt: NOW }, health: "ok" as const,
    }; },
    ...behavior,
  } as McpPageClient;
  return Object.assign(base, { calls });
}

describe("mcp controller", () => {
  it("loads on replace and ignores results from a retired client generation", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const first = client({});
    controller.replace(first);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sink.loaded).toHaveBeenCalledWith(servers("github").servers, undefined);

    // Retire, then let a late read from the OLD client land: it must be dropped.
    controller.replace(null);
    sink.loaded.mockClear();
    await first.mcpList();
    expect(sink.loaded).not.toHaveBeenCalled();
  });

  it("stores secret values via secret.set BEFORE the desired add carries only markers", async () => {
    const order: string[] = [];
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const draft: McpServerDraft = {
      ...emptyDraft(), serverId: "d", command: "node",
      fields: [{ id: 1, name: "K", value: "sentinel-value", storedSecretRef: null }],
    };
    const seenConfig: unknown[] = [];
    const stub = client({
      mcpAdd: async (params: unknown) => {
        order.push("mcpAdd");
        seenConfig.push((params as { config: { env: Record<string, string> } }).config.env);
        return { server: servers("d").servers[0]! };
      },
      secretSet: async () => {
        order.push("secretSet");
        return {
          secretRef: "mcp.d.env.K", present: true,
          provenance: { source: "catalog" as const, keyVersion: 1, updatedAt: NOW }, health: "ok" as const,
        };
      },
    });
    controller.replace(stub);
    await controller.add(draft);
    expect(order).toEqual(["secretSet", "mcpAdd"]); // the value is stored BEFORE the desired write
    expect(seenConfig[0]).toEqual({ K: "secret-ref:mcp.d.env.K" }); // markers only — never the value
  });

  it("refetches Core truth after MCP_CONFIG_CONFLICT and never replays the write", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    let attempts = 0;
    let secretWrites = 0;
    const stub = client({
      mcpEdit: async () => {
        attempts += 1;
        throw Object.assign(new Error("conflict"), { data: { code: "MCP_CONFIG_CONFLICT", currentConfigRevision: 7 } });
      },
      secretSet: async () => {
        secretWrites += 1;
        throw new Error("must not run");
      },
    });
    controller.replace(stub);
    await controller.edit({
      ...emptyDraft(),
      serverId: "github",
      command: "node",
      fields: [{ id: 1, name: "TOKEN", value: "new-value", storedSecretRef: "mcp.github.env.TOKEN" }],
    }, 1);
    expect(attempts).toBe(1); // one explicit attempt, zero automatic replay
    expect(secretWrites).toBe(0); // optimistic desired revision is checked before rotating a live secret
    expect(sink.mutationFailed).toHaveBeenCalledTimes(1);
    expect(sink.loaded).toHaveBeenCalled(); // the conflict refetch repopulated Core truth
    const last = sink.loaded.mock.calls.at(-1)?.[1];
    expect(last).toMatchObject({ kind: "conflict" });
  });

  it("reports a committed revision and keeps an error feedback when post-edit secret rotation fails", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const committed = { ...servers("github").servers[0]!, configRevision: 8 };
    const stub = client({
      mcpEdit: async () => ({ server: committed }),
      secretSet: async () => {
        throw new Error("catalog locked");
      },
    });
    controller.replace(stub);
    const result = await controller.edit({
      ...emptyDraft(),
      serverId: "github",
      command: "node",
      fields: [{ id: 1, name: "TOKEN", value: "new-value", storedSecretRef: "mcp.github.env.TOKEN" }],
    }, 7);
    expect(result).toEqual({ ok: false, committedRevision: 8 });
    expect(sink.mutationFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "catalog locked" }));
    expect(sink.loaded.mock.calls.at(-1)?.[1]).toMatchObject({ kind: "error" });
  });

  it("renders test outcome facts and does not report a failed candidate as success", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const stub = client({
      mcpTest: async () => ({
        status: "failed" as const,
        reason: "connect-failed" as const,
        message: "MCP server connection failed",
        toolNames: [],
        skipped: [],
        pages: 0,
        durationMs: 0,
      }),
    });
    controller.replace(stub);
    await controller.test("github");
    expect(sink.loaded.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "test-failed",
      message: expect.stringContaining("测试失败"),
    });
  });

  it("serializes mutations: a second call while one is in flight is dropped", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    let released = false;
    let disableCalls = 0;
    const gate = new Promise<void>((resolve) => {
      setTimeout(() => {
        released = true;
        resolve();
      }, 10);
    });
    const stub = client({
      mcpDisable: async () => {
        disableCalls += 1;
        await gate;
        return { server: servers("github").servers[0]! };
      },
    });
    controller.replace(stub);
    const first = controller.setEnabled({ serverId: "github", enabled: false, expectedRevision: 1 });
    await controller.setEnabled({ serverId: "github", enabled: false, expectedRevision: 1 }); // dropped
    await first;
    expect(released).toBe(true);
    expect(disableCalls).toBe(1);
  });

  it("dispose freezes the controller: later results and mutations never land", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(client({}));
    await new Promise((resolve) => setImmediate(resolve));
    controller.dispose();
    sink.loaded.mockClear();
    await controller.refresh();
    expect(sink.loaded).not.toHaveBeenCalled();
  });
});
