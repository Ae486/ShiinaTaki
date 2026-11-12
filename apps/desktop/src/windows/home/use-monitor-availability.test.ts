import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigChanged, MonitorMode, MonitorStateResult, RunMonitorSummary, TrajectoryParams, TrajectoryRow } from "@taki/shared";
import { MONITOR_MODE_CONFIG_KEY } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { useHomeStore } from "./home-store.ts";
import { visibleHomePages } from "./pages.ts";
import { observeMonitorAvailability, resolveMonitorPageRequest, type MonitorAvailabilityClient } from "./use-monitor-availability.ts";
import { createMonitorController, INITIAL_MONITOR_STATE } from "./pages/monitor/monitor-controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function modeState(mode: MonitorMode): MonitorStateResult {
  return { mode, enabled: mode !== "DISABLED", detail: mode === "DISABLED" ? "none" : mode === "FULL_LOCAL" ? "safe-local" : "lifecycle" };
}

function availabilityClient() {
  const pending = deferred<MonitorStateResult>();
  let handler: (change: ConfigChanged) => void = () => undefined;
  const remove = vi.fn();
  const client: MonitorAvailabilityClient = {
    monitorState: vi.fn(() => pending.promise), subscribeConfig: vi.fn(async () => undefined),
    onConfigChanged: vi.fn((next) => { handler = next; return remove; }),
  };
  return { client, pending, remove, emit: (value: ConfigChanged["value"], key: string = MONITOR_MODE_CONFIG_KEY) => handler({ key, value }) };
}

function availabilityView() {
  let mode: MonitorMode | null = null;
  let cleanup: () => void = () => undefined;
  const publish = (next: MonitorMode) => { mode = next; };
  return {
    bind(client: MonitorAvailabilityClient | null) { cleanup(); cleanup = observeMonitorAvailability(client, publish); },
    mode: () => mode,
    pages: () => visibleHomePages(mode !== null && mode !== "DISABLED").map((page) => page.id),
    route: () => resolveMonitorPageRequest(useHomeStore.getState().currentPage, mode),
    close: () => cleanup(),
  };
}

afterEach(() => useHomeStore.getState().navigate("chat"));

describe("Home Monitor availability and requested route", () => {
  it("keeps the initial requested route while unresolved without exposing the optional page", async () => {
    const view = availabilityView();
    useHomeStore.getState().navigate("monitor");
    view.bind(null);
    expect(view.mode()).toBeNull();
    expect(view.pages()).not.toContain("monitor");
    expect(view.route()).toBe("monitor");
    const first = availabilityClient();
    view.bind(first.client);
    expect(view.route()).toBe("monitor");
    expect(view.pages()).not.toContain("monitor");
    first.pending.resolve(modeState("FULL_LOCAL"));
    await first.pending.promise;
    expect(view.pages()).toContain("monitor");
    expect(view.route()).toBe("monitor");
    view.close();
  });

  it("retains confirmed availability through null and pending replacement generations", async () => {
    const view = availabilityView();
    useHomeStore.getState().navigate("monitor");
    const first = availabilityClient();
    view.bind(first.client);
    first.pending.resolve(modeState("FULL_LOCAL")); await first.pending.promise;
    view.bind(null);
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(view.mode()).toBe("FULL_LOCAL");
    expect(view.pages()).toContain("monitor");
    expect(view.route()).toBe("monitor");
    const second = availabilityClient();
    view.bind(second.client);
    first.emit("DISABLED");
    expect(view.pages()).toContain("monitor");
    second.pending.resolve(modeState("FEEDBACK_ONLY")); await second.pending.promise;
    expect(view.mode()).toBe("FEEDBACK_ONLY");
    expect(view.pages()).toContain("monitor");
    view.close();
  });

  it("ignores a retired client's response and config push after a genuine replacement disable", async () => {
    const view = availabilityView();
    useHomeStore.getState().navigate("monitor");
    const old = availabilityClient(); const fresh = availabilityClient();
    view.bind(old.client); view.bind(fresh.client);
    fresh.pending.resolve(modeState("DISABLED")); await fresh.pending.promise;
    old.pending.resolve(modeState("FULL_LOCAL")); await old.pending.promise;
    old.emit("FULL_LOCAL");
    expect(view.mode()).toBe("DISABLED");
    expect(view.pages()).not.toContain("monitor");
    expect(view.route()).toBe("chat");
    view.close();
  });

  it("lets a typed config change supersede an older in-flight snapshot", async () => {
    const view = availabilityView();
    const client = availabilityClient();
    useHomeStore.getState().navigate("monitor");
    view.bind(client.client);
    client.emit("DISABLED");
    expect(view.route()).toBe("chat");
    client.pending.resolve(modeState("FULL_LOCAL")); await client.pending.promise;
    expect(view.mode()).toBe("DISABLED");
    client.emit("FEEDBACK_ONLY");
    expect(view.pages()).toContain("monitor");
    view.close(); view.close();
    expect(client.remove).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed mode values and unrelated changes without granting visibility", async () => {
    const view = availabilityView();
    const client = availabilityClient();
    view.bind(client.client);
    for (const invalid of [null, true, 1, "unexpected"]) client.emit(invalid);
    client.emit("FULL_LOCAL", "another-key");
    expect(view.mode()).toBeNull();
    expect(view.pages()).not.toContain("monitor");
    client.pending.resolve(modeState("FEEDBACK_ONLY")); await client.pending.promise;
    expect(view.mode()).toBe("FEEDBACK_ONLY");
    view.close();
  });

  it("does not turn transient read failures into an authoritative disable", async () => {
    const view = availabilityView();
    const first = availabilityClient();
    view.bind(first.client);
    first.pending.reject(new Error("unavailable"));
    await Promise.resolve(); await Promise.resolve();
    expect(view.mode()).toBeNull();
    first.emit("FULL_LOCAL");
    const replacement = availabilityClient();
    view.bind(replacement.client);
    replacement.pending.reject(new Error("unavailable"));
    await Promise.resolve(); await Promise.resolve();
    expect(view.pages()).toContain("monitor");
    view.close();
  });
});

