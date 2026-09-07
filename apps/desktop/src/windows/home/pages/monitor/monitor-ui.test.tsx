import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunMonitorEvent, RunMonitorSummary, TrajectoryInspector, TrajectoryParams, TrajectoryRow } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorController, type MonitorViewState } from "./monitor-controller.ts";
import { MonitorWorkspace } from "./monitor-page.tsx";
import { monitorFilterPeriod } from "./monitor-run-filters.tsx";

const at = "2026-09-06T01:00:00.000Z";
const run: RunMonitorSummary = {
  key: "opaque-run", characterId: "taki", title: "用户发起 · 对话", initiator: "primary", initiatorLabel: "用户发起",
  triggerLabel: "对话", deliveryClass: "class_a", deliveryLabel: "A 类交付", state: "running", queuedAt: at,
  attemptCount: 1, effectCount: 1, modelRequestCount: 1, toolCallCount: 1, toolResultCount: 0, toolSuccessCount: 0,
  toolFailureCount: 0, failureCount: 0, retryCount: 0, provider: "Vendor", modelId: "Model/v1",
  usage: { quality: "reported", inputTokens: 8, outputTokens: 2, totalTokens: 10 },
};
const base = { groupKey: "opaque-attempt", occurredAt: at, surface: "current" as const, surfaceLabel: "当前",
  phase: "model" as const, category: "model" as const, categoryLabel: "模型请求", modelEffectId: "opaque-model" };
const rows: TrajectoryRow[] = [
  { ...base, rowKey: "model-start", seq: 1, kind: "model", eventKind: "model.request.started", label: "模型请求开始", status: "运行中",
    provider: "Vendor", modelId: "Model/v1", startedAt: at },
  { ...base, rowKey: "model-end", seq: 2, kind: "model", eventKind: "model.response.settled", label: "模型响应结束", status: "已完成",
    provider: "Vendor", modelId: "Model/v1", durationMs: 100, timeToFirstOutputMs: 20 },
  { ...base, rowKey: "usage", seq: 3, kind: "usage", phase: "usage", category: "usage", categoryLabel: "用量",
    eventKind: "usage.settled", label: "模型用量", status: "已记录", quality: "上游报告", inputTokens: 8, outputTokens: 2, totalTokens: 10 },
  { ...base, rowKey: "tool-start", seq: 4, kind: "tool", phase: "tool", category: "tool", categoryLabel: "工具",
    eventKind: "tool.call.started", label: "工具调用", status: "已接收", toolName: "opaque-routing-key", displayName: "读取日志",
    invocationId: "opaque-invocation", toolCallId: "opaque-tool-call" },
];

async function setup() {
  let summary = run;
  let tail = 4;
  let view = INITIAL_MONITOR_STATE;
  let notify!: (event: RunMonitorEvent) => void;
  const inspector: TrajectoryInspector = { mode: "FULL_LOCAL", title: "工具调用", detail: [],
    sections: [{ key: "event", fields: [{ label: "状态", value: "已接收" }] }, { key: "tool", fields: [{ label: "工具", value: "读取日志" }] }],
    technical: [{ label: "内部标识", value: "opaque-private-detail" }], technicalCollapsed: true, redactionNotice: "仅展示已记录的语义信息。" };
  const client = {
    monitorState: vi.fn(async () => ({ mode: "FULL_LOCAL", enabled: true })),
    monitorList: vi.fn(async () => ({ runs: [summary] })),
    monitorTrajectory: vi.fn(async (params: TrajectoryParams) => ({
      run: summary, rows: params.tail && params.limit > 1 ? rows : [], hasMore: false, hasOlder: false,
      cursor: { runKey: run.key, seq: params.tail ? tail : params.afterSeq },
    })),
    monitorInspect: vi.fn(async () => inspector),
    subscribeMonitor: vi.fn(async () => undefined), unsubscribeMonitor: vi.fn(async () => undefined),
    onMonitorEvent: vi.fn((handler: (event: RunMonitorEvent) => void) => { notify = handler; return () => undefined; }),
  };
  const controller = createMonitorController((next) => { view = next; });
  controller.bind(client as unknown as WsClient);
  await vi.waitFor(() => expect(view.runs).toHaveLength(1));
  await controller.select(run.key);
  return { controller, client, read: () => view, emit: (event: RunMonitorEvent) => { tail = Math.max(tail, event.cursor); notify(event); },
    summary: (next: RunMonitorSummary) => { summary = next; } };
}

