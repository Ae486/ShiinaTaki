import { describe, expect, it, vi } from "vitest";
import type { McpDesiredServer, McpServerStatus } from "@taki/shared";
import type { McpDesiredRepo } from "./mcp-desired-repo.ts";
import { createMcpLifecycleService, McpRefusedError } from "./mcp-lifecycle-service.ts";
import type { McpManager } from "./mcp-manager.ts";

const NOW = "2026-08-17T00:00:00.000Z";
const ROW: McpDesiredServer = {
  serverId: "srv",
  ownerHostId: "11111111-1111-4111-8111-111111111111",
  config: { command: "node" },
  enabled: false,
  selectedTools: [],
  configRevision: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

function repo(row: McpDesiredServer): McpDesiredRepo {
  return {
    list: () => [row],
    get: () => row,
    add: vi.fn(),
    edit: vi.fn(),
    setEnabled: vi.fn(),
    remove: vi.fn(),
    seedFromLegacyFile: vi.fn(),
  };
}

function manager(status: McpServerStatus): McpManager {
  return {
    tools: () => ({}),
    describe: () => undefined,
    reconcile: vi.fn(),
    applyDesired: vi.fn(),
    disableServer: vi.fn(),
    removeServer: vi.fn(),
    secretCleared: vi.fn(),
    secretUpdated: vi.fn(),
    test: vi.fn(),
    statuses: () => [status],
    close: vi.fn(),
  };
}

describe("MCP lifecycle service runtime truth", () => {
  it("preserves draining status for a disabled desired row", () => {
    const runtime = manager({
      serverId: "srv",
      phase: "draining",
      runtimeGeneration: 1,
      leaseCount: 1,
      toolCount: 1,
      lastOutcome: null,
    });
    const service = createMcpLifecycleService({ repo: repo(ROW), manager: runtime });
    expect(service.get({ serverId: "srv" }).status).toMatchObject({ phase: "draining", leaseCount: 1 });
  });

  it("refuses reconnect for a disabled server instead of publishing hidden runtime tools", async () => {
    const runtime = manager({
      serverId: "srv",
      phase: "disabled",
      runtimeGeneration: null,
      leaseCount: 0,
      toolCount: 0,
      lastOutcome: null,
    });
    const service = createMcpLifecycleService({ repo: repo(ROW), manager: runtime });
    await expect(service.reconnect({ serverId: "srv" })).rejects.toMatchObject({
      reason: "server-disabled",
    } satisfies Partial<McpRefusedError>);
    expect(runtime.applyDesired).not.toHaveBeenCalled();
  });
});
