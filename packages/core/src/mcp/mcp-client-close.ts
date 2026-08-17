/**
 * INPUT:  connected MCP clients whose ownership may cross candidate, publication, and shutdown races
 * OUTPUT: closeMcpClient(client) — one shared close promise per client, with close failures contained
 * POS:    core/mcp — the process-local exactly-once transport close guard; it owns no runtime generation state
 */
import type { McpClient } from "./mcp-connect.ts";

const closePromises = new WeakMap<McpClient, Promise<void>>();

/** Every owner observes the same settlement and the underlying client close starts at most once. */
export function closeMcpClient(client: McpClient): Promise<void> {
  const existing = closePromises.get(client);
  if (existing) return existing;
  let closing: Promise<void>;
  try {
    closing = Promise.resolve(client.close()).catch(() => undefined);
  } catch {
    closing = Promise.resolve();
  }
  closePromises.set(client, closing);
  return closing;
}
