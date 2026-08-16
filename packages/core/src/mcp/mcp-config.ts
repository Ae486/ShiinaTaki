/**
 * INPUT:  the mcp-servers.json path under the app data root (TAKI_DATA_DIR) + a logger
 * OUTPUT: McpServerEntry types + loadMcpConfig(filePath, log) -> McpServerEntry[] + parseMcpServers(raw)
 * POS:    core/mcp — operator-owned MCP server config; NEVER agent-reachable (AC #8-2). Missing/malformed degrades to [];
 *         env/header VALUES may be `secret-ref:` markers once the encrypted-catalog migration has rewritten them
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";

// stdio: an operator-configured child process (ADR 0006 spawn happens inside @ai-sdk/mcp, never our code).
// Windows note: `command` must be a real exe (`node`) or `cmd /c npx ...` — the transport spawns with shell:false.
const StdioServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});
export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;

// http: a Streamable HTTP MCP endpoint.
const HttpServerConfigSchema = z.object({
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

/**
 * MCP is an extension surface, not auth state: a missing file is zero servers (normal boot), and a malformed
 * file is a boot WARNING + zero servers — never a crash (contrast devices.json, which stays fatal). This keeps
 * the companion alive when an operator hand-edits the config wrong.
 */
export function loadMcpConfig(filePath: string, log: Logger): McpServerEntry[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    log.warn({ filePath, err: readable(error) }, "mcp config unreadable; starting with no MCP servers");
    return [];
  }
  const parsed = parseMcpServers(raw);
  if (!parsed.ok) {
    log.warn({ filePath }, "mcp config is malformed; starting with no MCP servers");
    return [];
  }
  return Object.entries(parsed.servers).map(([key, config]) => ({ key, config }));
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

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
