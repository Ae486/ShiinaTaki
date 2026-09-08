import { describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ConfigChanged, RunMonitorEvent, RunMonitorSummary, TrajectoryInspector, TrajectoryInspectParams, TrajectoryParams, TrajectoryResult, TrajectoryRow,
} from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorController, type MonitorViewState } from "./monitor-controller.ts";
import { MonitorWorkspace } from "./monitor-page.tsx";
import { useTrajectoryWorkspace } from "./use-trajectory-workspace.ts";

const at = "2026-09-08T01:00:00.000Z";
const summary = (key: string): RunMonitorSummary => ({
  key, characterId: "taki", title: `运行 ${key}`, initiator: "primary", initiatorLabel: "用户发起", triggerLabel: "对话",
  deliveryClass: "class_a", deliveryLabel: "A 类交付", state: "running", queuedAt: at,
  attemptCount: 1, effectCount: 0, modelRequestCount: 0, toolCallCount: 2, toolResultCount: 0,
  toolSuccessCount: 0, toolFailureCount: 0, failureCount: 0, retryCount: 0, usage: {},
});
const row = (key: string, seq: number): TrajectoryRow => ({
  rowKey: `${key}-${seq}`, seq, kind: "tool", label: "工具调用", displayName: `${key} 工具 ${seq}`, toolName: "read",
  phase: "tool", category: "tool", categoryLabel: "工具", status: "已接收", occurredAt: at,
  surface: "current", surfaceLabel: "当前",
});
const page = (key: string, start = 1, end = 2): TrajectoryResult => ({
  run: summary(key), rows: Array.from({ length: end - start + 1 }, (_, index) => row(key, start + index)),
  cursor: { runKey: key, seq: end }, hasMore: false, hasOlder: start > 1,
  ...(start > 1 ? { olderCursor: { runKey: key, seq: start } } : {}),
});
const detail = (key: string): TrajectoryInspector => ({
  mode: "FULL_LOCAL", title: `${key} 详情`, detail: [{ label: "内容", value: `${key} 的内容` }],
  technical: [], technicalCollapsed: true, redactionNotice: "仅展示已记录的语义信息。",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const readPage = async (params: TrajectoryParams): Promise<TrajectoryResult> => params.tail ? page(params.runKey)
  : { ...page(params.runKey), rows: [], cursor: { runKey: params.runKey, seq: params.afterSeq } };

function fakeClient() {
  let listener!: (event: RunMonitorEvent) => void;
  const configListeners = new Set<(change: ConfigChanged) => void>();
  const client = {
    monitorState: vi.fn(async () => ({ mode: "FULL_LOCAL", enabled: true })),
    monitorList: vi.fn(async () => ({ runs: [summary("A"), summary("B"), summary("C")] })),
    monitorTrajectory: vi.fn(readPage),
    monitorInspect: vi.fn(async (params: TrajectoryInspectParams) => detail(params.rowKey)),
    subscribeMonitor: vi.fn(async () => undefined), unsubscribeMonitor: vi.fn(async () => undefined),
    onMonitorEvent: vi.fn((handler: (event: RunMonitorEvent) => void) => { listener = handler; return () => undefined; }),
    onConfigChanged: vi.fn((handler: (change: ConfigChanged) => void) => { configListeners.add(handler); return () => { configListeners.delete(handler); }; }),
  };
  return { client, wire: client as unknown as WsClient, notify: (event: RunMonitorEvent) => listener(event),
    changeMode: (value: ConfigChanged["value"]) => { for (const handler of configListeners) handler({ key: "TAKI_MONITOR_MODE", value }); } };
}
async function setup() {
  let view = INITIAL_MONITOR_STATE;
  const states: MonitorViewState[] = [];
  const controller = createMonitorController((next) => { view = next; states.push(next); });
  const transport = fakeClient();
  controller.bind(transport.wire);
  await vi.waitFor(() => expect(view.runs).toHaveLength(3));
  await controller.select("A");
  await controller.inspect("A-1");
  return { ...transport, controller, states, read: () => view };
}
function render(view: MonitorViewState, controller: MonitorController) {
  return renderToStaticMarkup(<MonitorWorkspace view={view} controller={controller} connectionKind="connected" visible />);
}
function inspectorMarkup(view: MonitorViewState, controller: MonitorController) {
  const html = render(view, controller);
  const start = html.indexOf('aria-label="记录详情"');
  return start < 0 ? "" : html.slice(start).split("</aside>")[0] ?? "";
}
function workspace(view: MonitorViewState, controller: MonitorController) {
  let value!: ReturnType<typeof useTrajectoryWorkspace>;
  function Probe() { value = useTrajectoryWorkspace({ view, controller }); return null; }
  renderToStaticMarkup(<Probe />);
  return value;
}
function buttonAction(node: ReactNode, label: string): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === "button" && child.props.children === label) return child.props.onClick;
    const action = buttonAction(child.props.children, label);
    if (action) return action;
  }
  return undefined;
}

