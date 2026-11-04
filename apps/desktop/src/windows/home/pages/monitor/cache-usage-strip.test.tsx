import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CacheUsageWindowSnapshot } from "@taki/shared";
import { CacheUsageStrip } from "./cache-usage-strip.tsx";
import { INITIAL_MONITOR_STATE, type MonitorController } from "./monitor-controller.ts";
import { MonitorWorkspace } from "./monitor-page.tsx";
import type { CacheUsageView } from "./cache-usage-controller.ts";

const snapshot: CacheUsageWindowSnapshot = {
  scope: "all-observed-model-requests", characterId: "taki", summaryRevision: 6,
  summaryCommittedAt: "2026-11-01T10:00:00.000Z", boundary: "captured", status: "ready",
  computedAt: "2026-11-01T11:00:00.000Z", observedRequests: 3, pairedRequests: 2,
  inputTokens: 100, cacheReadTokens: 80, ratio: 0.8, reason: null,
};
const view: CacheUsageView = { phase: "live", snapshot, latestPrimaryRequest: null, error: null };
const render = (value: CacheUsageView, connected = true) =>
  renderToStaticMarkup(<CacheUsageStrip view={value} connected={connected} retry={vi.fn()} />);

describe("rendered Monitor cache strip", () => {
  it("shows the weighted percentage, global scope, coverage and real update timestamp without internal identity", () => {
    const html = render(view);
    expect(html).toContain("80.0%");
    expect(html).toContain("本次摘要以来");
    expect(html).toContain("包含对话与后台请求");
    expect(html).toContain("有效缓存数据 2 / 3 次请求");
    expect(html).toContain('dateTime="2026-11-01T11:00:00.000Z"');
    expect(html).toContain("同一批请求的输入令牌总数");
    expect(html).not.toMatch(/summaryRevision|characterId|all-observed-model-requests|captured|taki/);
  });

  it("shows explicit zero as 0.0% and empty pre-first-summary data as --", () => {
    expect(render({ ...view, snapshot: { ...snapshot, ratio: 0, cacheReadTokens: 0 } })).toContain("0.0%");
    const html = render({ ...view, snapshot: { ...snapshot, summaryRevision: 0, summaryCommittedAt: null,
      boundary: "before-first-summary", status: "empty", observedRequests: 1, pairedRequests: 0,
      inputTokens: 0, cacheReadTokens: 0, ratio: null } });
    expect(html).toContain("首次摘要前"); expect(html).toContain("暂无有效数据");
    expect(html).toContain("有效缓存数据 0 / 1 次请求"); expect(html).toContain("--");
    expect(html).not.toContain("0.0%");
  });

  it.each([
    ["boundary-unknown", "摘要统计边界未知"],
    ["data-inconsistent", "统计数据不一致"],
    ["read-failed", "缓存统计读取失败"],
  ] as const)("renders %s truthfully without prior percentages", (reason, label) => {
    const html = render({ ...view, snapshot: { ...snapshot, status: "unavailable", boundary: null,
      observedRequests: null, pairedRequests: null, inputTokens: null, cacheReadTokens: null, ratio: null, reason } });
    expect(html).toContain(label); expect(html).toContain("有效缓存数据未知");
    expect(html).not.toContain("80.0%");
    expect(html.includes(">重试</button>")).toBe(reason === "read-failed");
  });

  it("labels retained disconnected/error results stale and disables a retry without a client", () => {
    const stale = render({ ...view, phase: "stale" }, false);
    expect(stale).toContain("80.0%"); expect(stale).toContain("上次结果已过期");
    const failed = render({ ...view, phase: "error", error: "缓存统计读取失败" }, false);
    expect(failed).toContain("上次结果已过期"); expect(failed).toContain("缓存统计读取失败");
    expect(failed).toContain("disabled");
  });

  it("renders cold loading and connection/disabled states without synthetic measurements", () => {
    expect(render({ ...view, phase: "loading", snapshot: null })).toContain("正在读取统计…");
    expect(render({ ...view, phase: "stale", snapshot: null }, false)).toContain("等待连接恢复");
    expect(render({ ...view, phase: "disabled", snapshot: null })).toContain("运行监视未启用");
  });

  it("places the independent strip below policy and before the Run workspace with no selected Run", () => {
    const controller = { select: vi.fn(), refresh: vi.fn() } as unknown as MonitorController;
    const page = <MonitorWorkspace view={{ ...INITIAL_MONITOR_STATE, mode: "FULL_LOCAL" }} controller={controller}
      connectionKind="connected" visible policy={<div>政策诊断</div>}
      cache={<CacheUsageStrip view={view} connected retry={vi.fn()} />} />;
    const html = renderToStaticMarkup(page);
    expect(html.indexOf("政策诊断")).toBeLessThan(html.indexOf("整体输入缓存命中率"));
    expect(html.indexOf("整体输入缓存命中率")).toBeLessThan(html.indexOf('aria-label="执行记录"'));
    expect(html).toContain("80.0%");
    const disabled = renderToStaticMarkup(<MonitorWorkspace view={INITIAL_MONITOR_STATE} controller={controller}
      connectionKind="connected" visible cache={<CacheUsageStrip view={view} connected retry={vi.fn()} />} />);
    expect(disabled).not.toContain("80.0%");
  });
});
