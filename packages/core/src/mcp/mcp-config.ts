/**
 * INPUT:  raw mcp-servers.json text (the seed-only legacy input) or candidate config objects
 * OUTPUT: McpServerEntry/config types + zod schemas + parseMcpServers(raw) strict body parse
 * POS:    core/mcp — operator-owned MCP server config; NEVER agent-reachable (AC #8-2). The file is a SEED-ONLY
 *         legacy input (mcp-desired-repo reads it once while the desired table is empty, after the secret
 *         migration); env/header VALUES may be `secret-ref:` markers once the catalog migration rewrote them
 */
import { z } from "zod";

// stdio: an operator-configured child process (ADR 0006 spawn happens inside @ai-sdk/mcp, never our code).
// The transport boundary adapts common Windows .cmd/.bat shims at runtime; persisted command/args stay portable.
const StdioServerConfigSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});
export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;

// http: a Streamable HTTP MCP endpoint.
const HttpServerConfigSchema = z.strictObject({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;

export const McpServerConfigSchema = z.union([StdioServerConfigSchema, HttpServerConfigSchema]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

const McpServersFileSchema = z.record(z.string().min(1), McpServerConfigSchema);

export interface McpServerEntry {
  key: string;
  config: McpServerConfig;
}

/** Public, secret-free fingerprint input used only to invalidate transitional governance subject bindings. */
export function mcpPublicConfig(config: McpServerConfig): unknown {
  if (isStdioConfig(config)) return { command: config.command, args: config.args ?? [], cwd: config.cwd ?? null };
  return { url: config.url };
}

export function isStdioConfig(config: McpServerConfig): config is StdioServerConfig {
  return "command" in config;
}

/** Strict parse of the file body; the secret migration reuses it so a rewrite only ever follows a valid read. */
export function parseMcpServers(raw: string): { ok: true; servers: Record<string, McpServerConfig> } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const result = McpServersFileSchema.safeParse(parsed);
  return result.success ? { ok: true, servers: result.data } : { ok: false };
}