describe("Monitor committed Run continuity", () => {
  it("keeps A mounted while B loads, then publishes B identity, rows, cursor and detail reset together", async () => {
    const f = await setup();
    const b = deferred<TrajectoryResult>();
    const previous = f.read();
    const first = f.states.length;
    f.client.monitorTrajectory.mockImplementation((params) => params.tail && params.runKey === "B" ? b.promise : readPage(params));
    const switching = f.controller.select("B");
    expect(f.read()).toMatchObject({ selectedRunKey: "A", requestedRunKey: "B", loadingTrajectory: true, inspectedRowKey: "A-1" });
    expect(f.read().trajectory).toBe(previous.trajectory);
    expect(f.read().inspector).toBe(previous.inspector);
    expect(render(f.read(), f.controller)).not.toContain("正在载入执行轨迹");
    expect(inspectorMarkup(f.read(), f.controller)).toContain("A-1 的内容");
    b.resolve(page("B", 16, 17)); await switching;
    expect(f.read()).toMatchObject({ selectedRunKey: "B", requestedRunKey: undefined, loadingTrajectory: false,
      inspectedRowKey: undefined, inspector: undefined,
      trajectory: { cursor: { runKey: "B", seq: 17 }, olderCursor: { runKey: "B", seq: 16 } } });
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).toEqual(["B-16", "B-17"]);
    expect(f.client.monitorTrajectory).toHaveBeenCalledWith({ characterId: "taki", runKey: "B", afterSeq: 0, tail: true, limit: 100 });
    expect(f.client.subscribeMonitor).toHaveBeenLastCalledWith({ characterId: "taki", runKey: "B", afterSeq: 17 });
    for (const state of f.states.slice(first)) {
      expect(state.trajectory).toBeDefined();
      expect(state.selectedRunKey).toBe(state.trajectory?.run.key);
      expect(state.trajectory?.cursor.runKey).toBe(state.selectedRunKey);
      if (state.selectedRunKey === "B") expect(state.inspector).toBeUndefined();
    }
    f.controller.dispose();
  });

  it.each(["success", "error"] as const)("keeps the latest C after an out-of-order B %s", async (ending) => {
    const f = await setup();
    const b = deferred<TrajectoryResult>(); const c = deferred<TrajectoryResult>();
    f.client.monitorTrajectory.mockImplementation((params) => !params.tail ? readPage(params)
      : params.runKey === "B" ? b.promise : c.promise);
    const first = f.controller.select("B"); const second = f.controller.select("C");
    expect(f.read().selectedRunKey).toBe("A");
    expect(f.read().trajectory?.run.key).toBe("A");
    c.resolve(page("C")); await second;
    if (ending === "success") b.resolve(page("B")); else b.reject(new Error("OBSERVABILITY_DISABLED"));
    await first;
    expect(f.read()).toMatchObject({ selectedRunKey: "C", mode: "FULL_LOCAL", error: null, loadingTrajectory: false });
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).toEqual(["C-1", "C-2"]);
    f.controller.dispose();
  });

  it.each(["network unavailable", "RUN_NOT_FOUND", "OBSERVABILITY_FORBIDDEN"])(
    "retains A when the latest C fails with %s, ignoring an earlier B success", async (cause) => {
      const f = await setup();
      const b = deferred<TrajectoryResult>(); const c = deferred<TrajectoryResult>();
      const previous = f.read();
      f.client.monitorTrajectory.mockImplementation((params) => params.runKey === "B" ? b.promise : c.promise);
      const first = f.controller.select("B"); const second = f.controller.select("C");
      c.reject(new Error(cause)); await second;
      expect(f.read()).toMatchObject({ selectedRunKey: "A", loadingTrajectory: false, requestedRunKey: undefined });
      expect(f.read().trajectory).toBe(previous.trajectory);
      expect(f.read().inspector).toBe(previous.inspector);
      const error = f.read().error;
      expect(error).toContain("切换");
      b.resolve(page("B")); await first;
      expect(f.read().selectedRunKey).toBe("A"); expect(f.read().error).toBe(error);
      if (cause !== "network unavailable") expect(f.read().runs.map((run) => run.key)).not.toContain("C");
      f.controller.dispose();
    },
  );

  it.each(["A", "B"])("repeat-clicking displayed/requested %s deselects immediately and retires B", async (key) => {
    const f = await setup(); const b = deferred<TrajectoryResult>();
    f.client.monitorTrajectory.mockReturnValue(b.promise);
    const switching = f.controller.select("B");
    await f.controller.select(key);
    expect(f.read()).toMatchObject({ selectedRunKey: undefined, trajectory: undefined, inspector: undefined, loadingTrajectory: false });
    b.resolve(page("B")); await switching;
    expect(f.read().trajectory).toBeUndefined(); expect(f.read().selectedRunKey).toBeUndefined();
    f.controller.dispose();
  });

  it("retries the failed B replacement from its error action while A remains displayed", async () => {
    const f = await setup();
    f.client.monitorTrajectory.mockRejectedValueOnce(new Error("network unavailable"));
    await f.controller.select("B");
    const retry = buttonAction(MonitorWorkspace({ view: f.read(), controller: f.controller, connectionKind: "connected", visible: true }), "重试切换");
    expect(retry).toBeDefined();
    retry!();
    await vi.waitFor(() => expect(f.read().selectedRunKey).toBe("B"));
    expect(f.client.monitorList).toHaveBeenCalledTimes(1);
    f.controller.dispose();
  });

  it("keeps pending B independent when displayed A is deleted and cannot be retained", async () => {
    const f = await setup(); const b = deferred<TrajectoryResult>();
    f.client.monitorTrajectory.mockImplementation((params) => params.tail && params.runKey === "B" ? b.promise : readPage(params));
    const switching = f.controller.select("B");
    f.client.monitorInspect.mockRejectedValueOnce(new Error("RUN_NOT_FOUND"));
    await f.controller.inspect("A-2");
    expect(f.read()).toMatchObject({ trajectory: undefined, inspector: undefined, requestedRunKey: "B", loadingTrajectory: true });
    expect(f.read().runs.map((run) => run.key)).not.toContain("A");
    b.resolve(page("B")); await switching;
    expect(f.read().selectedRunKey).toBe("B"); expect(f.read().error).toBeNull();
    f.controller.dispose();
  });

  it.each(["OBSERVABILITY_DISABLED", "FORBIDDEN"])("retires all content and old list responses after %s", async (cause) => {
    const f = await setup(); const list = deferred<{ runs: RunMonitorSummary[] }>();
    f.client.monitorList.mockReturnValueOnce(list.promise);
    const refreshing = f.controller.refresh();
    f.client.monitorTrajectory.mockRejectedValue(new Error(cause));
    await f.controller.select("B");
    expect(f.read()).toMatchObject({ selectedRunKey: undefined, trajectory: undefined, inspector: undefined, runs: [], loadingTrajectory: false });
    if (cause === "OBSERVABILITY_DISABLED") expect(f.read().mode).toBe("DISABLED");
    list.resolve({ runs: [summary("A"), summary("B")] }); await refreshing;
    expect(f.read().runs).toEqual([]); expect(f.read().trajectory).toBeUndefined();
    f.controller.dispose();
  });

  it("keeps displayed-A actions scoped to A during B and refuses their stale callbacks once B commits", async () => {
    const f = await setup(); const b = deferred<TrajectoryResult>();
    const previous = workspace(f.read(), f.controller);
    f.client.monitorTrajectory.mockImplementation((params) => params.tail && params.runKey === "B" ? b.promise : readPage(params));
    const switching = f.controller.select("B");
    previous.actions.select(previous.records[1]!);
    await vi.waitFor(() => expect(f.client.monitorInspect).toHaveBeenLastCalledWith({ characterId: "taki", runKey: "A", rowKey: "A-2" }));
    b.resolve(page("B", 1, 2)); await switching;
    await f.controller.inspect("B-1");
    const reads = f.client.monitorInspect.mock.calls.length;
    const pages = f.client.monitorTrajectory.mock.calls.length;
    previous.actions.select(previous.records[1]!);
    previous.actions.closeInspector();
    await previous.actions.loadOlder();
    expect(f.client.monitorInspect).toHaveBeenCalledTimes(reads);
    expect(f.client.monitorTrajectory).toHaveBeenCalledTimes(pages);
    expect(f.read().inspectedRowKey).toBe("B-1");
    f.controller.dispose();
  });
});

