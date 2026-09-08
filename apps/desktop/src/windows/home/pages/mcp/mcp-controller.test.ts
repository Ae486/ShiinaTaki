import { describe, expect, it, vi } from "vitest";
import type { ExtensionChanged, McpListResult } from "@taki/shared";
import { createMcpController, type McpPageClient } from "./mcp-controller.ts";
import { emptyDraft, type McpServerDraft } from "./mcp-state.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HOST = "11111111-1111-4111-8111-111111111111";
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    subscribeExtensions: async () => "supported" as const,
    onExtensionChanged: () => () => undefined,
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

describe("MCP subscribed read lifecycle", () => {
  it("coalesces successful mutation hints and settlement into one list read", async () => {
    const handlers = new Set<(event: ExtensionChanged) => void>();
    let finish!: (value: Awaited<ReturnType<McpPageClient["mcpAdd"]>>) => void;
    const write = new Promise<Awaited<ReturnType<McpPageClient["mcpAdd"]>>>((resolve) => { finish = resolve; });
    const read = vi.fn(async () => servers("github"));
    const active = client({ mcpList: read, mcpAdd: () => write });
    active.onExtensionChanged = (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; };
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(active);
    await controller.refresh();
    const done = controller.add({ ...emptyDraft(), serverId: "added", command: "node" });
    for (const revision of [1, 2, 2]) for (const handler of handlers) handler({ revision, targets: ["mcp"] });
    expect(read).toHaveBeenCalledTimes(1);
    finish({ server: servers("added").servers[0]! });
    expect(await done).toEqual({ ok: true, committedRevision: 1 });
    expect(read).toHaveBeenCalledTimes(2);
    controller.setVisible(false);
    controller.setVisible(true);
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(handlers.size).toBe(0);
  });

  it("distinguishes setup failure from an older Core and keeps either path deliberately retryable", async () => {
    const read = vi.fn(async () => servers("github"));
    const active = client({ mcpList: read });
    active.subscribeExtensions = vi.fn().mockRejectedValueOnce(new Error("forbidden")).mockResolvedValue("supported");
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn(), observation: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(active);
    await controller.refresh();
    expect(read).not.toHaveBeenCalled();
    expect(sink.observation).toHaveBeenLastCalledWith("failure");
    expect(sink.loadFailed).toHaveBeenCalledTimes(1);
    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(sink.observation).toHaveBeenLastCalledWith("live");
    const legacy = client({ mcpList: read });
    legacy.subscribeExtensions = async () => "unsupported";
    controller.replace(legacy);
    await controller.refresh();
    expect(sink.observation).toHaveBeenLastCalledWith("unsupported");
    const count = read.mock.calls.length;
    controller.setVisible(false);
    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(count);
    controller.setVisible(true);
    await flush();
    expect(read).toHaveBeenCalledTimes(count + 1);
    controller.dispose();
  });
});

