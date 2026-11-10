import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuxiliaryUsageResult, ConfigChanged, MaintenanceMonitorParams, MaintenanceMonitorSummary,
  MaintenanceMonitorUpdate, MaintenanceOperationRef } from "@taki/shared";
import { MaintenanceMonitorController, INITIAL_MAINTENANCE_VIEW, type MaintenanceMonitorClient,
  type MaintenanceMonitorView } from "./maintenance-monitor-controller.ts";
import { MaintenanceMonitorPanel } from "./maintenance-monitor-panel.tsx";
import { MonitorWorkspace } from "./monitor-page.tsx";
import { INITIAL_MONITOR_STATE, type MonitorController } from "./monitor-controller.ts";

const at = "2026-11-06T01:00:00.000Z";
const ref: MaintenanceOperationRef = { kind: "tidy", operationId: "private-operation", characterId: "taki" };
const calls: AuxiliaryUsageResult = { scope: "observed-auxiliary", rows: [], nextCursor: null, totalCalls: 0,
  stateCounts: { started: 0, completed: 0, cancelled: 0, failed: 0, interrupted: 0 },
  tokenCounts: { inputTokens: { sum: null, knownCount: 0 }, outputTokens: { sum: null, knownCount: 0 },
    noCacheTokens: { sum: null, knownCount: 0 }, cacheReadTokens: { sum: null, knownCount: 0 },
    cacheWriteTokens: { sum: null, knownCount: 0 }, reasoningTokens: { sum: null, knownCount: 0 }, totalTokens: { sum: null, knownCount: 0 } },
  cacheRead: { pairedCount: 0, inputTokens: null, cacheReadTokens: null, ratio: null } };
const row = (operation = ref): MaintenanceMonitorSummary => ({ ref: operation, startedAt: at, updatedAt: at,
  finishedAt: null, status: "running", failure: null, progress: { reviewed: 2, remaining: 3, edits: 1, steps: 2 } });
