import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { createActivitySampler } from "./activity-sampler.ts";
import type { ActivityState } from "./activity-state.ts";

const POLL_MS = 30_000;
const OK_SAMPLE: ForegroundWindowOutput = {
  available: true,
  processName: "Code.exe",
  windowTitle: "main.ts",
  idleSeconds: 0,
};

function fakeState(): { state: ActivityState; pushed: Array<{ sample: ForegroundWindowOutput; at: number }> } {
  const pushed: Array<{ sample: ForegroundWindowOutput; at: number }> = [];
  const state: ActivityState = {
    push: (sample, at) => void pushed.push({ sample, at }),
    entries: () => [],
    current: () => undefined,
  };
  return { state, pushed };
}

let clock = 0;
const now = (): number => clock;

function harness(
  route: (capability: string, input: unknown) => Promise<RouteResult>,
  hasNode: () => boolean = () => true,
) {
  const { state, pushed } = fakeState();
  const { logger, records } = createCaptureLogger();
  const sampler = createActivitySampler({
    route,
    hasNode,
    state,
    logger,
    now,
    config: { pollMs: POLL_MS, errorBackoffThreshold: 3, maxBackoffMs: 10 * 60 * 1000 },
  });
  return { sampler, pushed, records };
}

/** Advance the injected clock AND the fake timers by one poll interval, flushing the async tick. */
async function step(): Promise<void> {
  clock += POLL_MS;
  await vi.advanceTimersByTimeAsync(POLL_MS);
}

describe("createActivitySampler", () => {
  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes a parsed sample into the state on a normal tick", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: OK_SAMPLE }));
    const { sampler, pushed } = harness(route);
    sampler.start();
    await step();
    expect(route).toHaveBeenCalledWith("foreground-window", {});
    expect(pushed).toEqual([{ sample: OK_SAMPLE, at: POLL_MS }]);
    sampler.stop();
  });

  it("skips quietly on NO_NODE and keeps retrying, logging offline at most once", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "NO_NODE", message: "no node" }));
    const { sampler, pushed, records } = harness(route);
    sampler.start();
    await step();
    await step();
    expect(pushed).toHaveLength(0);
    expect(route).toHaveBeenCalledTimes(2); // keeps polling — no backoff on offline
    expect(records.filter((r) => r.msg?.includes("sampler idle until one connects"))).toHaveLength(1);
    sampler.stop();
  });

  it("never routes while no node is connected, logging offline at most once across many ticks", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: OK_SAMPLE }));
    const { sampler, pushed, records } = harness(route, () => false);
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(route).not.toHaveBeenCalled(); // no route-level "tool invoked"/NO_NODE logs can fire
    expect(pushed).toHaveLength(0);
    expect(records.filter((r) => r.msg?.includes("sampler idle until one connects"))).toHaveLength(1);
    sampler.stop();
  });

  it("resumes routing once a node connects (hasNode flips true)", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: OK_SAMPLE }));
    let online = false;
    const { sampler, pushed } = harness(route, () => online);
    sampler.start();
    await step();
    await step();
    expect(route).not.toHaveBeenCalled();
    online = true;
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    expect(pushed).toHaveLength(1);
    sampler.stop();
  });

  it("stops the sampler for the session on DENIED — at most one dialog ever originates here", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "DENIED", message: "denied" }));
    const { sampler, records } = harness(route);
    sampler.start();
    await step();
    await step();
    await step();
    expect(route).toHaveBeenCalledTimes(1); // stopped after the first denied tick
    expect(records.filter((r) => r.msg?.includes("stopping the sampler for this session"))).toHaveLength(1);
    sampler.stop();
  });

  it("backs off after consecutive errors and resets on success", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "CAPABILITY_TIMEOUT", message: "timeout" }));
    const { sampler, pushed } = harness(route);
    sampler.start();
    await step(); // err 1
    await step(); // err 2
    await step(); // err 3 => backoff engages (60s window from clock=90000 -> 150000)
    expect(route).toHaveBeenCalledTimes(3);
    await step(); // clock=120000 < 150000 => skipped, route not called
    expect(route).toHaveBeenCalledTimes(3);
    // Past the backoff window the loop resumes; a success then resets the error state.
    route.mockResolvedValue({ ok: true, output: OK_SAMPLE });
    await step(); // clock=150000 => runs, succeeds
    expect(route).toHaveBeenCalledTimes(4);
    await step(); // clock=180000 => runs immediately (backoff reset)
    expect(route).toHaveBeenCalledTimes(5);
    expect(pushed).toHaveLength(2);
    sampler.stop();
  });

  it("skips a malformed sample without throwing or pushing", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: { nope: 1 } }));
    const { sampler, pushed, records } = harness(route);
    sampler.start();
    await step();
    expect(pushed).toHaveLength(0);
    expect(records.some((r) => r.msg?.includes("failed schema"))).toBe(true);
    sampler.stop();
  });
});
