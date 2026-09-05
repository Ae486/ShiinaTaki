import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServerView } from "@taki/shared";
import { McpServerCard } from "./mcp-server-card.tsx";
import { mcpDiagnosticKey } from "./mcp-labels.ts";
import { resolveSelectedServer } from "./mcp-state.ts";

const NOW = "2026-08-16T00:00:00.000Z";
const HOST = "11111111-1111-4111-8111-111111111111";

function view(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverId: "github",
    ownerHostId: HOST,
    config: { command: "node", args: ["server.mjs"] },
    enabled: true,
    selectedTools: [],
    configRevision: 3,
    createdAt: NOW,
    updatedAt: NOW,
    status: { serverId: "github", phase: "connected", runtimeGeneration: 2, leaseCount: 0, toolCount: 4, lastOutcome: null },
    ...overrides,
  };
}

const noop = () => undefined;
const actions = {
  disabled: false,
  confirmRemove: false,
  diagnosticsDismissed: false,
  onDismissDiagnostics: noop,
  onAskRemove: noop,
  onCancelRemove: noop,
  onConfirmRemove: noop,
  onToggleEnabled: noop,
  onEdit: noop,
  onReconnect: noop,
  onTest: noop,
};

function card(server: McpServerView, overrides: Partial<typeof actions> = {}): string {
  return renderToStaticMarkup(<McpServerCard server={server} {...actions} {...overrides} />);
}

describe("MCP page components", () => {
  it("renders useful configuration, selected tools and actions without exposing internal bookkeeping", () => {
    const server = view({
      configRevision: 914731,
      status: { ...view().status, runtimeGeneration: 825462 },
      selectedTools: ["get_issue", "search_issues"],
    });
    const markup = card(server);
    expect(markup).toContain("github");
    expect(markup).toContain("已连接");
    expect(markup).toContain("工具 4");
    expect(markup).toContain("stdio · node server.mjs");
    expect(markup).toContain("测试");
    expect(markup).toContain("重连");
    expect(markup).toContain("停用");
    expect(markup).toContain("编辑");
    expect(markup).toContain("移除");
    expect(markup).toContain("选定工具");
    expect(markup).toContain("get_issue、search_issues");
    expect(markup).toContain("<details");
    expect(markup).not.toMatch(/<details[^>]*\bopen\b/u);
    // Static markup includes disclosure bodies, titles and accessible names, not just the card face.
    expect(markup).not.toMatch(/修订|代次|Owner|复制/u);
    expect(markup).not.toContain(HOST);
    expect(markup).not.toContain(String(server.configRevision));
    expect(markup).not.toContain(String(server.status.runtimeGeneration));
  });

  it("keeps a successful connection's tool count and measured duration without an empty disclosure", () => {
    const published = {
      status: "published" as const, at: NOW, runtimeGeneration: 472915,
      toolNames: ["get_issue", "search_issues"], skipped: [], pages: 17, durationMs: 247,
    };
    const markup = card(view({ status: { ...view().status, lastOutcome: published } }));
    expect(markup).toContain("最近连接成功：2 个工具");
    expect(markup).toContain("耗时 247 毫秒");
    expect(markup).toContain("测试");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("页列举");
    expect(markup).not.toContain(String(published.pages));
    expect(markup).not.toContain(String(published.runtimeGeneration));
  });

  it("renders the partial-failure diagnostics truthfully and lets the operator dismiss it per outcome", () => {
    const failedView = view({
      status: {
        serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 2,
        lastOutcome: { status: "failed", at: NOW, reason: "secret-unresolvable", message: "secret mcp.github.env.TOKEN is not resolvable" },
      },
    });
    const markup = card(failedView);
    expect(markup).toContain("密钥无法解析");
    expect(markup).toContain("现有连接仍可使用");
    expect(markup).not.toMatch(/候选|代次/u);
    expect(markup).toContain("知道了");
    expect(card(failedView, { diagnosticsDismissed: true })).not.toContain("密钥无法解析");
    // a NEW outcome (different timestamp) is a different dismiss key, so a fresh failure re-shows the banner
    const later = view({
      status: {
        serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 2,
        lastOutcome: { status: "failed", at: "2026-08-17T00:00:00.000Z", reason: "connect-failed", message: "boom" },
      },
    });
    expect(mcpDiagnosticKey(failedView)).not.toBe(mcpDiagnosticKey(later));
  });

  it.each([
    { phase: "failed" as const, runtimeGeneration: null },
    { phase: "draining" as const, runtimeGeneration: 2 },
    { phase: "connecting" as const, runtimeGeneration: 2 },
    { phase: "connected" as const, runtimeGeneration: null },
  ])("does not promise an active connection for $phase with runtime $runtimeGeneration", (status) => {
    const markup = card(view({
      status: {
        ...view().status, ...status,
        lastOutcome: { status: "failed", at: NOW, reason: "deadline-exceeded", message: "连接未能在期限内完成" },
      },
    }));
    expect(markup).toContain("最近一次连接失败");
    expect(markup).toContain("操作超时");
    expect(markup).toContain("连接未能在期限内完成");
    expect(markup).toContain("知道了");
    expect(markup).not.toContain("现有连接仍可使用");
    expect(markup).not.toMatch(/候选|代次/u);
  });

  it("renders the disabled state and the two-step remove confirm", () => {
    const disabledMarkup = card(
      view({ enabled: false, status: { serverId: "github", phase: "disabled", runtimeGeneration: null, leaseCount: 0, toolCount: 0, lastOutcome: null } }),
    );
    expect(disabledMarkup).toContain("已停用");
    expect(disabledMarkup).toContain("启用");

    const confirming = card(view(), { confirmRemove: true });
    expect(confirming).toContain("确认移除");
    expect(confirming).toContain("取消");
  });

  it("never renders a secret value: marker-carrying configs show only the opaque ref or the field name", () => {
    const SENTINEL = "plaintext-sentinel-value-9f1e";
    const markup = card(
      view({
        config: { command: "node", env: { TOKEN: `secret-ref:mcp.github.env.TOKEN`, OTHER: SENTINEL } },
      }),
    );
    expect(markup).not.toContain(SENTINEL); // the card renders transport facts only — never env/header maps
    expect(markup).not.toContain("secret-ref");
  });

  it("resolves the detail-pane target: the operator's selection, else the first row (L2)", () => {
    const servers = [view(), view({ serverId: "tavily" })];
    expect(resolveSelectedServer(servers, "tavily")?.serverId).toBe("tavily");
    expect(resolveSelectedServer(servers, null)?.serverId).toBe("github");
    expect(resolveSelectedServer(servers, "ghost")?.serverId).toBe("github");
    expect(resolveSelectedServer([], "github")).toBeNull();
    expect(resolveSelectedServer(null, null)).toBeNull();
  });
});
