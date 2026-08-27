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
});
