import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";
import type { McpConnect } from "./mcp-connect.ts";

const FIXTURE = fileURLToPath(new URL("../testing/mcp-fixture.mjs", import.meta.url));

const managers: McpManager[] = [];
async function makeManager(entries: McpServerEntry[], connect: McpConnect): Promise<McpManager> {
  const { logger, records } = createCaptureLogger();
  const manager = await createMcpManager({ entries, logger, connect });
  managers.push(manager);
  return Object.assign(manager, { records });
}
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((m) => m.close()));
});

// A duck-typed in-memory MCPTransport (copy of the shipped mock pattern, research §4c) — never imported from dist.
interface CallHandler {
  (msg: { id: number | string; params: { name: string; arguments?: Record<string, unknown> } }): unknown;
}
class InMemoryTransport {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  closedCount = 0;
  private readonly tools: Array<Record<string, unknown>>;
  private readonly call: CallHandler;
  constructor(tools: Array<Record<string, unknown>>, call: CallHandler) {
    this.tools = tools;
    this.call = call;
  }
  async start(): Promise<void> {}
  async send(message: { id?: number | string; method?: string }): Promise<void> {
    if (message.id === undefined) return; // notification
    const reply = this.handle(message as { id: number | string; method: string; params?: unknown });
    queueMicrotask(() => this.onmessage?.(reply));
  }
  private handle(msg: { id: number | string; method: string; params?: unknown }): unknown {
    if (msg.method === "initialize")
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mem", version: "0.0.1" },
        },
      };
    if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: this.tools } };
    if (msg.method === "tools/call") return this.call(msg as never);
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }
  async close(): Promise<void> {
    this.closedCount += 1;
    this.onclose?.();
  }
}

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

function memConnect(transports: Map<string, InMemoryTransport>): McpConnect {
  return (entry) => {
    const transport = transports.get(entry.key);
    if (!transport) throw new Error(`no transport for ${entry.key}`);
    return createMCPClient({ transport });
  };
}

describe("createMcpManager", () => {
  it("namespaces discovered tools as `${serverKey}_${toolName}` and maps them back (T3)", async () => {
    const transports = new Map([["files", new InMemoryTransport([ECHO_TOOL], echoOk)]]);
    const manager = await makeManager([{ key: "files", config: { command: "x" } }], memConnect(transports));

    expect(Object.keys(manager.tools())).toEqual(["files_echo"]);
    expect(manager.describe("files_echo")).toEqual({ serverName: "files", toolName: "echo" });
    expect(manager.describe("nope")).toBeUndefined();
  });

  it("wraps a JSON-RPC call error into {ok:false, code} (T4)", async () => {
    const failing: CallHandler = (msg) => ({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "Tool not found" },
    });
    const transports = new Map([["srv", new InMemoryTransport([ECHO_TOOL], failing)]]);
    const manager = await makeManager([{ key: "srv", config: { command: "x" } }], memConnect(transports));

    const tool = manager.tools().srv_echo;
    const result = (await tool?.execute?.({ text: "hi" }, { toolCallId: "c1", messages: [] } as never)) as {
      ok: boolean;
      code: number | string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe(-32601);
  });

  it("skips a server that fails to connect and keeps the others live (T5)", async () => {
    const transports = new Map([["good", new InMemoryTransport([ECHO_TOOL], echoOk)]]);
    const connect: McpConnect = (entry) => {
      if (entry.key === "bad") return Promise.reject(new Error("spawn ENOENT"));
      return memConnect(transports)(entry);
    };
    const manager = (await makeManager(
      [
        { key: "bad", config: { command: "missing" } },
        { key: "good", config: { command: "x" } },
      ],
      connect,
    )) as McpManager & { records: { level: string }[] };

    expect(Object.keys(manager.tools())).toEqual(["good_echo"]);
    expect(manager.records.some((r) => r.level === "warn")).toBe(true);
  });

  it("closeAll is idempotent (T8)", async () => {
    const transport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const manager = await makeManager([{ key: "s", config: { command: "x" } }], memConnect(new Map([["s", transport]])));

    await manager.close();
    await manager.close();
    expect(transport.closedCount).toBe(1); // second close is a no-op
  });

  it("connects a real stdio child, lists and calls a tool end-to-end (T6)", async () => {
    const stdioConnect: McpConnect = () =>
      createMCPClient({ transport: new Experimental_StdioMCPTransport({ command: execPath, args: [FIXTURE] }) });
    const manager = await makeManager([{ key: "fx", config: { command: execPath, args: [FIXTURE] } }], stdioConnect);

    const tool = manager.tools().fx_echo;
    expect(tool).toBeDefined();
    const result = (await tool?.execute?.({ text: "hello" }, { toolCallId: "c1", messages: [] } as never)) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]?.text).toBe("echo: hello");
  });
});