describe("Home availability with the retained Monitor controller", () => {
  it.each(["FULL_LOCAL", "FEEDBACK_ONLY"] as const)("restores the same selected older Run with %s detail authority after a null-client gap", async (mode) => {
    const availability = availabilityView();
    useHomeStore.getState().navigate("monitor");
    let view = INITIAL_MONITOR_STATE;
    const controller = createMonitorController((next) => { view = next; });
    const first = availabilityClient();
    const initial = monitorClient(first.client, [run]);
    availability.bind(initial); controller.bind(initial);
    first.pending.resolve(modeState("FULL_LOCAL"));
    await vi.waitFor(() => expect(view.runs).toHaveLength(1));
    await controller.select(run.key); await controller.inspect(row.rowKey);
    availability.bind(null); controller.bind(null);
    expect(availability.pages()).toContain("monitor");
    expect(availability.route()).toBe("monitor");
    expect(view.selectedRunKey).toBe(run.key);
    expect(view.inspectedRowKey).toBe(row.rowKey);
    expect(view.stale).toBe(true);
    const replacement = availabilityClient();
    const next = monitorClient(replacement.client, [], mode);
    availability.bind(next); controller.bind(next);
    expect(availability.pages()).toContain("monitor");
    replacement.pending.resolve(modeState(mode));
    await vi.waitFor(() => expect(view.stale).toBe(false));
    expect(view.runs).toEqual([]);
    expect(view.selectedRunKey).toBe(run.key);
    expect(view.inspectedRowKey).toBe(mode === "FULL_LOCAL" ? row.rowKey : undefined);
    expect(view.inspector?.mode).toBe(mode === "FULL_LOCAL" ? "FULL_LOCAL" : undefined);
    expect(view.trajectory?.rows).toEqual([row]);
    availability.close(); controller.dispose();
  });
});

const run: RunMonitorSummary = {
  key: "older-run", characterId: "taki", title: "用户发起 · 已完成", initiator: "primary", initiatorLabel: "用户发起",
  triggerLabel: "对话", deliveryClass: "class_a", deliveryLabel: "A 类交付", state: "completed", queuedAt: "2026-09-06T00:00:00.000Z",
  attemptCount: 1, effectCount: 0, modelRequestCount: 0, toolCallCount: 0, toolResultCount: 0, toolSuccessCount: 0,
  toolFailureCount: 0, failureCount: 0, retryCount: 0, usage: {},
};
const row: TrajectoryRow = { rowKey: "row", seq: 1, kind: "lifecycle", label: "运行结束", status: "已完成", phase: "run",
  category: "lifecycle", categoryLabel: "生命周期", occurredAt: run.queuedAt, surface: "current", surfaceLabel: "当前" };

function monitorClient(availability: MonitorAvailabilityClient, runs: RunMonitorSummary[], inspectorMode: "FULL_LOCAL" | "FEEDBACK_ONLY" = "FULL_LOCAL"): WsClient {
  return {
    ...availability, monitorList: vi.fn(async () => ({ runs })),
    monitorTrajectory: vi.fn(async (params: TrajectoryParams) => ({ run, rows: params.tail && params.limit > 1 ? [row] : [],
      cursor: { runKey: run.key, seq: params.tail ? 1 : params.afterSeq }, hasMore: false, hasOlder: false })),
    monitorInspect: vi.fn(async () => ({ mode: inspectorMode, title: "运行结束", detail: [], technical: [], technicalCollapsed: true, redactionNotice: "仅展示已记录信息。" })),
    onMonitorEvent: vi.fn(() => () => undefined), subscribeMonitor: vi.fn(async () => undefined), unsubscribeMonitor: vi.fn(async () => undefined),
  } as unknown as WsClient;
}
