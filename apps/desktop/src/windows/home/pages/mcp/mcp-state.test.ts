import { describe, expect, it } from "vitest";
import type { McpServerView } from "@taki/shared";
import {
  applyMcpLoad,
  applyMcpRemoved,
  beginMcpLoad,
  beginMcpMutation,
  draftFromView,
  draftToConfig,
  draftSelectedTools,
  emptyDraft,
  failMcpLoad,
  failMcpMutation,
  mcpAppError,
  mcpFieldSecretRef,
  secretValuesToStore,
  validateDraft,
} from "./mcp-state.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HOST = "11111111-1111-4111-8111-111111111111";

function view(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverId: "github",
    ownerHostId: HOST,
    config: { command: "node", args: ["server.mjs"], env: { TOKEN: "secret-ref:mcp.github.env.TOKEN" } },
    enabled: true,
    selectedTools: [],
    configRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    status: { serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 2, lastOutcome: null },
    ...overrides,
  };
}

describe("mcp view state", () => {
  it("accepts only matching-generation reads and suppresses retired-client results", () => {
    let state = beginMcpLoad(1, null);
    expect(applyMcpLoad(state, { token: 2, servers: [] })).toBe(state); // stale token ignored
    state = applyMcpLoad(state, { token: 1, servers: [view()] });
    expect(state).toMatchObject({ kind: "ready", token: 1, data: [{ serverId: "github" }] });

    const stale = beginMcpMutation(state, 2, "edit:github");
    expect(stale).toBe(state); // a retired client's mutation never touches the fresh view
    const pending = beginMcpMutation(state, 1, "edit:github");
    expect(pending).toMatchObject({ pending: "edit:github", feedback: null });
  });

  it("classifies a validation failure distinctly from a read failure and keeps previous data", () => {
    const ready = applyMcpLoad(beginMcpLoad(3, null), { token: 3, servers: [view()] });
    const validation = failMcpLoad(ready, 3, Object.assign(new Error("bad shape"), { name: "ZodError" }));
    expect(validation).toMatchObject({ kind: "failure", failureKind: "validation", previous: [{ serverId: "github" }] });
    const read = failMcpLoad(validation, 3, new Error("socket died"));
    expect(read).toMatchObject({ kind: "failure", failureKind: "read", previous: [{ serverId: "github" }] });
  });

  it("maps MCP_CONFIG_CONFLICT to a conflict feedback and MCP_REFUSED to a machine reason", () => {
    const ready = applyMcpLoad(beginMcpLoad(1, null), { token: 1, servers: [] });
    const conflict = failMcpMutation(ready, 1, conflictError(4));
    expect(conflict).toMatchObject({ feedback: { kind: "conflict" }, pending: null });
    expect(mcpAppError(conflictError(4))).toEqual({ code: "MCP_CONFIG_CONFLICT", reason: null });

    const refused = failMcpMutation(ready, 1, refusedError("key-collision"));
    expect(refused).toMatchObject({ feedback: { kind: "refused", reason: "key-collision" } });
  });

  it("removal drops only the removed server", () => {
    const ready = applyMcpLoad(beginMcpLoad(1, null), { token: 1, servers: [view(), view({ serverId: "other", config: { url: "https://x.example" } })] });
    const removed = applyMcpRemoved(ready, 1, "github");
    expect(removed.kind === "ready" && removed.data.map((server) => server.serverId)).toEqual(["other"]);
  });
});

function conflictError(currentConfigRevision: number): unknown {
  return { data: { code: "MCP_CONFIG_CONFLICT", currentConfigRevision } };
}
function refusedError(reason: string): unknown {
  return { data: { code: "MCP_REFUSED", reason } };
}

describe("editor draft model", () => {
  it("round-trips a view into a draft whose secret fields are write-only (value empty, hadSecret kept)", () => {
    const draft = draftFromView(view());
    expect(draft.fields).toHaveLength(1);
    expect(draft.fields[0]).toMatchObject({ name: "TOKEN", value: "", secret: true, hadSecret: true });
    // Keeping the stored secret (no new value typed) round-trips the same opaque marker.
    expect(draftToConfig(draft)).toEqual(view().config);
    expect(secretValuesToStore(draft)).toEqual([]); // nothing re-sent unless a new value is typed
  });

  it("derives the same opaque ref the Core's catalog expects (env and header folds)", () => {
    expect(mcpFieldSecretRef("github", "env", "TOKEN")).toBe("mcp.github.env.TOKEN");
    expect(mcpFieldSecretRef("search", "headers", "X-Api-Key")).toBe("mcp.search.header.X-Api-Key");
  });

  it("stores newly typed secret values separately and puts markers into the desired config", () => {
    const draft = { ...emptyDraft(), serverId: "github", command: "node", fields: [
      { id: 1, name: "TOKEN", value: "typed-value", secret: true, hadSecret: true },
      { id: 2, name: "NODE_ENV", value: "production", secret: false, hadSecret: false },
    ] };
    expect(secretValuesToStore(draft)).toEqual([{ secretRef: "mcp.github.env.TOKEN", value: "typed-value" }]);
    expect(draftToConfig(draft)).toEqual({
      command: "node",
      env: { TOKEN: "secret-ref:mcp.github.env.TOKEN", NODE_ENV: "production" },
    });
  });

  it("validates the serverId charset, transport requirements, and secret-field completeness", () => {
    const ids = new Set<string>(["existing"]);
    expect(validateDraft({ ...emptyDraft(), serverId: "files.prod", command: "node" }, ids)).toContain("服务器 ID");
    expect(validateDraft({ ...emptyDraft(), serverId: "existing", command: "node" }, ids)).toContain("已存在");
    expect(validateDraft({ ...emptyDraft(), serverId: "ok" }, ids)).toContain("可执行命令");
    expect(validateDraft({ ...emptyDraft("http"), serverId: "ok", url: "ftp://nope" }, ids)).toContain("http(s)");
    expect(validateDraft({
      ...emptyDraft(), serverId: "ok", command: "node",
      fields: [{ id: 1, name: "TOKEN", value: "", secret: true, hadSecret: false }],
    }, ids)).toContain("需要一个值");
    expect(validateDraft({
      ...emptyDraft(), serverId: "ok", command: "node",
      fields: [{ id: 1, name: "TOKEN", value: "kept", secret: true, hadSecret: true }],
    }, ids)).toBeNull();
    expect(draftSelectedTools({ ...emptyDraft(), selectedTools: "echo\n  search\n\n" })).toEqual(["echo", "search"]);
  });
});