describe("Monitor committed Inspector continuity", () => {
  it("shows truthful initial loading and a retryable error when no detail has committed", async () => {
    const f = await setup(); const next = deferred<TrajectoryInspector>();
    f.controller.closeInspector();
    f.client.monitorInspect.mockReturnValueOnce(next.promise);
    const inspecting = f.controller.inspect("A-2");
    expect(inspectorMarkup(f.read(), f.controller)).toContain("正在读取详情…");
    next.reject(new Error("network unavailable")); await inspecting;
    expect(inspectorMarkup(f.read(), f.controller)).toContain("暂时无法读取运行记录");
    expect(f.read().loadingInspector).toBe(false);
    f.controller.closeInspector();
    expect(inspectorMarkup(f.read(), f.controller)).toBe("");
    f.controller.dispose();
  });

  it("keeps the old row, title, fields and selection together until the new detail commits", async () => {
    const f = await setup(); const b = deferred<TrajectoryInspector>();
    const previous = f.read().inspector;
    f.client.monitorInspect.mockReturnValueOnce(b.promise);
    const switching = f.controller.inspect("A-2");
    expect(f.read()).toMatchObject({ inspectedRowKey: "A-1", requestedRowKey: "A-2", loadingInspector: true });
    expect(f.read().inspector).toBe(previous);
    const pending = inspectorMarkup(f.read(), f.controller);
    expect(pending).toContain("A 工具 1"); expect(pending).toContain("A-1 的内容");
    expect(pending).not.toContain("A 工具 2"); expect(pending).not.toContain("正在读取详情…");
    b.resolve(detail("A-2")); await switching;
    expect(f.read()).toMatchObject({ inspectedRowKey: "A-2", requestedRowKey: undefined, loadingInspector: false });
    const current = inspectorMarkup(f.read(), f.controller);
    expect(current).toContain("A 工具 2"); expect(current).toContain("A-2 的内容");
    expect(current).not.toContain("A-1 的内容");
    f.controller.dispose();
  });

  it.each(["success", "error"] as const)("retains latest Inspector C after an older B %s", async (ending) => {
    const f = await setup(); const b = deferred<TrajectoryInspector>(); const c = deferred<TrajectoryInspector>();
    f.client.monitorInspect.mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise);
    const first = f.controller.inspect("A-2"); const second = f.controller.inspect("A-3");
    expect(f.read().inspectedRowKey).toBe("A-1");
    c.resolve(detail("A-3")); await second;
    if (ending === "success") b.resolve(detail("A-2")); else b.reject(new Error("RUN_NOT_FOUND"));
    await first;
    expect(f.read()).toMatchObject({ selectedRunKey: "A", inspectedRowKey: "A-3", inspector: { title: "A-3 详情" }, inspectorError: null });
    f.controller.dispose();
  });

  it.each(["close", "A-1", "A-2"])("%s immediately closes a warm Inspector and rejects its late replacement", async (action) => {
    const f = await setup(); const b = deferred<TrajectoryInspector>();
    f.client.monitorInspect.mockReturnValueOnce(b.promise);
    const switching = f.controller.inspect("A-2");
    if (action === "close") f.controller.closeInspector(); else await f.controller.inspect(action);
    expect(f.read()).toMatchObject({ inspector: undefined, inspectedRowKey: undefined, loadingInspector: false });
    b.resolve(detail("A-2")); await switching;
    expect(f.read().inspector).toBeUndefined();
    f.controller.dispose();
  });

  it("retains A's detail after the latest replacement fails, ignoring an older success", async () => {
    const f = await setup(); const b = deferred<TrajectoryInspector>(); const c = deferred<TrajectoryInspector>();
    f.client.monitorInspect.mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise);
    const first = f.controller.inspect("A-2"); const second = f.controller.inspect("A-3");
    c.reject(new Error("network unavailable")); await second;
    const error = f.read().inspectorError;
    b.resolve(detail("A-2")); await first;
    expect(f.read()).toMatchObject({ inspectedRowKey: "A-1", inspector: { title: "A-1 详情" }, loadingInspector: false, inspectorError: error });
    f.controller.dispose();
  });

  it.each(["network unavailable", "OBSERVABILITY_EVENT_NOT_FOUND"])("keeps permitted A-1 when requested A-2 fails with %s", async (cause) => {
    const f = await setup(); const previous = f.read().inspector;
    f.client.monitorInspect.mockRejectedValueOnce(new Error(cause));
    await f.controller.inspect("A-2");
    expect(f.read()).toMatchObject({ selectedRunKey: "A", inspectedRowKey: "A-1", loadingInspector: false });
    expect(f.read().inspector).toBe(previous);
    expect(f.read().inspectorError).toContain("切换");
    if (cause === "OBSERVABILITY_EVENT_NOT_FOUND") expect(f.read().trajectory?.rows.map((value) => value.rowKey)).not.toContain("A-2");
    f.controller.dispose();
  });

  it("removes an actually missing displayed record and does not restore it from an older in-flight history page", async () => {
    const f = await setup();
    await f.controller.select("B");
    f.client.monitorTrajectory.mockImplementation((params) => params.tail ? Promise.resolve(page("A", 10, 11)) : readPage(params));
    await f.controller.select("A"); await f.controller.inspect("A-10");
    const older = deferred<TrajectoryResult>();
    f.client.monitorTrajectory.mockImplementation((params) => params.beforeSeq ? older.promise : readPage(params));
    const loading = f.controller.loadMoreTrajectory();
    f.client.monitorInspect.mockRejectedValueOnce(new Error("OBSERVABILITY_EVENT_NOT_FOUND"));
    await f.controller.refresh();
    expect(f.read()).toMatchObject({ selectedRunKey: "A", inspector: undefined, inspectedRowKey: undefined, loadingInspector: false });
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).not.toContain("A-10");
    older.resolve(page("A", 1, 10)); await loading;
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).not.toContain("A-10");
    expect(f.read().inspector).toBeUndefined();
    f.controller.dispose();
  });

  it.each(["RUN_NOT_FOUND", "OBSERVABILITY_FORBIDDEN"])("removes the displayed Run on an Inspector %s and retires an old list read", async (cause) => {
    const f = await setup(); const list = deferred<{ runs: RunMonitorSummary[] }>();
    f.client.monitorList.mockReturnValueOnce(list.promise);
    const refreshing = f.controller.refresh();
    f.client.monitorInspect.mockRejectedValueOnce(new Error(cause));
    await f.controller.inspect("A-2");
    expect(f.read().trajectory).toBeUndefined(); expect(f.read().inspector).toBeUndefined();
    expect(f.read().runs.map((run) => run.key)).not.toContain("A");
    list.resolve({ runs: [summary("A")] }); await refreshing;
    expect(f.read().runs.map((run) => run.key)).not.toContain("A");
    f.controller.dispose();
  });

  it("does not let same-Run restoration replace a newer explicit Inspector request", async () => {
    const f = await setup(); const b = deferred<TrajectoryInspector>();
    f.client.monitorInspect.mockReturnValue(b.promise);
    const switching = f.controller.inspect("A-2");
    const refreshing = f.controller.refresh();
    await vi.waitFor(() => expect(f.client.subscribeMonitor).toHaveBeenCalledTimes(2));
    expect(f.client.monitorInspect).toHaveBeenCalledTimes(2);
    expect(f.read().inspectedRowKey).toBe("A-1");
    b.resolve(detail("A-2")); await Promise.all([switching, refreshing]);
    expect(f.read().inspectedRowKey).toBe("A-2");
    f.controller.dispose();
  });
});