function render(view: MonitorViewState, controller: MonitorController) {
  return renderToStaticMarkup(<MonitorWorkspace view={view} controller={controller} connectionKind="connected" visible />);
}
const visibleText = (markup: string) => markup.replace(/<[^>]*>/g, "");

describe("Monitor controller-to-presentation integration", () => {
  it("renders semantic grouped records and evolves an inspected tool without another detail request", async () => {
    const f = await setup();
    await f.controller.inspect("tool-start");
    let html = render(f.read(), f.controller);
    expect(html).toContain('aria-label="执行轨迹工具栏"');
    expect(html).toContain('aria-label="时间概览"');
    expect(html).toContain('aria-label="搜索已载入记录"');
    expect(html).toContain('aria-label="关闭详情"');
    expect(visibleText(html)).toContain("读取日志");
    expect(visibleText(html)).not.toContain("opaque-");
    const call = rows[3]!;
    if (call.kind !== "tool") throw new Error("invalid fixture");
    const result: TrajectoryRow = { ...call, rowKey: "tool-result", seq: 5, eventKind: "tool.result.settled",
      label: "工具结果", status: "已记录", outcome: "失败", errorClass: "执行错误", startedAt: at, durationMs: 50 };
    f.summary({ ...run, toolResultCount: 1, toolFailureCount: 1, failureCount: 1 });
    f.emit({ runKey: run.key, cursor: 5, row: result, invalidated: false });
    await vi.waitFor(() => expect(f.read().trajectory!.run.toolFailureCount).toBe(1));
    html = render(f.read(), f.controller);
    expect(visibleText(html)).toContain("失败");
    expect(visibleText(html)).toContain("1 条工具结果 · 异常 1");
    expect(visibleText(html)).toContain("50 毫秒（含审批等待）");
    expect(f.client.monitorInspect).toHaveBeenCalledTimes(1);
    expect(f.read().inspectedRowKey).toBe("tool-start");
    expect(html.match(/data-record-key=/g)).toHaveLength(2);
    expect(visibleText(html)).not.toContain("opaque-");
    f.controller.closeInspector();
    expect(render(f.read(), f.controller)).not.toContain('aria-label="记录详情"');
    f.controller.dispose();
  });

  it("keeps an older selected Run visible when the latest list no longer includes it", async () => {
    const f = await setup();
    f.client.monitorList.mockResolvedValue({ runs: [] });
    await f.controller.refresh();
    const html = render(f.read(), f.controller);
    expect(visibleText(html)).toContain("当前查看");
    expect(visibleText(html)).toContain("用户发起 · 对话");
    expect(html).toContain('aria-pressed="true"');
    expect(f.read().selectedRunKey).toBe(run.key);
    expect(visibleText(html)).not.toContain("opaque-");
    f.controller.dispose();
  });

  it("retains last-good content behind read errors and keeps disabled content unavailable", async () => {
    const f = await setup();
    const failed = render({ ...f.read(), stale: true, error: "暂时无法读取运行记录，请检查连接后重试。" }, f.controller);
    expect(failed).toContain('role="alert"');
    expect(visibleText(failed)).toContain("读取日志");
    expect(visibleText(failed)).toContain("当前为上次读取的记录");
    const disabled = render({ ...f.read(), mode: "DISABLED" }, f.controller);
    expect(visibleText(disabled)).toContain("运行监视未启用");
    expect(visibleText(disabled)).not.toContain("读取日志");
    const loading = render({ ...INITIAL_MONITOR_STATE, mode: "FULL_LOCAL", loadingTrajectory: true }, f.controller);
    expect(visibleText(loading)).toContain("正在载入执行轨迹…");
    f.controller.dispose();
  });
});

describe("Run time filters", () => {
  it("uses valid timestamps, accepts inclusive equal endpoints, and rejects reversed/invalid ranges", () => {
    expect(monitorFilterPeriod("2026-09-06T01:00:00Z", "2026-09-06T01:00:00Z"))
      .toEqual({ from: at, to: at, error: null });
    expect(monitorFilterPeriod("", "")).toEqual({ from: undefined, to: undefined, error: null });
    expect(monitorFilterPeriod("2026-09-06T02:00:00Z", "2026-09-06T01:00:00Z").error).toBe("结束时间不能早于起始时间。");
    expect(monitorFilterPeriod("invalid", "").error).toBe("请输入有效的起止时间。");
  });
});
