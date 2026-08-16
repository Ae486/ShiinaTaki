import { describe, expect, it } from "vitest";
import { McpServerConfigSchema, isStdioConfig, parseMcpServers } from "./mcp-config.ts";

describe("parseMcpServers (the seed's strict body parse)", () => {
  it("rejects invalid JSON and wrong shapes; absence is handled by the reader, not the parser", () => {
    expect(parseMcpServers("{ not json").ok).toBe(false);
    expect(parseMcpServers(JSON.stringify({ files: { nonsense: true } })).ok).toBe(false);
  });

  it("parses a mix of stdio and http servers", () => {
    const parsed = parseMcpServers(JSON.stringify({
      files: { command: "node", args: ["server.js"], env: { API_KEY: "x" } },
      remote: { url: "http://localhost:9000/mcp", headers: { Authorization: "Bearer y" } },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.servers).sort()).toEqual(["files", "remote"]);
    expect(isStdioConfig(parsed.servers.files!)).toBe(true);
    expect(isStdioConfig(parsed.servers.remote!)).toBe(false);
  });

  it("keeps the config union strict: an unknown transport field is refused", () => {
    expect(McpServerConfigSchema.safeParse({ command: "node", extra: true }).success).toBe(false);
    expect(McpServerConfigSchema.safeParse({ url: "notaurl" }).success).toBe(false);
  });
});