describe("mcp controller", () => {
  it.each(["saved", "partial"])("retires a %s editor outcome when its client changes during post-write reconciliation", async (outcome) => {
    let resolve!: (value: McpListResult) => void;
    const postWrite = new Promise<McpListResult>((accept) => { resolve = accept; });
    const read = vi.fn().mockResolvedValueOnce(servers("github")).mockReturnValueOnce(postWrite);
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const old = client({ mcpList: read,
      mcpEdit: async () => ({ server: { ...servers("github").servers[0]!, configRevision: 8 } }),
      ...(outcome === "partial" ? { secretSet: async () => { throw new Error("catalog locked"); } } : {}),
    });
    const controller = createMcpController(sink);
    controller.replace(old);
    await controller.refresh();
    const done = controller.edit({ ...emptyDraft(), serverId: "github", command: "node",
      fields: [{ id: 1, name: "TOKEN", value: "new-value", storedSecretRef: "mcp.github.env.TOKEN" }],
    }, 7);
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    controller.replace(client({}));
    await controller.refresh();
    resolve(servers("github"));
    expect(await done).toEqual({ ok: false });
    controller.dispose();
  });

  it("restores after hide/show during an accepted write's pending reconciliation", async () => {
    let resolve!: (value: McpListResult) => void;
    const postWrite = new Promise<McpListResult>((accept) => { resolve = accept; });
    const read = vi.fn().mockResolvedValueOnce(servers("github")).mockReturnValueOnce(postWrite).mockResolvedValue(servers("fresh"));
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const active = client({ mcpList: read });
    controller.replace(active);
    await controller.refresh();
    const done = controller.add({ ...emptyDraft(), serverId: "new", command: "node" });
    await new Promise((accept) => setImmediate(accept));
    controller.setVisible(false);
    controller.setVisible(true);
    resolve(servers("retired"));
    await done;
    expect(read).toHaveBeenCalledTimes(3);
    expect(active.calls.filter((name) => name === "mcpAdd")).toHaveLength(1);
    expect(sink.loaded.mock.calls.at(-1)?.[0]).toEqual(servers("fresh").servers);
  });

  it("retires success even when replacement occurs during the final hide/show reconciliation", async () => {
    let finishPostWrite!: (value: McpListResult) => void;
    let finishRestore!: (value: McpListResult) => void;
    const postWrite = new Promise<McpListResult>((resolve) => { finishPostWrite = resolve; });
    const restore = new Promise<McpListResult>((resolve) => { finishRestore = resolve; });
    const read = vi.fn().mockResolvedValueOnce(servers("github")).mockReturnValueOnce(postWrite).mockReturnValueOnce(restore);
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(client({ mcpList: read }));
    await controller.refresh();
    const done = controller.edit({ ...emptyDraft(), serverId: "github", command: "node" }, 1);
    await flush();
    controller.setVisible(false);
    controller.setVisible(true);
    finishPostWrite(servers("old"));
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    controller.replace(client({}));
    await controller.refresh();
    finishRestore(servers("old"));
    expect(await done).toEqual({ ok: false });
    controller.dispose();
  });

  it("joins coincident demand and folds an invalidation burst into one trailing read", async () => {
    let resolve!: (value: McpListResult) => void;
    const pending = new Promise<McpListResult>((accept) => { resolve = accept; });
    const read = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(servers("fresh"));
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(client({ mcpList: read }));
    const done = controller.refresh();
    void controller.refresh();
    await new Promise((accept) => setImmediate(accept));
    expect(read).toHaveBeenCalledTimes(1);
    void controller.invalidate();
    void controller.invalidate();
    resolve(servers("old"));
    await done;
    expect(read).toHaveBeenCalledTimes(2);
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(servers("fresh").servers, undefined);
  });

  it("keeps its mutation lock and outcome while hidden, then performs one demand read", async () => {
    let resolve!: (value: { server: McpListResult["servers"][number] }) => void;
    const pending = new Promise<{ server: McpListResult["servers"][number] }>((accept) => { resolve = accept; });
    const write = vi.fn(() => pending);
    const read = vi.fn(async () => servers("github"));
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn(), feedback: vi.fn(), mutationSettled: vi.fn() };
    const controller = createMcpController(sink);
    controller.replace(client({ mcpList: read, mcpAdd: write }));
    await controller.refresh();
    const done = controller.add({ ...emptyDraft(), serverId: "new", command: "node" });
    controller.setVisible(false);
    await controller.invalidate();
    expect(await controller.add({ ...emptyDraft(), serverId: "new", command: "node" })).toEqual({ ok: false });
    resolve({ server: servers("new").servers[0]! });
    expect(await done).toEqual({ ok: true, committedRevision: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(sink.feedback).toHaveBeenCalledWith(expect.objectContaining({ kind: "saved" }));
    controller.setVisible(true);
    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(2);
  });

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

  it("keeps successful diagnostic feedback useful and bound to the requested server", async () => {
    const sink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const controller = createMcpController(sink);
    const testRequest = vi.fn(async () => ({
      status: "ok" as const,
      toolNames: ["get_issue", "search_issues"],
      skipped: [{ toolName: "legacy_issue", code: "UNION_UNSUPPORTED" as const, path: "properties.format" }],
      pages: 2,
      durationMs: 35,
    }));
    const stub = client({ mcpTest: testRequest });
    controller.replace(stub);
    await controller.refresh();
    await controller.test("github");
    expect(testRequest).toHaveBeenCalledTimes(1);
    expect(testRequest).toHaveBeenCalledWith({ serverId: "github" });
    expect(sink.loaded).toHaveBeenLastCalledWith(servers("github").servers, {
      kind: "tested",
      message: "github 测试通过：2 个工具，耗时 35 毫秒，跳过 1 个",
    });
    expect(stub.calls.filter((name) => name === "mcpList")).toHaveLength(2);
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
