import { describe, expect, it, vi } from "vitest";
import type { WsClient } from "@/lib/ws-client.js";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorViewState } from "./monitor-controller.ts";

const run = {
  key: "run-1", characterId: "taki", title: "Scheduled Task · Completed", initiator: "scheduled" as const,
  initiatorLabel: "Scheduled Task", triggerLabel: "Scheduled Task", deliveryClass: "class_b" as const,
  deliveryLabel: "Class B delivery", state: "completed" as const, outcome: "completed" as const,
  queuedAt: "2026-08-27T00:00:00.000Z", terminalAt: "2026-08-27T00:00:01.000Z", durationMs: 1000,
  attemptCount: 1, effectCount: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};
const trajectory = { run, rows: [], cursor: { runKey: "run-1", seq: 2 }, hasMore: false };
const row = { rowKey: "row-1", seq: 1, label: "Tool call", phase: "tool", category: "tool", categoryLabel: "Tool",
  status: "ok", occurredAt: "2026-08-27T00:00:00.500Z", surface: "current", surfaceLabel: "Current",
  kind: "tool", toolName: "browser" } as const;
const inspector = { mode: "FEEDBACK_ONLY", title: "Tool call", detail: [],
  technical: [{ label: "Row key", value: "row-1" }], technicalCollapsed: true, redactionNotice: "已脱敏。" } as const;

function client(overrides: Record<string, unknown> = {}): WsClient {
  return {
    monitorState: vi.fn().mockResolvedValue({ mode: "FEEDBACK_ONLY", enabled: true, detail: "lifecycle" }),
    monitorList: vi.fn().mockResolvedValue({ runs: [run] }),
    monitorTrajectory: vi.fn().mockResolvedValue(trajectory),
    monitorInspect: vi.fn(),
    subscribeMonitor: vi.fn().mockResolvedValue(undefined),
    onMonitorEvent: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  } as unknown as WsClient;
}

describe("monitor controller", () => {
  it("restores enabled state and list for a new client generation", async () => {
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(client());
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    expect(states.at(-1)?.mode).toBe("FEEDBACK_ONLY");
  });

  it("ignores a late result from a retired client generation", async () => {
    let resolveOld!: (value: { runs: typeof run[] }) => void;
    const oldList = new Promise<{ runs: typeof run[] }>((resolve) => { resolveOld = resolve; });
    const old = client({ monitorList: vi.fn().mockReturnValue(oldList) });
    const fresh = client({ monitorList: vi.fn().mockResolvedValue({ runs: [] }) });
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(old); controller.bind(fresh);
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([]));
    resolveOld({ runs: [run] });
    await Promise.resolve();
    expect(states.at(-1)?.runs).toEqual([]);
  });

  it("clears the optional monitor projection when Core disables it", async () => {
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(client({ monitorState: vi.fn().mockResolvedValue({ mode: "DISABLED", enabled: false, detail: "none" }) }));
    await vi.waitFor(() => expect(states.at(-1)?.mode).toBe("DISABLED"));
    expect(states.at(-1)?.runs).toEqual(INITIAL_MONITOR_STATE.runs);
  });

  it("deselects the selected run when clicked again and unsubscribes the live stream (U1)", async () => {
    const unsubscribeMonitor = vi.fn().mockResolvedValue(undefined);
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(client({ unsubscribeMonitor }));
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    await controller.select("run-1");
    await vi.waitFor(() => expect(states.at(-1)?.trajectory).toEqual(trajectory));
    await controller.select("run-1"); // second click on the selected run closes the disclosure
    const last = states.at(-1)!;
    expect(last.selectedRunKey).toBeUndefined();
    expect(last.trajectory).toBeUndefined();
    expect(last.inspectedRowKey).toBeUndefined();
    expect(unsubscribeMonitor).toHaveBeenCalledTimes(1);
  });

  it("closes the inspector when the inspected trajectory row is clicked again (U1)", async () => {
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(client({
      monitorTrajectory: vi.fn().mockResolvedValue({ ...trajectory, rows: [row] }),
      monitorInspect: vi.fn().mockResolvedValue(inspector),
    }));
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    await controller.select("run-1");
    await vi.waitFor(() => expect(states.at(-1)?.trajectory?.rows).toEqual([row]));
    await controller.inspect("row-1");
    await vi.waitFor(() => expect(states.at(-1)?.inspector).toEqual(inspector));
    expect(states.at(-1)?.inspectedRowKey).toBe("row-1");
    await controller.inspect("row-1"); // second click on the inspected row closes the inspector
    const last = states.at(-1)!;
    expect(last.inspector).toBeUndefined();
    expect(last.inspectedRowKey).toBeUndefined();
  });

  it("stops working while hidden (P1e): unsubscribes, suppresses re-publishing, keeps page memory", async () => {
    const unsubscribeMonitor = vi.fn().mockResolvedValue(undefined);
    const onMonitorEvent = vi.fn().mockReturnValue(() => undefined);
    const ws = client({ unsubscribeMonitor, onMonitorEvent });
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(ws);
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    await controller.select("run-1");
    await vi.waitFor(() => expect(states.at(-1)?.trajectory).toEqual(trajectory));

    controller.setVisible(false);
    await vi.waitFor(() => expect(unsubscribeMonitor).toHaveBeenCalledTimes(1));
    const emitsAtHide = states.length;
    await controller.refresh(); // hidden pages neither fetch nor emit
    expect(ws.monitorList).toHaveBeenCalledTimes(1);
    expect(states.length).toBe(emitsAtHide);
    expect(states.at(-1)?.selectedRunKey).toBe("run-1"); // selection memory untouched by the gate
  });

  it("rebinds and refetches on reactivation (P1e)", async () => {
    const onMonitorEvent = vi.fn().mockReturnValue(() => undefined);
    const ws = client({ onMonitorEvent });
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.bind(ws);
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    controller.setVisible(false);
    controller.setVisible(true);
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
    expect(onMonitorEvent).toHaveBeenCalledTimes(2); // live handler re-registered
    expect(ws.monitorState).toHaveBeenCalledTimes(2); // restore pass re-ran (mode check + refetch)
  });

  it("defers a bind's fetches while hidden and catches up on reactivation", async () => {
    const ws = client();
    const states: MonitorViewState[] = [];
    const controller = createMonitorController((state) => states.push(state));
    controller.setVisible(false);
    controller.bind(ws);
    await vi.waitFor(() => expect(ws.monitorState).toHaveBeenCalledTimes(0));
    expect(states).toHaveLength(0);
    controller.setVisible(true);
    await vi.waitFor(() => expect(states.at(-1)?.runs).toEqual([run]));
  });
});
