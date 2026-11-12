import { describe, expect, it, vi } from "vitest";
import type { RunMonitorEvent, RunMonitorSummary, TrajectoryInspector, TrajectoryParams, TrajectoryResult, TrajectoryRow } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorViewState } from "./monitor-controller.ts";

const run: RunMonitorSummary = {
  key: "run", characterId: "taki", title: "用户发起 · 运行中", initiator: "primary", initiatorLabel: "用户发起",
  triggerLabel: "对话", deliveryClass: "class_a", deliveryLabel: "A 类交付", state: "running",
  queuedAt: "2026-09-06T00:00:00.000Z", attemptCount: 1, effectCount: 0, modelRequestCount: 0,
  toolCallCount: 0, toolResultCount: 0, toolSuccessCount: 0, toolFailureCount: 0, failureCount: 0, retryCount: 0, usage: {},
};
const row = (seq: number): TrajectoryRow => ({
  rowKey: `row-${seq}`, seq, label: "工具调用", phase: "tool", category: "tool", categoryLabel: "工具",
  status: "已接收", occurredAt: "2026-09-06T00:00:00.000Z", surface: "current", surfaceLabel: "当前",
  kind: "tool", toolName: "echo", displayName: "读取内容",
});
const page = (start = 1, end = 1, summary = run): TrajectoryResult => ({
  run: summary, rows: Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => row(start + index)),
  cursor: { runKey: summary.key, seq: end }, hasMore: false, hasOlder: start > 1,
  ...(start > 1 ? { olderCursor: { runKey: summary.key, seq: start } } : {}),
});
const detail = (title: string): TrajectoryInspector => ({
  mode: "FULL_LOCAL", title, detail: [], technical: [], technicalCollapsed: true, redactionNotice: "仅展示已记录信息",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  let notify!: (event: RunMonitorEvent) => void;
  const client = {
    monitorState: vi.fn().mockResolvedValue({ mode: "FULL_LOCAL", enabled: true }),
    monitorList: vi.fn().mockResolvedValue({ runs: [run] }),
    monitorTrajectory: vi.fn().mockImplementation(async (params: TrajectoryParams) =>
      params.tail ? page() : { ...page(), rows: [], cursor: { runKey: "run", seq: params.afterSeq } }),
    monitorInspect: vi.fn().mockResolvedValue(detail("概览")),
    subscribeMonitor: vi.fn().mockResolvedValue(undefined), unsubscribeMonitor: vi.fn().mockResolvedValue(undefined),
    onMonitorEvent: vi.fn().mockImplementation((handler) => { notify = handler; return () => undefined; }),
    ...overrides,
  } as unknown as WsClient;
  return { client, notify: (event: RunMonitorEvent) => notify(event) };
}

async function setup(overrides: Record<string, unknown> = {}) {
  let view: MonitorViewState = INITIAL_MONITOR_STATE;
  const controller = createMonitorController((value) => { view = value; });
  const transport = fakeClient(overrides);
  controller.bind(transport.client);
  await vi.waitFor(() => expect(view.runs).toHaveLength(1));
  await controller.select("run");
  return { controller, ...transport, read: () => view };
}

describe("Monitor request identity and durable continuation", () => {
  it.each(["success", "error"] as const)("ignores an Inspector %s after close and clears pending state immediately", async (ending) => {
    const pending = deferred<TrajectoryInspector>();
    const f = await setup({ monitorInspect: vi.fn().mockReturnValue(pending.promise) });
    const inspect = f.controller.inspect("row-1");
    expect(f.read().loadingInspector).toBe(true);
    f.controller.closeInspector();
    expect(f.read().loadingInspector).toBe(false);
    if (ending === "success") pending.resolve(detail("旧详情")); else pending.reject(new Error("late failure"));
    await inspect;
    expect(f.read()).toMatchObject({ inspector: undefined, inspectedRowKey: undefined, inspectorError: null, error: null });
  });

  it.each(["success", "error"] as const)("keeps Inspector B when A completes with %s later", async (ending) => {
    const a = deferred<TrajectoryInspector>(); const b = deferred<TrajectoryInspector>();
    const f = await setup({ monitorInspect: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise) });
    const first = f.controller.inspect("row-1");
    const second = f.controller.inspect("row-2");
    b.resolve(detail("详情乙")); await second;
    if (ending === "success") a.resolve(detail("详情甲")); else a.reject(new Error("late failure"));
    await first;
    expect(f.read()).toMatchObject({ inspectedRowKey: "row-2", inspector: { title: "详情乙" }, inspectorError: null });
  });

  it("restores an older selected Run and drains more than 328 missed events before subscribing", async () => {
    const f = await setup();
    const order: string[] = [];
    const fresh = fakeClient({
      monitorList: vi.fn().mockResolvedValue({ runs: [] }),
      monitorTrajectory: vi.fn().mockImplementation(async (params: TrajectoryParams) => {
        order.push(params.tail ? "tail" : `after-${params.afterSeq}`);
        if (params.tail) return page(730, 730);
        const end = Math.min(730, params.afterSeq + params.limit);
        return { ...page(params.afterSeq + 1, end), hasMore: end < 730 };
      }),
      subscribeMonitor: vi.fn().mockImplementation(async ({ afterSeq }) => { order.push(`subscribe-${afterSeq}`); }),
    });
    f.controller.bind(fresh.client);
    await vi.waitFor(() => expect(f.read().trajectory?.cursor.seq).toBe(730));
    await vi.waitFor(() => expect(f.read().recovering).toBe(false));
    expect(f.read().selectedRunKey).toBe("run");
    expect(f.read().runs).toEqual([]);
    expect(f.read().trajectory?.rows.map((value) => value.seq)).toEqual(Array.from({ length: 730 }, (_, index) => index + 1));
    expect(order).toEqual(["tail", "after-1", "after-201", "after-401", "after-601", "subscribe-730"]);
  });

  it("coalesces summary invalidations into one in-flight and one trailing refresh without replacing rows", async () => {
    const a = deferred<TrajectoryResult>(); const b = deferred<TrajectoryResult>();
    const summaries = [a, b]; let reads = 0;
    const monitorTrajectory = vi.fn().mockImplementation(async (params: TrajectoryParams) => {
      if (params.tail && params.limit === 1) return summaries[reads++]!.promise;
      return params.tail ? page() : { ...page(), rows: [] };
    });
    const f = await setup({ monitorTrajectory });
    for (const seq of [2, 3, 4]) f.notify({ runKey: "run", cursor: seq, row: row(seq), invalidated: false });
    const rows = f.read().trajectory!.rows;
    expect(reads).toBe(1);
    a.resolve(page(3, 3, { ...run, toolCallCount: 2 }));
    await vi.waitFor(() => expect(reads).toBe(2));
    b.resolve(page(4, 4, { ...run, toolCallCount: 3, state: "completed" }));
    await vi.waitFor(() => expect(f.read().refreshingSummary).toBe(false));
    expect(f.read().trajectory?.rows).toBe(rows);
    expect(f.read().trajectory?.cursor.seq).toBe(4);
    expect(f.read().trajectory?.run).toMatchObject({ state: "completed", toolCallCount: 3 });
    expect(f.read().runs[0]?.state).toBe("completed");
    expect(reads).toBe(2);
  });

  it("retains the live cursor and current summary when a before-page resolves after a live append", async () => {
    const older = deferred<TrajectoryResult>();
    const f = await setup({ monitorTrajectory: vi.fn().mockImplementation(async (params: TrajectoryParams) => {
      if (params.beforeSeq) return older.promise;
      if (params.tail) return page(101, 200);
      return { ...page(101, 200), rows: [] };
    }) });
    const loading = f.controller.loadMoreTrajectory();
    f.notify({ runKey: "run", cursor: 201, row: row(201), invalidated: false });
    older.resolve(page(1, 100)); await loading;
    expect(f.read().trajectory?.cursor.seq).toBe(201);
    expect(f.read().trajectory?.rows.map((value) => value.seq)).toEqual(Array.from({ length: 201 }, (_, index) => index + 1));
    expect(f.read().trajectory?.hasOlder).toBe(false);
    expect(f.read().trajectory?.olderCursor).toBeUndefined();
  });

  it("does not let a delayed summary roll back a newer overflow recovery", async () => {
    const f = await setup();
    const pending = deferred<TrajectoryResult>();
    const completed = { ...run, state: "completed" as const, toolCallCount: 3 };
    vi.mocked(f.client.monitorTrajectory).mockImplementation(async (params) => params.tail
      ? pending.promise : page(params.afterSeq + 1, 4, completed));
    f.notify({ runKey: "run", cursor: 2, row: row(2), invalidated: false });
    f.notify({ runKey: "run", cursor: 4, row: row(4), invalidated: false });
    await vi.waitFor(() => expect(f.read().recovering).toBe(false));
    expect(f.read().trajectory?.cursor.seq).toBe(4);
    pending.resolve(page(2, 2, { ...run, toolCallCount: 1 }));
    await vi.waitFor(() => expect(f.read().refreshingSummary).toBe(false));
    expect(f.read().trajectory?.run).toEqual(completed);
    expect(f.read().runs[0]).toEqual(completed);
    expect(f.read().trajectory?.rows.map((value) => value.seq)).toEqual([1, 2, 3, 4]);
    f.controller.dispose();
  });

  it("does not let a delayed catch-up page replace a newer live summary", async () => {
    const f = await setup();
    const pending = deferred<TrajectoryResult>();
    const completed = { ...run, state: "completed" as const, toolCallCount: 1 };
    let tailReads = 0;
    vi.mocked(f.client.monitorTrajectory).mockImplementation(async (params) => {
      if (params.tail) return tailReads++ === 0 ? page() : page(2, 2, completed);
      return pending.promise;
    });
    const refresh = f.controller.refresh();
    await vi.waitFor(() => expect(f.read().recovering).toBe(true));
    f.notify({ runKey: "run", cursor: 2, row: row(2), invalidated: false });
    await vi.waitFor(() => expect(f.read().trajectory?.run.state).toBe("completed"));
    pending.resolve({ ...page(), rows: [] });
    await refresh;
    expect(f.read().trajectory?.cursor.seq).toBe(2);
    expect(f.read().trajectory?.run).toEqual(completed);
    expect(f.read().runs[0]).toEqual(completed);
    f.controller.dispose();
  });

  it("refreshes the selected browser summary when restoration observes a newer terminal Run", async () => {
    const f = await setup();
    const completed = { ...run, state: "completed" as const, toolCallCount: 1 };
    vi.mocked(f.client.monitorTrajectory).mockImplementation(async (params) => params.tail
      ? page(2, 2, completed) : page(params.afterSeq + 1, 2, completed));
    await f.controller.refresh();
    expect(f.read().trajectory?.run).toEqual(completed);
    expect(f.read().runs[0]).toEqual(completed);
    f.controller.dispose();
  });

  it("keeps authorized stale content on a network error and clears it only on unavailable/forbidden responses", async () => {
    const f = await setup();
    const rows = f.read().trajectory?.rows;
    const failed = fakeClient({ monitorList: vi.fn().mockResolvedValue({ runs: [] }), monitorTrajectory: vi.fn().mockRejectedValue(new Error("network unavailable")) });
    f.controller.bind(failed.client);
    await vi.waitFor(() => expect(f.read().error).not.toBeNull());
    expect(f.read().selectedRunKey).toBe("run"); expect(f.read().trajectory?.rows).toBe(rows); expect(f.read().stale).toBe(true);
    const forbidden = fakeClient({ monitorList: vi.fn().mockResolvedValue({ runs: [] }), monitorTrajectory: vi.fn().mockRejectedValue(new Error("OBSERVABILITY_FORBIDDEN")) });
    f.controller.bind(forbidden.client);
    await vi.waitFor(() => expect(f.read().selectedRunKey).toBeUndefined());
    expect(f.read().trajectory).toBeUndefined(); expect(f.read().inspector).toBeUndefined();
  });
});
