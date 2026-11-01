import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localStatus } from "./pages/operations/memory-authority-fixtures.ts";
import { OperationsPage } from "./pages/operations/operations-page.tsx";
import { CostumePage } from "./pages/costume/costume-page.tsx";
import { PerceptionPage } from "./pages/perception/perception-page.tsx";
import { McpPage } from "./pages/mcp/mcp-page.tsx";
import { PageHeader } from "./page-chrome.tsx";
import type { CostumePageView } from "./pages/costume/use-costume-page.ts";
import type { OperationsView } from "./pages/operations/use-operations.ts";
import type { McpServersView } from "./pages/mcp/use-mcp.ts";
import type { usePerception } from "./pages/perception/use-perception.ts";

const hooks = vi.hoisted(() => ({ operations: vi.fn(), memoryOperations: vi.fn(), costume: vi.fn(), perception: vi.fn(), mcp: vi.fn() }));
vi.mock("./pages/operations/use-memory-operations.ts", () => ({ useMemoryOperations: hooks.memoryOperations }));
vi.mock("./pages/operations/use-operations.ts", () => ({ useOperations: hooks.operations }));
vi.mock("./pages/costume/use-costume-page.ts", () => ({ useCostumePage: hooks.costume }));
vi.mock("./pages/perception/use-perception.ts", () => ({ usePerception: hooks.perception }));
vi.mock("./pages/mcp/use-mcp.ts", () => ({ useMcpServers: hooks.mcp }));
vi.mock("@/features/character-import/use-character-import.js", () => ({ useCharacterImport: () => ({ result: null, warnings: [], error: null, isImporting: false, importFile: async () => undefined }) }));

const read = async () => undefined;
const ops: OperationsView = {
  status: null, usage: null, statusLoading: false, usageLoading: false, statusError: null, usageError: null,
  refreshStatus: read, refreshUsage: read, connectionReady: true, tidy: null, tidyFailure: null, tidying: false, refreshError: null, refreshing: false,
  clear: { phase: "idle", error: null, onEvent: () => undefined }, error: null, refresh: read, runTidy: read,
};
const costume: CostumePageView = {
  view: { rows: [], missingPacks: [], current: null }, hasSnapshot: false, connectionReady: true,
  listError: null, loading: false, refreshing: false, error: null, selected: null, pending: null,
  select: read, cancel: () => undefined, refresh: read, invalidate: read,
};
const perception: ReturnType<typeof usePerception> = {
  kind: "idle", card: null, pause: null, error: null, pauseError: null, pending: false, stale: true, observation: "idle",
  connectionReady: true, loading: false, refreshing: false, refresh: read, setPause: read,
};
const mcp: McpServersView = {
  state: { kind: "idle", token: 0, previous: null }, connectionReady: true, pending: null, feedback: null, observation: "idle",
  refresh: read, add: async () => ({ ok: true }), edit: async () => ({ ok: true }),
  setEnabled: read, remove: read, reconnect: read, test: read,
};
beforeEach(() => {
  hooks.operations.mockReturnValue(ops);
  hooks.memoryOperations.mockReturnValue({ status: localStatus(), loading: false, error: null, busyKey: null, feedback: null,
    connectionReady: true, refresh: read, submitSync: read, cancel: read });
  hooks.costume.mockReturnValue(costume);
  hooks.perception.mockReturnValue(perception);
  hooks.mcp.mockReturnValue(mcp);
});

