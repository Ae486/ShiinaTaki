/**
 * INPUT:  one McpServerEntry (stdio or http) resolved from mcp-servers.json
 * OUTPUT: defaultConnect(entry) -> Promise<MCPClient>; McpClient type re-export
 * POS:    core/mcp — THE sanctioned @ai-sdk/mcp import site (ADR 0006 carve-out); builds a transport, then connects
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { isStdioConfig, type McpServerEntry } from "./mcp-config.ts";

export type McpClient = MCPClient;

/** A client factory the manager can override in tests (in-memory transport) — production builds real transports. */
export type McpConnect = (entry: McpServerEntry) => Promise<McpClient>;

/**
 * Connect one server. The stdio spawn happens inside @ai-sdk/mcp (shell:false) — our code never touches
 * node:child_process (invariant 1 / ADR 0006). Connect throwing is expected and handled by the manager.
 */
export const defaultConnect: McpConnect = (entry) => {
  const { config } = entry;
  if (isStdioConfig(config)) {
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      }),
    });
  }
  return createMCPClient({ transport: { type: "http", url: config.url, headers: config.headers } });
};
