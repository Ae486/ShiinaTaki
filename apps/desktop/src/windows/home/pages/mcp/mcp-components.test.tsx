import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServerView } from "@taki/shared";
import { McpServerCard } from "./mcp-server-card.tsx";
import { visibleMcpServers } from "./mcp-page.tsx";

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
  onAskRemove: noop,
  onCancelRemove: noop,
  onConfirmRemove: noop,
  onToggleEnabled: noop,
  onEdit: noop,
  onReconnect: noop,
  onTest: noop,
};

describe("MCP page components", () => {
  it("renders the connected success state with revision/generation/tool facts", () => {
    const markup = renderToStaticMarkup(<McpServerCard server={view()} {...actions} />);
    expect(markup).toContain("已连接");
    expect(markup).toContain("修订 3");
    expect(markup).toContain("代次 2");
    expect(markup).toContain("工具 4");
    expect(markup).toContain("测试");
    expect(markup).toContain("重连");
    expect(markup).toContain("移除");
  });

  it("renders the partial-failure state truthfully: last-good keeps serving with a sanitized reason", () => {
    const markup = renderToStaticMarkup(<McpServerCard
      server={view({
        status: {
          serverId: "github", phase: "connected", runtimeGeneration: 1, leaseCount: 0, toolCount: 2,
          lastOutcome: { status: "failed", at: NOW, reason: "secret-unresolvable", message: "secret mcp.github.env.TOKEN is not resolvable" },
        },
      })}
      {...actions}
    />);
    expect(markup).toContain("密钥无法解析");
    expect(markup).toContain("上一次良好代次继续服务");
  });

  it("renders the disabled state and the two-step remove confirm", () => {
    const disabledMarkup = renderToStaticMarkup(
      <McpServerCard server={view({ enabled: false, status: { serverId: "github", phase: "disabled", runtimeGeneration: null, leaseCount: 0, toolCount: 0, lastOutcome: null } })} {...actions} />,
    );
    expect(disabledMarkup).toContain("已停用");
    expect(disabledMarkup).toContain("启用");

    const confirming = renderToStaticMarkup(<McpServerCard server={view()} {...actions} confirmRemove />);
    expect(confirming).toContain("确认移除");
    expect(confirming).toContain("取消");
  });

  it("never renders a secret value: marker-carrying configs show only the opaque ref or the field name", () => {
    const SENTINEL = "plaintext-sentinel-value-9f1e";
    const markup = renderToStaticMarkup(<McpServerCard
      server={view({
        config: { command: "node", env: { TOKEN: `secret-ref:mcp.github.env.TOKEN`, OTHER: SENTINEL } },
      })}
      {...actions}
    />);
    expect(markup).not.toContain(SENTINEL); // the card renders transport facts only — never env/header maps
    expect(markup).not.toContain("secret-ref");
  });

  it("hides the edited server card while its editor is visible", () => {
    expect(visibleMcpServers([view(), view({ serverId: "tavily" })], "github").map((server) => server.serverId)).toEqual(["tavily"]);
    expect(visibleMcpServers([view()], null)).toHaveLength(1);
  });
});
