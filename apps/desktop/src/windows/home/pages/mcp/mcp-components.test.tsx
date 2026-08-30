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
  it("renders the display name card with phase badge, tool count and the collapsed technical disclosure", () => {
    const markup = card(view());
    expect(markup).toContain("github");
    expect(markup).toContain("已连接");
    expect(markup).toContain("工具 4");
    expect(markup).toContain("stdio · node server.mjs");
    expect(markup).toContain("测试");
    expect(markup).toContain("重连");
    expect(markup).toContain("移除");
    // 修订/代次/Owner live inside the 运行与配置详情 disclosure (U2), with copy affordances — never as card badges.
    expect(markup).toContain("运行与配置详情");
    expect(markup).toContain("修订");
    expect(markup).toContain("代次");
    expect(markup).toContain("Owner");
    expect(markup).toContain('aria-label="复制 Owner"');
    expect(markup).not.toContain(">修订 3<");
    expect(markup).not.toContain(">代次 2<");
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
    expect(markup).toContain("上一次良好代次继续服务");
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
