/**
 * INPUT:  McpServerEntry[] (from mcp-config) + a logger + an optional connect override (tests)
 * OUTPUT: createMcpManager(deps) -> Promise<McpManager> { tools(), describe(name), close() }
 * POS:    core/mcp — connects operator MCP servers at boot, namespaces + error-wraps their tools into one ToolSet
 */
import type { Tool, ToolSet } from "ai";
import type { Logger } from "../logging/logger.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import { defaultConnect, type McpClient, type McpConnect } from "./mcp-connect.ts";

/** The raw MCP identity behind a namespaced ToolSet key — what the approval gate + CLI display use. */
export interface McpToolRef {
  serverName: string;
  toolName: string;
}

export interface McpManager {
  /** The aggregated, namespaced, error-wrapped ToolSet (cached; no per-turn rediscovery). */
  tools(): ToolSet;
  /** Maps a ToolSet key back to its server+tool, or undefined for a non-MCP tool (approval scoping). */
  describe(toolKey: string): McpToolRef | undefined;
  /** Closes every connected client; idempotent (safe to call twice in the shutdown chain). */
  close(): Promise<void>;
}

export interface McpManagerDeps {
  entries: McpServerEntry[];
  logger: Logger;
  connect?: McpConnect;
}

// Model-facing error envelope for a failed MCP call (error-handling spec; the model reads code + message).
type McpToolFailure = { ok: false; code: number | string; message: string };

export async function createMcpManager(deps: McpManagerDeps): Promise<McpManager> {
  const log = deps.logger.child({ mod: "mcp" });
  const connect = deps.connect ?? defaultConnect;

  const clients: McpClient[] = [];
  const tools: ToolSet = {};
  const refs = new Map<string, McpToolRef>();

  const results = await Promise.allSettled(deps.entries.map((entry) => discover(entry, connect)));
  results.forEach((result, index) => {
    const entry = deps.entries[index];
    if (!entry) return;
    if (result.status === "rejected") {
      // A failing server is skipped, never fatal — the others stay live (AC #8-5).
      log.warn({ server: entry.key, err: readable(result.reason) }, "mcp server connect/discovery failed; skipped");
      return;
    }
    clients.push(result.value.client);
    mergeServerTools({ entry, discovered: result.value.tools, tools, refs, log });
  });
  log.info({ servers: clients.length, tools: Object.keys(tools).length }, "mcp servers connected");

  let closed = false;
  return {
    tools: () => tools,
    describe: (toolKey) => refs.get(toolKey),
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

async function discover(entry: McpServerEntry, connect: McpConnect): Promise<{ client: McpClient; tools: ToolSet }> {
  const client = await connect(entry);
  try {
    // client.tools() returns McpToolSet (dynamic tools, input typed unknown); ToolSet's variance is stricter, so
    // widen through unknown — the tools are called only via their own closed-over execute, never structurally.
    return { client, tools: (await client.tools()) as unknown as ToolSet };
  } catch (error) {
    await client.close().catch(() => undefined); // no zombie transport if listing fails post-discovery
    throw error;
  }
}

interface MergeArgs {
  entry: McpServerEntry;
  discovered: ToolSet;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
  log: Logger;
}

// Namespace each tool as `${sanitizedKey}_${toolName}` (renaming the key is safe — execute closes over the raw
// name). Collisions after namespacing are last-wins + warn (ruling 8).
function mergeServerTools({ entry, discovered, tools, refs, log }: MergeArgs): void {
  const prefix = sanitize(entry.key);
  for (const [toolName, tool] of Object.entries(discovered)) {
    const key = `${prefix}_${toolName}`;
    if (key in tools) log.warn({ key, server: entry.key }, "mcp tool name collision; last server wins");
    tools[key] = wrapExecute(tool);
    refs.set(key, { serverName: entry.key, toolName });
  }
}

// Spread-and-replace: keep the tool's schema/metadata/toModelOutput, only guard execute so a JSON-RPC error or a
// dropped connection becomes a structured {ok:false} the model can read (research §5). isError:true passes through.
function wrapExecute(tool: Tool): Tool {
  const inner = tool.execute;
  if (typeof inner !== "function") return tool;
  return {
    ...tool,
    execute: async (input, options) => {
      try {
        return await inner(input, options);
      } catch (error) {
        return { ok: false, code: errorCode(error), message: readable(error) } satisfies McpToolFailure;
      }
    },
  } as Tool;
}

// MCPClientError carries the JSON-RPC error code as a numeric `.code` (verified against installed mcp-client-error.ts);
// duck-typed to avoid importing an unexported class.
function errorCode(error: unknown): number | string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return "MCP_CALL_FAILED";
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
