/**
 * INPUT:  McpServerEntry[] (from mcp-config) + a logger + an optional connect override (tests)
 * OUTPUT: createMcpManager(deps) -> Promise<McpManager> { tools(), describe(name), close() }
 * POS:    core/mcp — standard SDK list/prepare/convert/call path with trusted subject sidecars and pre-call governance
 */
import { createHash } from "node:crypto";
import type { Tool, ToolSet } from "ai";
import type { Logger } from "../logging/logger.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { wrapGovernedTool, type InteractiveGovernanceContext } from "../governance/governed-tool.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import { mcpPublicConfig } from "./mcp-config.ts";
import { defaultConnect, type McpClient, type McpConnect } from "./mcp-connect.ts";
import { prepareMcpToolDefinitions } from "./mcp-schema-compat.ts";

/** The raw MCP identity behind a namespaced ToolSet key; the presentation key is never an authority key. */
export interface McpToolRef {
  serverName: string;
  toolName: string;
  subjectId: string;
  subjectRevision: string;
}

export interface McpManager {
  /** Builds the aggregated ToolSet for one turn; raw SDK closures remain cached and connection-neutral. */
  tools(interactive?: Omit<InteractiveGovernanceContext, "presentation" | "approval">): ToolSet;
  /** Maps a ToolSet key back to its raw identity plus stable subject binding. */
  describe(toolKey: string): McpToolRef | undefined;
  /** Closes every connected client; idempotent (safe to call twice in the shutdown chain). */
  close(): Promise<void>;
}

export interface McpManagerDeps {
  entries: McpServerEntry[];
  logger: Logger;
  connect?: McpConnect;
  governance?: {
    service: GovernancePolicyService;
    ownerHostId: string;
    approval?: InteractiveGovernanceContext["approval"];
    legacyDeny?: (serverName: string, toolName: string) => boolean;
  };
}

// Model-facing error envelope for a failed MCP call (error-handling spec; the model reads code + message).
type McpToolFailure = { ok: false; code: number | string; message: string };

export async function createMcpManager(deps: McpManagerDeps): Promise<McpManager> {
  const log = deps.logger.child({ mod: "mcp" });
  const connect = deps.connect ?? defaultConnect;

  const clients: McpClient[] = [];
  const tools: ToolSet = {};
  const refs = new Map<string, McpToolRef>();
  const collisions = new Set<string>();

  const results = await Promise.allSettled(deps.entries.map((entry) => discover(entry, connect, log)));
  results.forEach((result, index) => {
    const entry = deps.entries[index];
    if (!entry) return;
    if (result.status === "rejected") {
      // A failing server is skipped, never fatal — the others stay live (AC #8-5).
      log.warn({ server: entry.key, err: readable(result.reason) }, "mcp server connect/discovery failed; skipped");
      return;
    }
    clients.push(result.value.client);
    mergeServerTools({ entry, discovered: result.value.tools, tools, refs, collisions, log });
  });
  log.info({ servers: clients.length, tools: Object.keys(tools).length }, "mcp servers connected");

  let closed = false;
  return {
    tools: (interactive) => deps.governance ? wrapForTurn({ tools, refs, governance: deps.governance, interactive }) : tools,
    describe: (toolKey) => refs.get(toolKey),
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

interface TurnWrapInput {
  tools: ToolSet;
  refs: ReadonlyMap<string, McpToolRef>;
  governance: NonNullable<McpManagerDeps["governance"]>;
  interactive?: Omit<InteractiveGovernanceContext, "presentation" | "approval">;
}

function wrapForTurn(input: TurnWrapInput): ToolSet {
  const { tools, refs, governance, interactive: turn } = input;
  const wrapped: ToolSet = {};
  for (const [key, tool] of Object.entries(tools)) {
    const ref = refs.get(key);
    if (!ref) continue;
    const interactive = governance.approval && turn ? {
      ...turn,
      approval: governance.approval,
      presentation: mcpPresentation(ref),
    } : undefined;
    wrapped[key] = wrapGovernedTool(tool, {
      service: governance.service,
      binding: mcpBinding(governance, ref),
      interactive,
    });
  }
  return wrapped;
}

function mcpBinding(governance: NonNullable<McpManagerDeps["governance"]>, ref: McpToolRef) {
  return {
    identity: {
      capabilityId: "mcp.tool.call",
      ownerHostId: governance.ownerHostId,
      subject: { subjectId: ref.subjectId, revision: ref.subjectRevision },
    },
    cellKey: "mcp-tool-call",
    denyConstraints: governance.legacyDeny?.(ref.serverName, ref.toolName) ? ["legacy-mcp-deny"] : [],
  };
}

function mcpPresentation(ref: McpToolRef) {
  return {
    revision: 1 as const,
    title: "Allow MCP tool",
    capabilityLabel: ref.toolName,
    subjectLabel: ref.serverName,
    riskSummary: "This configured MCP tool can access its server with the supplied call.",
    sections: [{ title: "Target", fields: [
      { label: "Server", value: ref.serverName },
      { label: "Tool", value: ref.toolName },
    ] }],
  };
}

async function discover(
  entry: McpServerEntry,
  connect: McpConnect,
  log: Logger,
): Promise<{ client: McpClient; tools: ToolSet }> {
  const client = await connect(entry);
  try {
    const listed = await client.listTools();
    const prepared = prepareMcpToolDefinitions(listed);
    for (const skipped of prepared.skipped) {
      log.warn({ server: entry.key, ...skipped }, "mcp tool schema incompatible; skipped");
    }
    // Dynamic MCP inputs are unknown while ToolSet is invariant. Execution stays in the SDK's raw-name closure.
    const tools = client.toolsFromDefinitions(prepared.definitions) as unknown as ToolSet;
    return { client, tools };
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
  collisions: Set<string>;
  log: Logger;
}

// Namespace each tool as `${sanitizedKey}_${toolName}` (renaming the key is safe — execute closes over the raw
// name). A collision is removed from the published set entirely: choosing either server would bind a presentation
// key to an ambiguous authority, so the only safe result is fail-closed for that key while unrelated tools remain live.
function mergeServerTools({ entry, discovered, tools, refs, collisions, log }: MergeArgs): void {
  const prefix = sanitize(entry.key);
  const revision = publicFingerprint(entry);
  for (const [toolName, tool] of Object.entries(discovered)) {
    const key = `${prefix}_${toolName}`;
    if (collisions.has(key)) continue;
    if (key in tools) {
      delete tools[key];
      refs.delete(key);
      collisions.add(key);
      log.warn({ key, server: entry.key }, "mcp tool name collision; key removed from published ToolSet");
      continue;
    }
    const ref = { serverName: entry.key, toolName, subjectId: stableSubject(entry.key, toolName), subjectRevision: revision };
    const wrapped = wrapExecute(tool);
    tools[key] = wrapped;
    refs.set(key, ref);
  }
}

function stableSubject(serverKey: string, toolName: string): string {
  return `mcp.${createHash("sha256").update(`${serverKey}\u0000${toolName}`).digest("hex")}`;
}

function publicFingerprint(entry: McpServerEntry): string {
  return `cfg.${createHash("sha256").update(JSON.stringify(mcpPublicConfig(entry.config))).digest("hex")}`;
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
