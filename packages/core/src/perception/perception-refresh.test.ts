import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerceptionChangedSchema, type PerceptionCard, type PerceptionPauseState } from "@taki/shared";
import type { RouteResult } from "../capabilities/route-capability.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createPerceptionLayer, type PerceptionLayer } from "./perception-layer.ts";

const POLL_MS = 30_000;
const layers: PerceptionLayer[] = [];

function sample(processName = "Code.exe", windowTitle = "main.ts"): RouteResult {
  return { ok: true, output: { available: true, processName, windowTitle, idleSeconds: 0 } };
}

function harness(seed?: PerceptionPauseState) {
  let result = sample();
  const route = vi.fn(async () => result);
  const save = vi.fn();
  const { logger, records } = createCaptureLogger();
  const perception = createPerceptionLayer({
    route, hasNode: () => true,
    ambient: { enabled: false, retention: { mode: "keep" } },
    ambientShotsDir: join(process.cwd(), "target", "unused-perception-refresh"),
    pauseStore: { load: () => seed, save }, logger,
  });
  layers.push(perception);
  const sink = vi.fn();
  const connection: Connection = { state: { status: "authenticated", role: "operator", deviceId: "operator", capabilities: [] } };
  return {
    perception, route, save, records, sink,
    show: (next: RouteResult) => { result = next; },
    subscribe: () => perception.changes.subscriptions.subscribe(connection, sink),
  };
}

describe("Perception source-to-card invalidation wiring", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
  afterEach(() => { for (const layer of layers.splice(0)) layer.dispose(); vi.useRealTimers(); });

  it("publishes accepted scrubbed samples after commit and an effective sensitive seal, retaining dwell", async () => {
    const h = harness();
    const snapshots: PerceptionCard[] = [];
    h.sink.mockImplementation(() => { snapshots.push(h.perception.card(Date.now())); });
    h.subscribe();
    h.perception.start();
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }]]);
    h.show(sample("Thunderbird", "draft to alice@example.com"));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(snapshots.at(-1)?.current).toMatchObject({ windowTitle: "draft to [redacted:email]", samples: 1 });
    expect(snapshots.at(-1)?.recent).toEqual([]);
    expect(h.perception.activity.state.entries()).toEqual([]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(snapshots.at(-1)?.current?.samples).toBe(2);
    h.show(sample("1Password", "private vault title"));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(snapshots.at(-1)?.current).toBeNull();
    expect(snapshots.at(-1)?.recent).toHaveLength(1);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }], [{ revision: 2 }], [{ revision: 3 }], [{ revision: 4 }]]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.sink).toHaveBeenCalledTimes(4);
    h.show(sample("Code.exe", "notes.md"));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(snapshots.at(-1)?.current).toMatchObject({ processName: "Code.exe", windowTitle: "notes.md", samples: 1 });
    expect(snapshots.at(-1)?.recent).toHaveLength(1);
    for (const [hint] of h.sink.mock.calls) expect(PerceptionChangedSchema.safeParse(hint).success).toBe(true);
    const publicTrace = JSON.stringify({ hints: h.sink.mock.calls, logs: h.records });
    for (const privateText of ["alice@example.com", "private vault title", "1Password", "Thunderbird", "notes.md"]) {
      expect(publicTrace).not.toContain(privateText);
    }
  });

  it("ignores malformed samples and repeated unavailable seals; actual denial changes scheduled state", async () => {
    const h = harness();
    h.subscribe();
    h.perception.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    h.show({ ok: true, output: { malformed: "private" } });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.sink).toHaveBeenCalledTimes(2);
    h.show({ ok: true, output: { available: false, processName: null, windowTitle: null, idleSeconds: null } });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.sink).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.sink).toHaveBeenCalledTimes(3);
    h.show({ ok: false, code: "DENIED", message: "synthetic denial" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.sink).toHaveBeenCalledTimes(4);
    expect(h.perception.card(Date.now()).samplingStatus.foreground).toBe(false);
    h.perception.activity.sampler.stop();
    h.perception.activity.sampler.start();
    expect(h.sink).toHaveBeenCalledTimes(4);
  });

  it("settles hydrated pause expiry with both samplers stopped and no writer, route or model call", async () => {
    const h = harness({ paused: true, until: 5_000 });
    h.perception.activity.sampler.stop();
    h.perception.ambient.stop();
    h.subscribe();
    expect(h.perception.card(Date.now()).samplingStatus).toEqual({ foreground: false, ambientScreen: false });
    expect(h.sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.perception.card(Date.now())).toMatchObject({
      pauseState: { paused: false, until: null }, samplingStatus: { foreground: false, ambientScreen: false },
    });
    for (const sideEffect of [h.route, h.save]) expect(sideEffect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("read and subscription do not start sampling, while idle source changes remain valid", () => {
    const h = harness();
    h.perception.activity.state.push({ available: true, processName: "Code.exe", windowTitle: "before subscribe", idleSeconds: 0 }, 1_000);
    h.subscribe();
    expect(h.sink).not.toHaveBeenCalled();
    expect(h.perception.card(Date.now()).current?.windowTitle).toBe("before subscribe");
    expect(vi.getTimerCount()).toBe(0);
    for (const sideEffect of [h.route, h.save]) expect(sideEffect).not.toHaveBeenCalled();
    h.perception.dispose();
    h.perception.activity.state.seal();
    expect(h.sink).not.toHaveBeenCalled();
    expect(h.perception.changes.subscriptions.count()).toBe(0);
  });
});
