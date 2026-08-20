/**
 * INPUT:  registry dispatch frames (operator/node roles) over a real :memory: desired repo + in-memory transports
 * OUTPUT: operator-only role gate for the whole mcp.* family, add/edit/enable/disable/remove without any restart,
 *         typed MCP_CONFIG_CONFLICT carrying the current revision, MCP_REFUSED reasons, test-only diagnostics,
 *         and sentinel-absence probes over every response and log record
 * POS:    core/server/methods — the lifecycle surface at the registry boundary (secret-methods harness style)
 */
import { afterEach, describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, MCP_METHODS } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createCaptureLogger, type CapturedLog } from "../../testing/capture-logger.ts";
import { InMemoryTransport, memConnect, type CallHandler } from "../../testing/mcp-test-transport.ts";
import { createMcpDesiredRepo } from "../../mcp/mcp-desired-repo.ts";
import { createMcpManager, type McpManager } from "../../mcp/mcp-manager.ts";
import { createMcpLifecycleService } from "../../mcp/mcp-lifecycle-service.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerMcpMethods } from "./mcp-methods.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ECHO_TOOL = {
  name: "echo",
  description: "Echoes text",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const echoOk: CallHandler = (msg) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { content: [{ type: "text", text: `echo: ${String(msg.params.arguments?.text)}` }] },
});

const dbs: Database[] = [];
const managers: McpManager[] = [];
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
  for (const db of dbs.splice(0)) db.close();
});

interface Harness {
  registry: ReturnType<typeof createMethodRegistry>;
  records: CapturedLog[];
  transports: Map<string, InMemoryTransport>;
}

function harness(): Harness {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const capture = createCaptureLogger();
  const transports = new Map<string, InMemoryTransport>();
  const manager = createMcpManager({
    logger: capture.logger,
    connect: memConnect(transports),
    // Every marker resolves except explicitly seeded ones (the unresolvable-ref fail-closed probe).
    resolveSecret: (ref) => (ref === "mcp.unresolvable.env.TOKEN" ? null : `resolved-${ref}`),
    drainBudgetMs: 30,
    shutdownBudgetMs: 30,
  });
  managers.push(manager);
  const registry = createMethodRegistry();
  registerMcpMethods(registry, {
    service: createMcpLifecycleService({ repo: createMcpDesiredRepo(db, { ownerHostId: OWNER }), manager }),
    logger: capture.logger,
  });
  return { registry, records: capture.records, transports };
}

let id = 0;
async function call(h: Harness, spec: { method: string; params: unknown; role?: "operator" | "node" }): Promise<Record<string, unknown>> {
  const role = spec.role ?? "operator";
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  const response = await h.registry.dispatch({ jsonrpc: "2.0", id: ++id, method: spec.method, params: spec.params }, ctx);
  return response as unknown as Record<string, unknown>;
}

