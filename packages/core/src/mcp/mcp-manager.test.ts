import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type ToolSet } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService, type GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";
import type { McpConnect } from "./mcp-connect.ts";

const FIXTURE = fileURLToPath(new URL("../testing/mcp-fixture.mjs", import.meta.url));
const OWNER_HOST_ID = "11111111-1111-4111-8111-111111111111";

const managers: McpManager[] = [];
const dbs: Database[] = [];
async function makeManager(
  entries: McpServerEntry[],
  connect: McpConnect,
  governance?: { service: GovernancePolicyService; ownerHostId: string; legacyDeny?: (server: string, tool: string) => boolean },
): Promise<McpManager> {
  const { logger, records } = createCaptureLogger();
  const manager = await createMcpManager({ entries, logger, connect, governance });
  managers.push(manager);
  return Object.assign(manager, { records });
}
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((m) => m.close()));
  for (const db of dbs.splice(0)) db.close();
});

function policy(): GovernancePolicyService {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createGovernancePolicyService(createGovernancePolicyRepo(db));
}

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
const TAVILY_TOOL = {
  name: "search",
  description: "Search the web for current information on any topic.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      time_range: {
        anyOf: [
          { type: "string", enum: ["day", "week", "month", "year"] },
          { type: "null" },
        ],
        description: "Optional recency range.",
        default: null,
      },
    },
    required: ["query"],
  },
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

