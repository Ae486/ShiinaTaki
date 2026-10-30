import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";
import { defaultConnect } from "./mcp-connect.ts";

// A node:http Streamable-HTTP MCP fixture (research §4b): POST -> 200 + JSON-RPC body, notification -> 202,
// GET -> 405 (the transport treats 405 as "no inbound SSE" and proceeds).
function startHttpFixture(options: { structuredOnly?: boolean; modernDelayMs?: number } = {}): Promise<{ url: string; server: Server; methods: string[] }> {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const msg = JSON.parse(body);
      methods.push(msg.method);
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const send = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      };
      if (options.modernDelayMs !== undefined && msg.method === "server/discover") {
        setTimeout(() => send({ jsonrpc: "2.0", id: msg.id,
          result: { resultType: "success", supportedVersions: ["2026-07-28"], capabilities: { tools: {} } } }), options.modernDelayMs);
      } else if (options.modernDelayMs !== undefined && msg.method === "initialize") {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Modern-only fixture" } });
      } else if (options.structuredOnly && msg.method === "tools/call") {
        send({ jsonrpc: "2.0", id: msg.id, result: { structuredContent: { echo: msg.params?.arguments?.text } } });
      } else {
        const response = reply(msg) as { result?: Record<string, unknown> };
        if (options.modernDelayMs !== undefined && response.result) response.result.resultType = "success";
        send(response);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server, methods });
    });
  });
}

function reply(msg: { id: number | string; method: string; params?: { arguments?: { text?: string } } }): unknown {
  if (msg.method === "initialize")
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "http-fixture", version: "0.0.1" },
      },
    };
  if (msg.method === "tools/list")
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes text",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      },
    };
  if (msg.method === "tools/call")
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${msg.params?.arguments?.text}` }] } };
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
}

let running: { url: string; server: Server; methods: string[] } | null = null;
let manager: McpManager | null = null;
afterEach(async () => {
  await manager?.close();
  manager = null;
  await new Promise<void>((resolve) => running?.server.close(() => resolve()));
  running = null;
});

describe("createMcpManager over Streamable HTTP (T7)", () => {
  it("connects, lists and calls a tool against a node:http server", async () => {
    running = await startHttpFixture();
    const { logger } = createCaptureLogger();
    manager = createMcpManager({ logger, connect: defaultConnect });
    await manager.reconcile([{
      serverId: "remote",
      ownerHostId: "11111111-1111-4111-8111-111111111111",
      configRevision: 1,
      config: { url: running.url },
      selectedTools: [],
      enabled: true,
    }]);

    const tool = manager.tools().remote_echo;
    expect(tool).toBeDefined();
    const result = (await tool?.execute?.({ text: "over-http" }, { toolCallId: "c1", messages: [] } as never)) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]?.text).toBe("echo: over-http");
  });

  it("preserves structured-only results through the actual transport and namespaced tool", async () => {
    running = await startHttpFixture({ structuredOnly: true });
    const { logger } = createCaptureLogger();
    manager = createMcpManager({ logger, connect: defaultConnect });
    await manager.reconcile([{ serverId: "structured", ownerHostId: "11111111-1111-4111-8111-111111111111",
      configRevision: 1, config: { url: running.url }, selectedTools: [], enabled: true }]);
    const result = await manager.tools().structured_echo?.execute?.({ text: "complete" }, { toolCallId: "structured", messages: [], context: undefined });
    expect(result).toMatchObject({ structuredContent: { echo: "complete" },
      content: [{ type: "text", text: '{"echo":"complete"}' }] });
    expect(running.methods.filter(method => method === "tools/call")).toHaveLength(1);
  });

  it("waits for delayed modern-only HTTP discovery inside the Core candidate budget", async () => {
    running = await startHttpFixture({ modernDelayMs: 1100 });
    const { logger } = createCaptureLogger();
    manager = createMcpManager({ logger, connect: defaultConnect, candidateDeadlineMs: 4000 });
    await manager.reconcile([{ serverId: "modern", ownerHostId: "11111111-1111-4111-8111-111111111111",
      configRevision: 1, config: { url: running.url }, selectedTools: [], enabled: true }]);
    expect(manager.tools().modern_echo).toBeDefined();
    expect(running.methods).toContain("server/discover");
    expect(running.methods).not.toContain("initialize");
  });
});
