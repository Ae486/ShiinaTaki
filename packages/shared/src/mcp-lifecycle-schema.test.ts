/**
 * INPUT:  candidate mcp.* param/result instances (valid + invalid shapes from the frozen three-plane contract)
 * OUTPUT: asserts strict parse/reject behavior, marker-only desired configs, revision-bearing writes, and
 *         sanitized diagnostic shapes that structurally cannot carry a secret value
 * POS:    shared — the standalone MCP lifecycle schema test (operator-only surface; deliberately NOT in
 *         protocol-fixtures.test.ts — no Rust serde mirror exists for mcp.* frames)
 */
import { describe, expect, it } from "vitest";
import {
  MCP_METHODS,
  McpAddParamsSchema,
  McpCandidateOutcomeSchema,
  McpDesiredServerSchema,
  McpEditParamsSchema,
  McpListResultSchema,
  McpRemoveResultSchema,
  McpServerStatusSchema,
  McpServerViewSchema,
  McpTestParamsSchema,
  McpTestResultSchema,
} from "./mcp-lifecycle-schema.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HOST = "11111111-1111-4111-8111-111111111111";
const STDIO = { command: "node", args: ["server.mjs"], env: { TOKEN: "secret-ref:mcp.github.env.TOKEN" } };

describe("MCP_METHODS", () => {
  it("names the operator lifecycle surface exactly", () => {
    expect(MCP_METHODS).toEqual({
      list: "mcp.list",
      get: "mcp.get",
      add: "mcp.add",
      edit: "mcp.edit",
      enable: "mcp.enable",
      disable: "mcp.disable",
      remove: "mcp.remove",
      test: "mcp.test",
      reconnect: "mcp.reconnect",
      status: "mcp.status",
    });
  });
});

describe("desired server wire shapes", () => {
  it("parses a stdio row carrying an opaque secret-ref marker", () => {
    const parsed = McpDesiredServerSchema.safeParse({
      serverId: "github", ownerHostId: HOST, config: STDIO, enabled: true,
      selectedTools: [], configRevision: 1, createdAt: NOW, updatedAt: NOW,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects plaintext desired env/header values while accepting valid catalog markers", () => {
    expect(McpAddParamsSchema.safeParse({
      serverId: "plain", config: { command: "node", env: { TOKEN: "plaintext-secret" } },
    }).success).toBe(false);
    expect(McpAddParamsSchema.safeParse({
      serverId: "marked", config: { url: "https://mcp.example", headers: { Authorization: "secret-ref:mcp.marked.header.Authorization" } },
    }).success).toBe(true);
  });

  it.each([
    "files.prod", // a dot folds to '_' colliding with the literal `files_prod` prefix
    "-leading", // the first character must be alphanumeric
    "",
    `s${"x".repeat(65)}`,
  ])("rejects the serverId %s", (serverId) => {
    expect(McpDesiredServerSchema.safeParse({
      serverId, ownerHostId: HOST, config: STDIO, enabled: true,
      selectedTools: [], configRevision: 1, createdAt: NOW, updatedAt: NOW,
    }).success).toBe(false);
  });

  it("rejects a smuggled extra field (strictObject) and a non-revision", () => {
    expect(McpDesiredServerSchema.safeParse({
      serverId: "a", ownerHostId: HOST, config: STDIO, enabled: true, selectedTools: [],
      configRevision: 0, createdAt: NOW, updatedAt: NOW,
    }).success).toBe(false);
    expect(McpDesiredServerSchema.safeParse({
      serverId: "a", ownerHostId: HOST, config: STDIO, enabled: true, selectedTools: [],
      configRevision: 1, createdAt: NOW, updatedAt: NOW, value: "x",
    }).success).toBe(false);
  });
});

describe("writes carry expectedConfigRevision", () => {
  it("add defaults enabled/selectedTools and never carries a revision (a new row starts at 1)", () => {
    expect(McpAddParamsSchema.safeParse({ serverId: "a", config: STDIO }).success).toBe(true);
    expect(McpAddParamsSchema.safeParse({ serverId: "a", config: STDIO, value: "sentinel" }).success).toBe(false);
  });

  it("rejects an edit without the optimistic revision", () => {
    expect(McpEditParamsSchema.safeParse({
      serverId: "a", config: STDIO, selectedTools: [], expectedConfigRevision: 1,
    }).success).toBe(true);
    expect(McpEditParamsSchema.safeParse({ serverId: "a", config: STDIO, selectedTools: [] }).success).toBe(false);
  });

  it("test accepts exactly one of an existing serverId or an unsaved config", () => {
    expect(McpTestParamsSchema.safeParse({ serverId: "a" }).success).toBe(true);
    expect(McpTestParamsSchema.safeParse({ config: { url: "https://mcp.example" } }).success).toBe(true);
    expect(McpTestParamsSchema.safeParse({ serverId: "a", config: STDIO }).success).toBe(false);
    expect(McpTestParamsSchema.safeParse({}).success).toBe(false);
  });
});

describe("candidate outcomes and status projections", () => {
  it("discriminates published/failed/tested with sanitized fields only", () => {
    expect(McpCandidateOutcomeSchema.safeParse({
      status: "published", at: NOW, runtimeGeneration: 1, toolNames: ["echo"], skipped: [], pages: 1, durationMs: 12,
    }).success).toBe(true);
    expect(McpCandidateOutcomeSchema.safeParse({
      status: "failed", at: NOW, reason: "secret-unresolvable", message: "secret mcp.a.env.K is not resolvable",
    }).success).toBe(true);
    expect(McpCandidateOutcomeSchema.safeParse({
      status: "tested", at: NOW, ok: false, reason: "connect-failed", message: "spawn ENOENT", toolNames: [], skipped: [], pages: 1, durationMs: 5,
    }).success).toBe(true);
    expect(McpCandidateOutcomeSchema.safeParse({ status: "published", at: NOW }).success).toBe(false);
  });

  it("status is structurally value-free and generation-nullable", () => {
    expect(McpServerStatusSchema.safeParse({
      serverId: "a", phase: "failed", runtimeGeneration: null, leaseCount: 0, toolCount: 0,
      lastOutcome: { status: "failed", at: NOW, reason: "connect-failed", message: "spawn ENOENT" },
    }).success).toBe(true);
    expect(McpServerStatusSchema.safeParse({
      serverId: "a", phase: "connected", runtimeGeneration: 1, leaseCount: 2, toolCount: 3, lastOutcome: null, env: {},
    }).success).toBe(false);
  });

  it("the merged view keeps desired + status under one strict envelope", () => {
    const view = {
      serverId: "a", ownerHostId: HOST, config: STDIO, enabled: true, selectedTools: [],
      configRevision: 2, createdAt: NOW, updatedAt: NOW,
      status: { serverId: "a", phase: "connected", runtimeGeneration: 3, leaseCount: 0, toolCount: 1, lastOutcome: null },
    };
    expect(McpServerViewSchema.safeParse(view).success).toBe(true);
    expect(McpListResultSchema.safeParse({ servers: [view] }).success).toBe(true);
    expect(McpRemoveResultSchema.safeParse({ status: "removed", serverId: "a" }).success).toBe(true);
  });

  it("a test result never carries a value-shaped field", () => {
    expect(McpTestResultSchema.safeParse({
      status: "ok", toolNames: ["echo"], skipped: [], pages: 1, durationMs: 10,
    }).success).toBe(true);
    expect(McpTestResultSchema.safeParse({
      status: "ok", toolNames: ["echo"], skipped: [], pages: 1, durationMs: 10, value: "sentinel",
    }).success).toBe(false);
  });
});