describe("Monitor pending presentation", () => {
  it("keeps warm footer text, filter/history labels and Inspector content stable while busy", async () => {
    const f = await setup();
    const view = { ...f.read(), nextCursor: { key: "older", queuedAt: at },
      trajectory: { ...f.read().trajectory!, hasOlder: true, olderCursor: { runKey: "A", seq: 1 } } };
    const normal = render(view, f.controller).replace(/<[^>]*>/g, "");
    const busy = render({ ...view, loadingRuns: true, loadingTrajectory: true, loadingOlder: true,
      loadingInspector: true, recovering: true, refreshingSummary: true }, f.controller).replace(/<[^>]*>/g, "");
    expect(busy).toBe(normal);
    expect(busy).toContain("已载入 2 条记录");
    expect(busy).toContain("应用筛选"); expect(busy).toContain("载入更早运行"); expect(busy).toContain("载入更早记录");
    const stale = render({ ...view, stale: true, recovering: true }, f.controller);
    expect(stale).toContain("当前为上次读取的记录");
    f.controller.dispose();
  });
});

describe("Monitor candidate retirement", () => {
  it.each([true, false])("evicts known full detail from a live configuration downgrade while visible=%s", async (visible) => {
    const f = await setup();
    const oldDetail = deferred<TrajectoryInspector>();
    f.client.monitorInspect.mockReturnValueOnce(oldDetail.promise);
    const inspecting = f.controller.inspect("A-2");
    const modeRead = deferred<{ mode: string; enabled: boolean }>();
    if (!visible) {
      f.controller.setVisible(false);
      f.client.monitorState.mockReturnValueOnce(modeRead.promise);
    }
    const publications = f.states.length;
    f.changeMode("FEEDBACK_ONLY");
    if (!visible) {
      expect(f.states).toHaveLength(publications);
      f.controller.setVisible(true);
    }
    expect(f.read()).toMatchObject({ mode: "FEEDBACK_ONLY", selectedRunKey: "A", inspectedRowKey: undefined,
      inspector: undefined, loadingInspector: false });
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).toEqual(["A-1", "A-2"]);
    oldDetail.resolve(detail("A-2")); await inspecting;
    expect(f.read().inspector).toBeUndefined();
    if (!visible) {
      modeRead.resolve({ mode: "FEEDBACK_ONLY", enabled: true });
      await vi.waitFor(() => expect(f.read().loadingRuns || f.read().recovering).toBe(false));
    }
    f.controller.dispose();
  });

  it("does not let an older mode snapshot restore full authority after a config push", async () => {
    const f = await setup();
    const oldMode = deferred<{ mode: string; enabled: boolean }>();
    f.client.monitorState.mockReturnValueOnce(oldMode.promise);
    f.controller.bind(f.wire);
    f.changeMode("FEEDBACK_ONLY");
    oldMode.resolve({ mode: "FULL_LOCAL", enabled: true });
    await vi.waitFor(() => expect(f.read().loadingRuns || f.read().recovering).toBe(false));
    expect(f.read()).toMatchObject({ mode: "FEEDBACK_ONLY", selectedRunKey: "A", inspector: undefined, inspectedRowKey: undefined });
    f.controller.dispose();
  });

  it("retires a pending Run immediately on a current-client disabled config push", async () => {
    const f = await setup();
    const pending = deferred<TrajectoryResult>();
    f.client.monitorTrajectory.mockReturnValueOnce(pending.promise);
    const switching = f.controller.select("B");
    f.changeMode("DISABLED");
    expect(f.read()).toMatchObject({ mode: "DISABLED", runs: [], selectedRunKey: undefined, inspector: undefined,
      trajectory: undefined, loadingTrajectory: false, requestedRunKey: undefined });
    pending.resolve(page("B")); await switching;
    expect(f.read().trajectory).toBeUndefined();
    f.controller.dispose();
  });

  it("ignores configuration callbacks retired by a replacement physical client", async () => {
    const f = await setup();
    const oldHandler = f.client.onConfigChanged.mock.calls.at(-1)?.[0];
    expect(oldHandler).toBeDefined();
    f.controller.bind(fakeClient().wire);
    await vi.waitFor(() => expect(f.read().loadingRuns || f.read().recovering).toBe(false));
    oldHandler?.({ key: "TAKI_MONITOR_MODE", value: "DISABLED" });
    expect(f.read()).toMatchObject({ mode: "FULL_LOCAL", selectedRunKey: "A" });
    f.controller.dispose();
  });

  it.each(["client", "visibility"] as const)("evicts full-mode Inspector content atomically when %s recovery confirms FEEDBACK_ONLY", async (retirement) => {
    const f = await setup(); const oldDetail = deferred<TrajectoryInspector>(); const tail = deferred<TrajectoryResult>();
    f.client.monitorInspect.mockReturnValueOnce(oldDetail.promise);
    const inspecting = f.controller.inspect("A-2");
    const next = retirement === "client" ? fakeClient() : f;
    next.client.monitorState.mockResolvedValue({ mode: "FEEDBACK_ONLY", enabled: true });
    next.client.monitorTrajectory.mockImplementation((params) => params.tail ? tail.promise : readPage(params));
    if (retirement === "client") f.controller.bind(next.wire);
    else { f.controller.setVisible(false); f.controller.setVisible(true); }
    await vi.waitFor(() => expect(f.read().mode).toBe("FEEDBACK_ONLY"));
    expect(f.read()).toMatchObject({ selectedRunKey: "A", inspector: undefined, inspectedRowKey: undefined, loadingInspector: false });
    expect(f.read().trajectory?.rows.map((value) => value.rowKey)).toEqual(["A-1", "A-2"]);
    expect(render(f.read(), f.controller)).not.toContain("A-1 的内容");
    for (const state of f.states.filter((value) => value.mode === "FEEDBACK_ONLY")) expect(state.inspector).toBeUndefined();
    oldDetail.resolve(detail("A-2")); await inspecting;
    tail.resolve(page("A"));
    await vi.waitFor(() => expect(f.read().recovering).toBe(false));
    expect(f.read().inspector).toBeUndefined();
    next.client.monitorInspect.mockImplementation(async (params) => ({ ...detail(params.rowKey), mode: "FEEDBACK_ONLY" }));
    await f.controller.inspect("A-1");
    expect(f.read().inspector?.mode).toBe("FEEDBACK_ONLY");
    f.controller.dispose();
  });

  it.each(["hidden", "client", "character"] as const)("retires pending Run and Inspector requests on %s change", async (retirement) => {
    const f = await setup(); const b = deferred<TrajectoryResult>(); const detailB = deferred<TrajectoryInspector>();
    f.client.monitorTrajectory.mockImplementation((params) => params.runKey === "B" ? b.promise : readPage(params));
    f.client.monitorInspect.mockImplementation((params) => params.rowKey === "A-2" ? detailB.promise : Promise.resolve(detail(params.rowKey)));
    const switching = f.controller.select("B"); const inspecting = f.controller.inspect("A-2");
    if (retirement === "hidden") f.controller.setVisible(false);
    if (retirement === "client") f.controller.bind(fakeClient().wire);
    if (retirement === "character") {
      f.client.monitorList.mockResolvedValue({ runs: [] });
      await f.controller.applyFilters({ ...f.read().filters, characterId: "other" });
    }
    const hiddenEmits = f.states.length;
    b.resolve(page("B")); detailB.reject(new Error("FORBIDDEN"));
    await Promise.all([switching, inspecting]);
    if (retirement === "hidden") {
      expect(f.states).toHaveLength(hiddenEmits);
      f.controller.setVisible(true);
    }
    await vi.waitFor(() => expect(f.read().loadingRuns || f.read().recovering).toBe(false));
    expect(f.read().selectedRunKey).toBe(retirement === "character" ? undefined : "A");
    expect(f.read().inspectedRowKey).toBe(retirement === "character" ? undefined : "A-1");
    expect(f.read()).toMatchObject({ loadingTrajectory: false, loadingInspector: false, error: null });
    f.controller.dispose();
  });
});
