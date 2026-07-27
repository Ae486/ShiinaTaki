import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { createActivitySampler } from "./activity-sampler.ts";
import { createActivityState, type ActivityState } from "./activity-state.ts";
import { renderActivityContext } from "./render-activity.ts";

const POLL_MS = 30_000;
const OK_SAMPLE: ForegroundWindowOutput = {
  available: true,
  processName: "Code.exe",
  windowTitle: "main.ts",
  idleSeconds: 0,
};

function fakeState() {
  const pushed: Array<{ sample: ForegroundWindowOutput; at: number }> = [];
  const seals: number[] = [];
  const state: ActivityState = {
    push: (sample, at) => void pushed.push({ sample, at }),
    seal: () => void seals.push(clock),
    entries: () => [],
    current: () => undefined,
  };
  return { state, pushed, seals };
}

let clock = 0;
const now = (): number => clock;

interface HarnessOptions {
  hasNode?: () => boolean;
  isPaused?: () => boolean;
  isSensitive?: (processName: string | null) => boolean;
}

function harness(route: (capability: string, input: unknown) => Promise<RouteResult>, opts: HarnessOptions = {}) {
  const { state, pushed, seals } = fakeState();
  const { logger, records } = createCaptureLogger();
  const sampler = createActivitySampler({
    route,
    hasNode: opts.hasNode ?? (() => true),
    isPaused: opts.isPaused ?? (() => false),
    isSensitive: opts.isSensitive ?? (() => false),
    state,
    logger,
    now,
    config: { pollMs: POLL_MS, errorBackoffThreshold: 3, maxBackoffMs: 10 * 60 * 1000 },
  });
  return { sampler, pushed, records, seals };
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
    const { sampler, pushed, records } = harness(route, { hasNode: () => false });
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
    const { sampler, pushed } = harness(route, { hasNode: () => online });
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

  it("never routes while Privacy Pause is active, logging the pause at most once per streak", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: OK_SAMPLE }));
    let paused = true;
    const { sampler, pushed, records } = harness(route, { isPaused: () => paused });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(route).not.toHaveBeenCalled(); // no capture, no approval dialog, no route-level log pair
    expect(pushed).toHaveLength(0);
    expect(records.filter((r) => r.msg?.includes("privacy pause active"))).toHaveLength(1);

    // Resuming is immediate: the very next tick samples again, and a later pause logs a fresh streak line.
    paused = false;
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    expect(pushed).toHaveLength(1);
    paused = true;
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    expect(records.filter((r) => r.msg?.includes("privacy pause active"))).toHaveLength(2);
    sampler.stop();
  });

  it("drops the whole sample for a sensitive foreground app — the title never reaches the state", async () => {
    const sensitive: ForegroundWindowOutput = {
      available: true,
      processName: "1Password",
      windowTitle: "Chase Visa 4512 — 1Password",
      idleSeconds: 0,
    };
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: sensitive }));
    const { sampler, pushed } = harness(route, { isSensitive: (name) => name === "1Password" });
    sampler.start();
    await step();
    expect(route).toHaveBeenCalledTimes(1); // the skip is post-route: it reads the name the sampler already has
    expect(pushed).toHaveLength(0);
    sampler.stop();
  });

  it("seals the state on a sensitive hit, so a sibling sampler cannot keep acting on the last non-sensitive entry", async () => {
    const sensitive: ForegroundWindowOutput = { available: true, processName: "1Password", windowTitle: "Vault", idleSeconds: 0 };
    let sample = OK_SAMPLE;
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: sample }));
    const { sampler, pushed, seals } = harness(route, { isSensitive: (name) => name === "1Password" });
    sampler.start();
    await step();
    expect(seals).toHaveLength(0); // an ordinary sample never seals

    sample = sensitive;
    await step();
    await step();
    expect(seals).toEqual([2 * POLL_MS, 3 * POLL_MS]); // every sensitive tick re-seals (idempotent, no drift window)
    expect(pushed).toHaveLength(1); // and still nothing about it is recorded

    sample = OK_SAMPLE;
    await step();
    expect(pushed).toHaveLength(2); // self-clearing: ordinary observation resumes with no reset
    sampler.stop();
  });

  it("scrubs PII out of a non-sensitive title BEFORE it is stored (scrub-then-fence)", async () => {
    const leaky: ForegroundWindowOutput = {
      available: true,
      processName: "Thunderbird",
      windowTitle: "Re: invoice — alice@example.com",
      idleSeconds: 0,
    };
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: leaky }));
    const { sampler, pushed } = harness(route);
    sampler.start();
    await step();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.sample.windowTitle).toBe("Re: invoice — [redacted:email]");
    sampler.stop();

    // End-to-end ordering proof: the fenced prompt block can only ever carry the already-scrubbed string.
    const state = createActivityState({
      pulsetimeMs: 2 * POLL_MS,
      dwellMinSamples: 1,
      idleThresholdSeconds: 180,
      spanMs: 60 * 60 * 1000,
      maxEntries: 10,
    });
    state.push(pushed[0]!.sample, POLL_MS);
    const rendered = renderActivityContext(state, POLL_MS);
    expect(rendered).toContain("[redacted:email]");
    expect(rendered).not.toContain("alice@example.com");
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
