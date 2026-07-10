import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";
import { defaultConnect } from "./mcp-connect.ts";

// A node:http Streamable-HTTP MCP fixture (research §4b): POST -> 200 + JSON-RPC body, notification -> 202,
// GET -> 405 (the transport treats 405 as "no inbound SSE" and proceeds).
function startHttpFixture(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const msg = JSON.parse(body);
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(msg)));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server });
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

let running: { url: string; server: Server } | null = null;
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
    manager = await createMcpManager({
      entries: [{ key: "remote", config: { url: running.url } }],
      logger,
      connect: defaultConnect,
    });

    const tool = manager.tools().remote_echo;
    expect(tool).toBeDefined();
    const result = (await tool?.execute?.({ text: "over-http" }, { toolCallId: "c1", messages: [] } as never)) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]?.text).toBe("echo: over-http");
  });
});