describe("resource page cold, empty and stale states", () => {
  it("keeps a fast background refresh out of the visible page heading", () => {
    const html = renderToStaticMarkup(<PageHeader title="Settings" busy />);
    expect(html.replace(/<[^>]*>/g, "")).toBe("Settings");
  });

  it("retains populated Perception content without inserting transient refresh paragraphs", () => {
    const card = {
      current: { processName: "Code.exe", windowTitle: "main.ts", startedAt: 1, durationMs: 300_000, samples: 5, idle: false },
      recent: [{ processName: "Browser.exe", windowTitle: "Earlier", startedAt: 0, durationMs: 120_000, samples: 2, idle: false }],
      samplingStatus: { foreground: true, ambientScreen: false },
      pauseState: { paused: false, until: null },
    };
    hooks.perception.mockReturnValue({ ...perception, kind: "loading", card, pause: card.pauseState,
      refreshing: true, stale: true, observation: "live" });
    const html = renderToStaticMarkup(<PerceptionPage />);
    const visibleText = html.replace(/<[^>]*>/g, "");
    expect(visibleText).toContain("Code.exe · main.ts");
    expect(visibleText).toContain("Browser.exe · Earlier");
    expect(visibleText).not.toMatch(/刷新中|正在更新隐私状态|上次采样调度信息，当前状态尚未确认/u);
    expect(visibleText).not.toContain("暂无活动记录");
    expect(html).not.toContain("animate-pulse");
  });

  it("renders independent Operations failures with retries and no never-ending skeleton", () => {
    hooks.operations.mockReturnValue({ ...ops, statusError: "status failed", usageError: "usage failed" });
    const html = renderToStaticMarkup(<OperationsPage />);
    expect(html).toContain("status failed");
    expect(html).toContain("usage failed");
    expect(html.match(/重试/g)).toHaveLength(2);
    expect(html).not.toContain("animate-pulse");
  });

  it("retains last-good Operations counters while one resource refreshes or fails", () => {
    hooks.operations.mockReturnValue({ ...ops, usage: { attachmentCount: 2, attachmentBytes: 2048, memoryTextBytes: 1024 }, usageError: "stale", refreshing: true });
    const html = renderToStaticMarkup(<OperationsPage />);
    expect(html).toContain("2 个 / 2.0 KB");
    expect(html).toContain("stale");
    expect(html).not.toContain("animate-pulse");
  });

  it("distinguishes a failed unknown costume list from an empty success and actual previous results", () => {
    hooks.costume.mockReturnValue({ ...costume, listError: "offline" });
    const failed = renderToStaticMarkup(<CostumePage />);
    expect(failed).toContain("offline");
    expect(failed).not.toMatch(/尚未导入角色|上次结果|animate-pulse/u);
    hooks.costume.mockReturnValue({ ...costume, hasSnapshot: true });
    expect(renderToStaticMarkup(<CostumePage />)).toContain("尚未导入角色");
    hooks.costume.mockReturnValue({ ...costume, hasSnapshot: true, listError: "offline" });
    expect(renderToStaticMarkup(<CostumePage />)).toContain("下方为上次结果");
  });

  it("does not claim empty activity or keep loading after a cold Perception failure", () => {
    hooks.perception.mockReturnValue({ ...perception, kind: "failure", error: "offline" });
    const html = renderToStaticMarkup(<PerceptionPage />);
    expect(html).toContain("offline");
    expect(html).toContain("隐私暂停状态尚未确认");
    expect(html).not.toMatch(/暂无活动记录|animate-pulse|观察进行中/u);
    hooks.perception.mockReturnValue({ ...perception, kind: "ready", stale: false,
      card: { current: null, recent: [], samplingStatus: { foreground: false, ambientScreen: false }, pauseState: { paused: false, until: null } } });
    expect(renderToStaticMarkup(<PerceptionPage />)).toContain("暂无活动记录");
  });

  it("keeps MCP's previous server subtree when the list enters refreshing", () => {
    hooks.mcp.mockReturnValue({ ...mcp, state: { kind: "loading", token: 0, previous: [{
      serverId: "github", ownerHostId: "11111111-1111-4111-8111-111111111111", config: { command: "node" },
      enabled: true, selectedTools: [], configRevision: 1, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
      status: { serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 3, lastOutcome: null },
    }] } });
    const html = renderToStaticMarkup(<McpPage />);
    expect(html).toContain("github");
    expect(html).toContain("编辑");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("尚未配置 MCP 服务器");
  });
});
