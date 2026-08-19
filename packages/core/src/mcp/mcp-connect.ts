/**
 * INPUT:  one McpServerEntry (stdio or http) resolved from mcp-servers.json
 * OUTPUT: defaultConnect(entry) -> Promise<MCPClient>; McpClient type re-export
 * POS:    core/mcp — THE sanctioned @ai-sdk/mcp import site (ADR 0006 carve-out); builds a transport, then connects
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { isStdioConfig, type McpServerEntry } from "./mcp-config.ts";
import { resolveStdioLaunch } from "./mcp-stdio-launch.ts";

export type McpClient = MCPClient;

/** A client factory the manager can override in tests (in-memory transport) — production builds real transports. */
export type McpConnect = (entry: McpServerEntry) => Promise<McpClient>;

/**
 * Connect one server. The stdio spawn happens inside @ai-sdk/mcp (shell:false); launch adaptation only changes
 * the in-memory command tuple for Windows shims, and our code never touches node:child_process.
 */
export const defaultConnect: McpConnect = (entry) => {
  const { config } = entry;
  if (isStdioConfig(config)) {
    const launch = resolveStdioLaunch(config);
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: launch.command,
        args: launch.args,
        env: config.env,
        cwd: config.cwd,
      }),
    });
  }
  return createMCPClient({ transport: { type: "http", url: config.url, headers: config.headers } });
};