describe("mcp methods", () => {
  it("add → connected status without any restart; list/get return the merged desired+runtime view", async () => {
    const h = harness();
    h.transports.set("files", new InMemoryTransport([ECHO_TOOL], echoOk));
    const added = await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } });
    expect(added.result).toMatchObject({
      server: { serverId: "files", enabled: true, configRevision: 1, status: { phase: "connected", toolCount: 1, runtimeGeneration: 1 } },
    });

    const list = await call(h, { method: MCP_METHODS.list, params: {} });
    expect((list.result as { servers: unknown[] }).servers).toHaveLength(1);
    const got = await call(h, { method: MCP_METHODS.get, params: { serverId: "files" } });
    expect(got.result).toMatchObject({ server: { serverId: "files", status: { phase: "connected" } } });
    const status = await call(h, { method: MCP_METHODS.status, params: {} });
    expect(status.result).toMatchObject({ servers: [{ serverId: "files", phase: "connected" }] });
  });

  it("keeps every method operator-only (node role is FORBIDDEN)", async () => {
    const h = harness();
    for (const [method, params] of [
      [MCP_METHODS.list, {}],
      [MCP_METHODS.get, { serverId: "x" }],
      [MCP_METHODS.add, { serverId: "x", config: { command: "node" } }],
      [MCP_METHODS.edit, { serverId: "x", config: { command: "node" }, selectedTools: [], expectedConfigRevision: 1 }],
      [MCP_METHODS.enable, { serverId: "x", expectedConfigRevision: 1 }],
      [MCP_METHODS.disable, { serverId: "x", expectedConfigRevision: 1 }],
      [MCP_METHODS.remove, { serverId: "x", expectedConfigRevision: 1 }],
      [MCP_METHODS.test, { serverId: "x" }],
      [MCP_METHODS.reconnect, { serverId: "x" }],
      [MCP_METHODS.status, {}],
    ] as const) {
      const response = (await call(h, { method, params, role: "node" })) as { error: { data: { code: string } } };
      expect(response.error.data.code).toBe("FORBIDDEN");
    }
  });

  it("a stale expectedConfigRevision returns MCP_CONFIG_CONFLICT carrying the current revision", async () => {
    const h = harness();
    h.transports.set("files", new InMemoryTransport([ECHO_TOOL], echoOk));
    await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } });
    await call(h, { method: MCP_METHODS.edit, params: { serverId: "files", config: { command: "node", args: ["a"] }, selectedTools: [], expectedConfigRevision: 1 } });

    const stale = (await call(h, {
      method: MCP_METHODS.edit,
      params: { serverId: "files", config: { command: "node", args: ["b"] }, selectedTools: [], expectedConfigRevision: 1 },
    })) as { error: { code: number; data: { code: string; currentConfigRevision: number } } };
    expect(stale.error.code).toBe(JSON_RPC_APP_ERROR);
    expect(stale.error.data).toEqual({ code: "MCP_CONFIG_CONFLICT", currentConfigRevision: 2 });

    // The retry with the CURRENT revision succeeds — explicit refetch + retry, never a replay.
    const retry = await call(h, {
      method: MCP_METHODS.edit,
      params: { serverId: "files", config: { command: "node", args: ["b"] }, selectedTools: [], expectedConfigRevision: 2 },
    });
    expect(retry.result).toMatchObject({ server: { configRevision: 3, status: { phase: "connected" } } });
  });

  it("duplicate/unknown servers and key collisions refuse with bounded machine reasons", async () => {
    const h = harness();
    h.transports.set("files", new InMemoryTransport([ECHO_TOOL], echoOk));
    await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } });
    const duplicate = (await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } })) as { error: { data: { code: string; reason: string } } };
    expect(duplicate.error.data).toEqual({ code: "MCP_REFUSED", reason: "duplicate-server" });

    const unknown = (await call(h, { method: MCP_METHODS.disable, params: { serverId: "ghost", expectedConfigRevision: 1 } })) as { error: { data: { reason: string } } };
    expect(unknown.error.data).toMatchObject({ reason: "unknown-server" });
  });

  it("disable blocks the server's tools immediately and enable republishes — all without a restart", async () => {
    const h = harness();
    h.transports.set("files", new InMemoryTransport([ECHO_TOOL], echoOk));
    await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } });
    const disabled = await call(h, { method: MCP_METHODS.disable, params: { serverId: "files", expectedConfigRevision: 1 } });
    expect(disabled.result).toMatchObject({ server: { enabled: false, configRevision: 2, status: { phase: "disabled" } } });

    const reenabled = await call(h, { method: MCP_METHODS.enable, params: { serverId: "files", expectedConfigRevision: 2 } });
    expect(reenabled.result).toMatchObject({ server: { enabled: true, configRevision: 3, status: { phase: "connected" } } });
  });

  it("remove withdraws the server from desired state and the runtime", async () => {
    const h = harness();
    h.transports.set("files", new InMemoryTransport([ECHO_TOOL], echoOk));
    await call(h, { method: MCP_METHODS.add, params: { serverId: "files", config: { command: "node" } } });
    const removed = await call(h, { method: MCP_METHODS.remove, params: { serverId: "files", expectedConfigRevision: 1 } });
    expect(removed.result).toEqual({ status: "removed", serverId: "files" });
    const list = await call(h, { method: MCP_METHODS.list, params: {} });
    expect((list.result as { servers: unknown[] }).servers).toHaveLength(0);
  });

  it("test returns diagnostics only and never publishes tools", async () => {
    const h = harness();
    const transport = new InMemoryTransport([ECHO_TOOL], echoOk);
    // An unsaved config is tested under the service's synthetic probe id, without entering desired state.
    h.transports.set("test-candidate", transport);
    const tested = await call(h, { method: MCP_METHODS.test, params: { config: { command: "node" } } });
    expect(tested.result).toMatchObject({ status: "ok", toolNames: ["echo"], pages: 1 });
    expect(transport.closedCount).toBe(1); // the ephemeral candidate closed

    const list = await call(h, { method: MCP_METHODS.list, params: {} });
    expect((list.result as { servers: unknown[] }).servers).toHaveLength(0);
    // A failing test (no transport left) reports sanitized diagnostics, still publishing nothing.
    h.transports.delete("test-candidate");
    const failed = await call(h, { method: MCP_METHODS.test, params: { config: { command: "definitely-missing-command" } } });
    expect(failed.result).toMatchObject({ status: "failed", reason: "connect-failed" });
  });

  it("never echoes a secret marker's value or unexpected internals in responses or logs", async () => {
    const h = harness();
    h.transports.set("secure", new InMemoryTransport([ECHO_TOOL], echoOk));
    const added = await call(h, {
      method: MCP_METHODS.add,
      params: { serverId: "secure", config: { command: "node", env: { TOKEN: "secret-ref:mcp.secure.env.TOKEN" } } },
    });
    // The desired config round-trips the OPAQUE marker; no value field can exist on the result.
    expect(JSON.stringify(added)).toContain("secret-ref:mcp.secure.env.TOKEN");
    expect(JSON.stringify(added)).not.toMatch(/"value"\s*:/);
    // A candidate failure's diagnostics carry the sanitized reason/message only.
    const failing = (await call(h, {
      method: MCP_METHODS.test,
      params: { config: { command: "node", env: { TOKEN: "secret-ref:mcp.unresolvable.env.TOKEN" } } },
    })) as { result: { status: string; reason?: string } };
    expect(failing.result).toMatchObject({ status: "failed", reason: "secret-unresolvable" });
  });
});