async function captureProviderTools(tools: ToolSet): Promise<unknown[]> {
  let requestBody: string | undefined;
  const provider = createOpenAICompatible({
    name: "mcp-schema-fixture",
    baseURL: "https://provider.invalid/v1",
    fetch: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await generateText({ model: provider("fixture-model"), prompt: "Inspect available tools.", tools });
  const parsed = JSON.parse(requestBody ?? "{}") as { tools?: unknown[] };
  return parsed.tools ?? [];
}

describe("createMcpManager", () => {
  it("namespaces discovered tools as `${serverKey}_${toolName}` and maps them back (T3)", async () => {
    const transports = new Map([["files", new InMemoryTransport([ECHO_TOOL], echoOk)]]);
    const manager = await makeManager([{ key: "files", config: { command: "x" } }], memConnect(transports));

    expect(Object.keys(manager.tools())).toEqual(["files_echo"]);
    expect(manager.describe("files_echo")).toMatchObject({ serverName: "files", toolName: "echo" });
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

  it("removes both identities when sanitized MCP tool keys collide", async () => {
    const firstCalled: string[] = [];
    const secondCalled: string[] = [];
    const first = new InMemoryTransport([ECHO_TOOL], (msg) => {
      firstCalled.push(msg.params.name);
      return echoOk(msg);
    });
    const second = new InMemoryTransport([ECHO_TOOL], (msg) => {
      secondCalled.push(msg.params.name);
      return echoOk(msg);
    });
    const manager = await makeManager(
      [
        { key: "files.prod", config: { command: "first" } },
        { key: "files_prod", config: { command: "second" } },
      ],
      memConnect(new Map([["files.prod", first], ["files_prod", second]])),
    );

    expect(Object.keys(manager.tools())).not.toContain("files_prod_echo");
    expect(manager.describe("files_prod_echo")).toBeUndefined();
    expect(firstCalled).toEqual([]);
    expect(secondCalled).toEqual([]);
  });

  it("fails the default ask posture closed without calling the raw SDK closure", async () => {
    const called: string[] = [];
    const transport = new InMemoryTransport([ECHO_TOOL], (msg) => {
      called.push(msg.params.name);
      return echoOk(msg);
    });
    const manager = await makeManager(
      [{ key: "files", config: { command: "x" } }],
      memConnect(new Map([["files", transport]])),
      { service: policy(), ownerHostId: OWNER_HOST_ID },
    );

    expect(await manager.tools().files_echo?.execute?.(
      { text: "blocked" }, { toolCallId: "c1", messages: [] } as never,
    )).toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
    expect(called).toEqual([]);
  });

  it("calls the existing SDK closure with the raw MCP name after an operator auto override", async () => {
    const called: string[] = [];
    const service = policy();
    service.setCell({
      key: "mcp-tool-call", level: "standard", posture: "auto", expectedPolicyGeneration: 1,
    });
    const transport = new InMemoryTransport([ECHO_TOOL], (msg) => {
      called.push(msg.params.name);
      return echoOk(msg);
    });
    const manager = await makeManager(
      [{ key: "files", config: { command: "x" } }],
      memConnect(new Map([["files", transport]])),
      { service, ownerHostId: OWNER_HOST_ID },
    );

    await manager.tools().files_echo?.execute?.({ text: "allowed" }, { toolCallId: "c1", messages: [] } as never);
    expect(called).toEqual(["echo"]);
  });

  it("uses raw server/tool sidecars as authority instead of the model-facing key", async () => {
    const base = policy();
    base.setCell({ key: "mcp-tool-call", level: "standard", posture: "auto", expectedPolicyGeneration: 1 });
    const seen: Parameters<GovernancePolicyService["authorize"]>[0][] = [];
    const service: GovernancePolicyService = {
      ...base,
      authorize(input) {
        seen.push(input);
        return base.authorize(input);
      },
    };
    const transport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const manager = await makeManager(
      [{ key: "files.prod", config: { command: "x" } }],
      memConnect(new Map([["files.prod", transport]])),
      { service, ownerHostId: OWNER_HOST_ID },
    );

    await manager.tools().files_prod_echo?.execute?.({ text: "ok" }, { toolCallId: "c1", messages: [] } as never);
    const ref = manager.describe("files_prod_echo");
    expect(ref).toMatchObject({ serverName: "files.prod", toolName: "echo" });
    expect(seen[0]).toMatchObject({
      identity: {
        capabilityId: "mcp.tool.call",
        ownerHostId: OWNER_HOST_ID,
        subject: { subjectId: ref?.subjectId, revision: ref?.subjectRevision },
      },
      cellKey: "mcp-tool-call",
    });
    expect(ref?.subjectId).not.toContain("files_prod_echo");
  });

  it("changes the transitional subject revision when public server configuration changes", async () => {
    const transports = new Map([
      ["first", new InMemoryTransport([ECHO_TOOL], echoOk)],
      ["second", new InMemoryTransport([ECHO_TOOL], echoOk)],
    ]);
    const first = await makeManager(
      [{ key: "first", config: { command: "node", args: ["one.mjs"] } }],
      memConnect(transports),
    );
    const second = await makeManager(
      [{ key: "second", config: { command: "node", args: ["two.mjs"] } }],
      memConnect(transports),
    );

    expect(first.describe("first_echo")?.subjectRevision).not.toBe(second.describe("second_echo")?.subjectRevision);
  });

  it("intersects legacy deny-only compatibility before the raw call", async () => {
    const called: string[] = [];
    const service = policy();
    service.setCell({ key: "mcp-tool-call", level: "standard", posture: "auto", expectedPolicyGeneration: 1 });
    const transport = new InMemoryTransport([ECHO_TOOL], (msg) => {
      called.push(msg.params.name);
      return echoOk(msg);
    });
    const manager = await makeManager(
      [{ key: "files", config: { command: "x" } }],
      memConnect(new Map([["files", transport]])),
      { service, ownerHostId: OWNER_HOST_ID, legacyDeny: () => true },
    );

    expect(await manager.tools().files_echo?.execute?.(
      { text: "denied" }, { toolCallId: "c1", messages: [] } as never,
    )).toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" });
    expect(called).toEqual([]);
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

  it("resolves secret-ref markers just-in-time at connect; an unresolvable ref skips only that server", async () => {
    const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";
    const seenMaps: Array<Record<string, string> | undefined> = [];
    const transports = new Map([["good", new InMemoryTransport([ECHO_TOOL], echoOk)]]);
    const connect: McpConnect = (entry) => {
      seenMaps.push("command" in entry.config ? entry.config.env : entry.config.headers);
      return memConnect(transports)(entry);
    };
    const { logger, records } = createCaptureLogger();
    const manager = await createMcpManager({
      entries: [
        { key: "good", config: { command: "x", env: { TOKEN: "secret-ref:mcp.good.env.TOKEN", NODE_ENV: "production" } } },
        { key: "locked", config: { command: "y", env: { TOKEN: "secret-ref:mcp.locked.env.TOKEN" } } },
      ],
      logger,
      connect,
      resolveSecret: (ref) => (ref === "mcp.good.env.TOKEN" ? SENTINEL : null),
    });
    managers.push(manager);

    // The resolvable server connected with the RESOLVED value (never the marker, never logged); the locked one is skipped.
    expect(seenMaps[0]).toEqual({ TOKEN: SENTINEL, NODE_ENV: "production" });
    expect(seenMaps.length).toBe(1); // the unresolvable server never reached connect
    expect(Object.keys(manager.tools())).toEqual(["good_echo"]);
    expect(JSON.stringify(records)).not.toContain(SENTINEL);
  });

  it("closeAll is idempotent (T8)", async () => {
    const transport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const manager = await makeManager([{ key: "s", config: { command: "x" } }], memConnect(new Map([["s", transport]])));

    await manager.close();
    await manager.close();
    expect(transport.closedCount).toBe(1); // second close is a no-op
  });

  it("isolates one incompatible definition while preserving model schemas and raw call names", async () => {
    const called: string[] = [];
    const call: CallHandler = (msg) => {
      called.push(msg.params.name);
      return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: msg.params.name }] } };
    };
    const bad = {
      name: "unsafe",
      description: "TOP_SECRET_SCHEMA_TEXT",
      inputSchema: {
        type: "object",
        properties: { value: { anyOf: [{ type: "string" }, { type: "null" }] } },
        required: ["value"],
      },
    };
    const transport = new InMemoryTransport([TAVILY_TOOL, bad, ECHO_TOOL], call);
    const manager = (await makeManager(
      [{ key: "tavily", config: { command: "x" } }],
      memConnect(new Map([["tavily", transport]])),
    )) as McpManager & { records: Array<{ level: string; obj: unknown; msg: string | undefined }> };

    expect(Object.keys(manager.tools())).toEqual(["tavily_search", "tavily_echo"]);
    const search = manager.tools().tavily_search;
    const echo = manager.tools().tavily_echo;
    await search?.execute?.({ query: "current" }, { toolCallId: "c1", messages: [] } as never);
    await echo?.execute?.({ text: "hello" }, { toolCallId: "c2", messages: [] } as never);
    expect(called).toEqual(["search", "echo"]);

    const searchSchema = await (
      search?.inputSchema as unknown as { jsonSchema: Promise<Record<string, unknown>> }
    ).jsonSchema;
    const echoSchema = await (
      echo?.inputSchema as unknown as { jsonSchema: Promise<Record<string, unknown>> }
    ).jsonSchema;
    expect((searchSchema.properties as Record<string, unknown>).time_range).toEqual({
      type: "string",
      enum: ["day", "week", "month", "year"],
      description: "Optional recency range.",
    });
    expect((echoSchema.properties as Record<string, unknown>).text).toEqual({ type: "string" });

    const providerTools = await captureProviderTools(manager.tools());
    expect(providerTools).toEqual([
      {
        type: "function",
        function: {
          name: "tavily_search",
          description: TAVILY_TOOL.description,
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              time_range: {
                type: "string",
                enum: ["day", "week", "month", "year"],
                description: "Optional recency range.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "tavily_echo",
          description: ECHO_TOOL.description,
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    ]);

    const warnings = manager.records.filter((record) => record.level === "warn");
    expect(warnings).toEqual([
      {
        level: "warn",
        obj: {
          server: "tavily",
          toolName: "unsafe",
          code: "REQUIRED_NULLABLE_UNSUPPORTED",
          path: "$.properties.value",
        },
        msg: "mcp tool schema incompatible; skipped",
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain("TOP_SECRET_SCHEMA_TEXT");
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