function update(query: MaintenanceMonitorParams = { characterId: "taki" }, revision = 5): MaintenanceMonitorUpdate {
  return { revision, snapshot: { query, characterId: query.characterId, status: "ready", rows: [row()],
    nextCursor: { startedAt: at, kind: ref.kind, operationId: ref.operationId },
    detail: query.selected ? { operation: row(query.selected), calls, association: "unavailable" } : null } };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wire() {
  const listeners = new Set<(value: MaintenanceMonitorUpdate) => void>();
  const modes = new Set<(value: ConfigChanged) => void>(); const closes: Array<() => void> = [];
  const order: string[] = []; let revision = 0;
  const client: MaintenanceMonitorClient = {
    subscribeMaintenanceMonitor: vi.fn(async (query) => { order.push("subscribe"); return update(query, ++revision); }),
    unsubscribeMaintenanceMonitor: vi.fn(async () => undefined),
    onMaintenanceMonitorChanged: vi.fn((handler) => { order.push("handler"); listeners.add(handler); return () => { listeners.delete(handler); }; }),
    onConfigChanged: vi.fn((handler) => { modes.add(handler); return () => { modes.delete(handler); }; }),
    onClose: (handler) => { closes.push(handler); },
  };
  return { client, order, listeners,
    push: (value: MaintenanceMonitorUpdate) => [...listeners].forEach((handler) => handler(value)),
    mode: (value: ConfigChanged["value"]) => [...modes].forEach((handler) => handler({ key: "TAKI_MONITOR_MODE", value })),
    close: () => closes.forEach((handler) => handler()) };
}
function setup() {
  let view = INITIAL_MAINTENANCE_VIEW;
  const publish = vi.fn((next: MaintenanceMonitorView) => { view = next; });
  const controller = new MaintenanceMonitorController(publish, "taki"); const connection = wire();
  controller.setEnabled(true); controller.setVisible(true); controller.bind(connection.client);
  return { ...connection, controller, publish, read: () => view };
}

describe("background Monitor controller", () => {
  it("attaches before subscribe, accepts push before acknowledgment and rejects older replies", async () => {
    const f = setup(); expect(f.order).toEqual(["handler", "subscribe"]);
    f.push(update(undefined, 8)); await Promise.resolve();
    expect(f.read()).toMatchObject({ phase: "live", snapshot: update(undefined, 8).snapshot });
    f.controller.dispose();
  });

  it("rejects late selection/page replies and retains a coherent previous view on read failure", async () => {
    const f = setup(); await Promise.resolve();
    const selected = deferred<MaintenanceMonitorUpdate>();
    vi.mocked(f.client.subscribeMaintenanceMonitor).mockReturnValueOnce(selected.promise);
    f.controller.select(ref);
    const priorListener = [...f.listeners][0]!;
    const second = { ...ref, operationId: "other-operation" };
    f.controller.select(second); await Promise.resolve();
    const visible = f.read().snapshot;
    selected.resolve(update({ characterId: "taki", selected: ref }, 100));
    priorListener(update({ characterId: "taki", selected: ref }, 101)); await Promise.resolve();
    expect(f.read().snapshot).toBe(visible);
    const failed = deferred<MaintenanceMonitorUpdate>(); vi.mocked(f.client.subscribeMaintenanceMonitor).mockReturnValueOnce(failed.promise);
    f.controller.older(); failed.reject(new Error("offline")); await Promise.resolve();
    expect(f.read()).toMatchObject({ phase: "error", snapshot: visible });
    f.controller.dispose();
  });

  it("rejects in-flight pushes for a previous query even on the current listener", async () => {
    const f = setup(); await Promise.resolve(); f.controller.select(ref); await Promise.resolve();
    f.push(update({ characterId: "taki" }, 200));
    expect(f.read().snapshot?.detail?.operation.ref).toEqual(ref);
    f.controller.dispose();
  });

  it("stops hidden reads and publication, withdraws hidden disabled data and ignores retired clients", async () => {
    const f = setup(); await Promise.resolve(); const listener = [...f.listeners][0]!;
    f.controller.setVisible(false); f.publish.mockClear(); f.mode("DISABLED"); listener(update(undefined, 100));
    expect(f.publish).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
    f.controller.setVisible(true); expect(f.read().snapshot).toBeNull(); expect(f.read().phase).toBe("disabled");
    f.mode("FULL_LOCAL"); await Promise.resolve(); f.close(); expect(f.read().phase).toBe("stale");
    const replacement = wire(); f.controller.bind(replacement.client); await Promise.resolve();
    expect(f.read().phase).toBe("live"); f.mode("DISABLED"); listener(update(undefined, 1000));
    expect(f.read().phase).toBe("live"); f.controller.dispose();
    expect(replacement.listeners.size).toBe(0);
  });
});

describe("background Monitor surface", () => {
  it("shows both maintenance kinds, progress, unknown usage and failure without internal IDs", () => {
    const snapshot = update({ characterId: "taki", selected: ref }).snapshot;
    snapshot.rows.push({ ...row({ ...ref, kind: "compact" }), status: "failed", failure: "summary-failed" });
    snapshot.detail!.operation = { ...row(), status: "partial", failure: "timeout" };
    const controller = new MaintenanceMonitorController(vi.fn(), "taki");
    const html = renderToStaticMarkup(<MaintenanceMonitorPanel view={{ phase: "live", snapshot, error: null }} controller={controller} />);
    for (const text of ["记忆整理", "上下文压缩", "部分完成", "处理超时", "已检查 / 待检查", "未知", "尚无可确认的调用关联"]) expect(html).toContain(text);
    expect(html).not.toContain("private-operation"); expect(html).not.toContain("0.0%");
  });

  it("selecting maintenance replaces normal metric surfaces and disabled mode removes maintenance", () => {
    const props = { view: { ...INITIAL_MONITOR_STATE, mode: "FULL_LOCAL" as const }, controller: {} as MonitorController,
      visible: true, connectionKind: "local", section: "maintenance" as const, onSectionChange: vi.fn(),
      policy: <div>normal-policy</div>, cache: <div>normal-cache-and-input</div>, maintenance: <div>background-details</div> };
    const html = renderToStaticMarkup(<MonitorWorkspace {...props} />);
    expect(html).toContain("后台维护"); expect(html).toContain("background-details");
    expect(html).not.toContain("normal-cache-and-input"); expect(html).not.toContain("normal-policy");
    expect(renderToStaticMarkup(<MonitorWorkspace {...props} view={{ ...props.view, mode: "DISABLED" }} />)).not.toContain("background-details");
  });
});
