import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import {
  createAmbientScreenshotSampler,
  type AmbientForeground,
  type AmbientScreenshotSamplerConfig,
} from "./ambient-screenshot-sampler.ts";
import type { AmbientShotStore, SavedAmbientShot } from "./ambient-shot-store.ts";
import { createScreenContext, renderScreenContext } from "./screen-context.ts";

const POLL_MS = 30_000;
const REFRESH_MS = 5 * 60 * 1000;
const SHOT = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };

const CONFIG: AmbientScreenshotSamplerConfig = {
  enabled: true,
  pollMs: POLL_MS,
  refreshMs: REFRESH_MS,
  foregroundMaxAgeMs: 2 * POLL_MS,
  dropRawAfterConsumption: true,
  errorBackoffThreshold: 3,
  maxBackoffMs: 10 * 60 * 1000,
};

let clock = 0;
const now = (): number => clock;

function fakeStore() {
  const saved: SavedAmbientShot[] = [];
  const discarded: string[] = [];
  const store: AmbientShotStore = {
    save: (_data, at) => {
      const shot = { name: `${at}.png`, bytes: 3 };
      saved.push(shot);
      return shot;
    },
    discard: (name) => void discarded.push(name),
    sweepOlderThan: () => ({ removedCount: 0, freedBytes: 0 }),
  };
  return { store, saved, discarded };
}

interface HarnessOptions {
  onChange?: () => void;
  config?: Partial<AmbientScreenshotSamplerConfig>;
  isPaused?: () => boolean;
  isSensitive?: (processName: string | null) => boolean;
  foreground?: () => AmbientForeground | undefined;
  /** What a FRESH foreground-window route reports — the final pre-capture screen; defaults to agreeing with T3a. */
  fresh?: () => RouteResult;
  hasNode?: (capability: string) => boolean;
}

/** A live foreground-window reply, as the Shell would answer the sampler's pre-capture screen. */
function liveSample(processName: string | null, windowTitle: string | null, available = true): RouteResult {
  return { ok: true, output: { available, processName, windowTitle, idleSeconds: 0 } };
}

function harness(route: (capability: string, input: unknown) => Promise<RouteResult>, opts: HarnessOptions = {}) {
  const { logger, records } = createCaptureLogger();
  const { store, saved, discarded } = fakeStore();
  const context = createScreenContext({ staleAfterMs: 2 * REFRESH_MS, now });
  // Fresh by default: the T3a sampler is assumed to have just recorded this foreground.
  const foreground =
    opts.foreground ?? (() => ({ processName: "Code.exe", windowTitle: "main.ts", observedAt: clock }));
  // The sampler screens the LIVE foreground right before capturing (two capabilities, one route fn — as in
  // production). By default the live screen agrees with the recorded entry, so `route` still counts captures only.
  const fresh =
    opts.fresh ??
    (() => {
      const entry = foreground();
      return entry === undefined ? liveSample(null, null, false) : liveSample(entry.processName, entry.windowTitle);
    });
  const allRoutes = vi.fn(async (capability: string, input: unknown): Promise<RouteResult> =>
    capability === "foreground-window" ? fresh() : route(capability, input),
  );
  const sampler = createAmbientScreenshotSampler({
    route: allRoutes,
    hasNode: opts.hasNode ?? (() => true),
    isPaused: opts.isPaused ?? (() => false),
    isSensitive: opts.isSensitive ?? (() => false),
    foreground,
    store,
    context,
    logger,
    now,
    onChange: opts.onChange,
    config: { ...CONFIG, ...opts.config },
  });
  return { sampler, records, context, saved, discarded, allRoutes };
}

const okRoute = () => vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: SHOT }));

const routedTo = (route: ReturnType<typeof vi.fn>, capability: string): number =>
  route.mock.calls.filter((call) => call[0] === capability).length;

/** Advance the injected clock AND the fake timers by one poll interval, flushing the async tick. */
async function step(): Promise<void> {
  clock += POLL_MS;
  await vi.advanceTimersByTimeAsync(POLL_MS);
}

describe("createAmbientScreenshotSampler", () => {
  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("enables and disables one existing timer and immediately withdraws an acquired frame", async () => {
    const route = okRoute();
    const { sampler, context, discarded } = harness(route, { config: { enabled: false } });
    sampler.start();
    expect(vi.getTimerCount()).toBe(0);
    sampler.reconfigure(CONFIG);
    sampler.reconfigure({ ...CONFIG });
    expect(vi.getTimerCount()).toBe(1);
    await step();
    const frame = context.acquire()!;
    expect(frame.images).toHaveLength(1);
    sampler.reconfigure({ ...CONFIG, enabled: false });
    expect(frame.images).toHaveLength(0);
    expect(discarded).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    sampler.reconfigure(CONFIG);
    await step();
    expect(route).toHaveBeenCalledTimes(2);
    sampler.stop();
    sampler.reconfigure({ ...CONFIG, pollMs: 1000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish an old capture after disable and re-enable during its await", async () => {
    let resolve!: (result: RouteResult) => void;
    const pending = new Promise<RouteResult>((done) => { resolve = done; });
    const route = vi.fn(() => pending);
    const { sampler, context, saved } = harness(route);
    sampler.start();
    await step();
    expect(route).toHaveBeenCalledOnce();
    sampler.reconfigure({ ...CONFIG, enabled: false });
    sampler.reconfigure(CONFIG);
    resolve({ ok: true, output: SHOT });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveLength(0);
    expect(context.acquire()).toBeUndefined();
    await step();
    expect(saved).toHaveLength(1);
    sampler.stop();
  });

  it("does not rearm a denied session when its stored enable flag changes", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "DENIED", message: "denied" }));
    const { sampler } = harness(route);
    sampler.start();
    await step();
    sampler.reconfigure({ ...CONFIG, enabled: false });
    sampler.reconfigure(CONFIG);
    sampler.start();
    await step();
    expect(sampler.running()).toBe(false);
    expect(route).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes only actual scheduling changes, including capture denial", async () => {
    const onChange = vi.fn();
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "DENIED", message: "denied" }));
    const { sampler } = harness(route, { onChange });
    sampler.start();
    sampler.start();
    expect(sampler.running()).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith();
    await step();
    expect(sampler.running()).toBe(false);
    sampler.stop();
    sampler.start();
    expect(onChange.mock.calls).toEqual([[], []]);
  });

  it("sampling and native consumption do not publish new scheduling changes", async () => {
    const onChange = vi.fn(); const off = harness(okRoute(), { config: { enabled: false }, onChange });
    off.sampler.start(); off.sampler.stop(); expect(onChange).not.toHaveBeenCalled();
    const active = harness(okRoute(), { onChange }); active.sampler.start(); await step();
    expect(active.discarded).toEqual([]); active.context.acquire()!.release();
    expect(active.discarded).toHaveLength(1); expect(onChange).toHaveBeenCalledOnce(); active.sampler.stop();
  });

  it("isolates scheduling observers and notifies a fresh-screen denial after stopping", async () => {
    const observed: boolean[] = [];
    const { sampler } = harness(okRoute(), {
      fresh: () => ({ ok: false, code: "DENIED", message: "denied" }),
      onChange: () => { observed.push(sampler.running()); throw new Error("retired observer"); },
    });
    expect(() => sampler.start()).not.toThrow();
    await step();
    expect(observed).toEqual([true, false]);
    expect(sampler.running()).toBe(false);
  });

  it("is never scheduled while the enable flag is off — zero captures, zero dialogs, zero logs", async () => {
    const route = okRoute();
    const { sampler, records } = harness(route, { config: { enabled: false } });
    sampler.start();
    for (let i = 0; i < 20; i++) await step();
    expect(route).not.toHaveBeenCalled(); // no capture => the Gate is never consulted => no approval dialog
    expect(records).toHaveLength(0); // a disabled feature must not even announce itself
    sampler.stop();
  });

  it("captures native evidence without any vision dependency or model call", async () => {
    const route = okRoute(); const { sampler, context, records } = harness(route);
    sampler.start(); await step();
    expect(route).toHaveBeenCalledOnce(); expect(context.acquire()?.images).toEqual([{ mediaType: SHOT.mediaType, dataBase64: SHOT.dataBase64 }]);
    expect(records.some((r) => r.msg?.includes("vision"))).toBe(false); sampler.stop();
  });

  it("never captures while Privacy Pause is active, and resumes immediately after", async () => {
    const route = okRoute();
    let paused = true;
    const { sampler, records } = harness(route, { isPaused: () => paused });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(route).not.toHaveBeenCalled();
    expect(records.filter((r) => r.msg?.includes("privacy pause active"))).toHaveLength(1);

    paused = false;
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    sampler.stop();
  });

  it("never captures while a sensitive app is in the foreground", async () => {
    const route = okRoute();
    const { sampler, saved } = harness(route, {
      foreground: () => ({ processName: "1Password", windowTitle: "Chase Visa", observedAt: clock }),
      isSensitive: (name) => name === "1Password",
    });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(route).not.toHaveBeenCalled(); // the skip is PRE-capture: no pixels ever leave the Shell
    expect(saved).toHaveLength(0);
    sampler.stop();
  });

  it("refuses to capture when the foreground is unknown or stale (fail-closed: an unscreenable capture)", async () => {
    const unknown = harness(okRoute(), { foreground: () => undefined });
    unknown.sampler.start();
    await step();
    await step();
    expect(unknown.saved).toHaveLength(0);
    unknown.sampler.stop();

    // A foreground sample older than the tolerance means T3a stopped reporting (paused / denied / dropped as
    // sensitive) — we can no longer tell what is on screen, so we do not photograph it.
    const routeStale = okRoute();
    const stale = harness(routeStale, {
      foreground: () => ({ processName: "Code.exe", windowTitle: "main.ts", observedAt: clock - 5 * POLL_MS }),
    });
    stale.sampler.start();
    await step();
    await step();
    expect(routeStale).not.toHaveBeenCalled();
    stale.sampler.stop();
  });

  it("retains the screened frame until the normal attempt consumes it and fences source guidance", async () => {
    const route = okRoute(); const { sampler, context, saved, discarded } = harness(route);
    sampler.start(); await step(); expect(route).toHaveBeenCalledWith("screenshot-ambient", {});
    expect(saved).toHaveLength(1); expect(discarded).toEqual([]);
    const input = context.acquire()!; expect(input.images).toEqual([{ mediaType: SHOT.mediaType, dataBase64: SHOT.dataBase64 }]);
    const rendered = renderScreenContext(context, clock);
    expect(rendered).toContain('<untrusted-observation source="ambient-screen-sampler">');
    expect(rendered).not.toContain("AAAA"); input.release(); expect(discarded).toEqual([saved[0]?.name]); sampler.stop();
  });

  it("keeps completed captures under retained policies but withdrawal overrides live retention", async () => {
    const { sampler, context, saved, discarded } = harness(okRoute(), { config: { dropRawAfterConsumption: false } });
    sampler.start(); await step(); context.acquire()!.release(); expect(saved).toHaveLength(1); expect(discarded).toEqual([]);
    clock += REFRESH_MS; await vi.advanceTimersByTimeAsync(REFRESH_MS); sampler.stop(); expect(discarded).toEqual([saved[1]?.name]);
  });

  it("re-captures only when the window changes or the refresh falls due (event-driven cost control)", async () => {
    const route = okRoute();
    let title = "main.ts";
    const { sampler } = harness(route, {
      foreground: () => ({ processName: "Code.exe", windowTitle: title, observedAt: clock }),
    });
    sampler.start();
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    await step();
    await step();
    expect(route).toHaveBeenCalledTimes(1); // same window: capturing it again buys nothing

    title = "notes.md";
    await step();
    expect(route).toHaveBeenCalledTimes(2); // a switch is the event that matters

    // A still user still gets a refreshed screen once the refresh window elapses.
    for (let i = 0; i < REFRESH_MS / POLL_MS; i++) await step();
    expect(route).toHaveBeenCalledTimes(3);
    sampler.stop();
  });

  it("stops for the session on DENIED — at most one ambient dialog ever originates here", async () => {
    const route = vi.fn(async (): Promise<RouteResult> => ({ ok: false, code: "DENIED", message: "denied" }));
    const { sampler, records } = harness(route);
    sampler.start();
    await step();
    await step();
    await step();
    expect(route).toHaveBeenCalledTimes(1);
    expect(records.filter((r) => r.msg?.includes("stopping the ambient sampler for this session"))).toHaveLength(1);
    sampler.stop();
  });

  it("skips quietly while no node provides the capability, logging offline at most once", async () => {
    const route = okRoute();
    const { sampler, records, saved } = harness(route, { hasNode: () => false });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(route).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(records.filter((r) => r.msg?.includes("ambient sampler idle until one connects"))).toHaveLength(1);
    sampler.stop();
  });

  it("survives malformed capture without publishing native evidence", async () => {
    const malformed = harness(vi.fn(async (): Promise<RouteResult> => ({ ok: true, output: { nope: 1 } })));
    malformed.sampler.start(); await step(); expect(malformed.context.latest(clock)).toBeUndefined();
    expect(malformed.records.some((r) => r.msg?.includes("failed schema"))).toBe(true); malformed.sampler.stop();
  });

  it("screens the LIVE foreground last, and skips when it is sensitive though the recorded entry is not", async () => {
    const route = okRoute();
    const { sampler, records, saved, allRoutes } = harness(route, {
      fresh: () => liveSample("1Password", "Chase Visa"),
      isSensitive: (name) => name === "1Password",
    });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(routedTo(allRoutes, "foreground-window")).toBeGreaterThan(0); // the screen really ran
    expect(route).not.toHaveBeenCalled(); // and not one frame left the machine
    expect(saved).toHaveLength(0);
    expect(records.filter((r) => r.msg?.includes("sensitive foreground app"))).toHaveLength(1); // once per streak
    expect(JSON.stringify(records)).not.toContain("1Password");
    sampler.stop();
  });

  it("refuses the capture when the live foreground cannot be screened (fail-closed at the last gate)", async () => {
    const unreadable: Array<() => RouteResult> = [
      () => ({ ok: false, code: "CAPABILITY_TIMEOUT", message: "no answer" }),
      () => ({ ok: true, output: { nope: 1 } }),
      () => liveSample(null, null, false),
      () => liveSample(null, "main.ts"),
    ];
    for (const fresh of unreadable) {
      const route = okRoute();
      const { sampler, records, saved } = harness(route, { fresh });
      sampler.start();
      await step();
      await step();
      expect(route).not.toHaveBeenCalled();
      expect(saved).toHaveLength(0);
      expect(records.filter((r) => r.msg?.includes("could not be screened"))).toHaveLength(1);
      sampler.stop();
    }
  });

  it("stops for the session when the pre-capture foreground screen is denied", async () => {
    const route = okRoute();
    const { sampler, records, allRoutes } = harness(route, {
      fresh: () => ({ ok: false, code: "DENIED", message: "denied" }),
    });
    sampler.start();
    for (let i = 0; i < 3; i++) await step();
    // One screen, then nothing: without it the sampler could never satisfy its safety precondition again.
    expect(routedTo(allRoutes, "foreground-window")).toBe(1);
    expect(route).not.toHaveBeenCalled();
    expect(sampler.running()).toBe(false);
    expect(records.filter((r) => r.msg?.includes("foreground screening denied"))).toHaveLength(1);
    sampler.stop();
  });

  it("skips quietly when no node provides the pre-capture screen (no per-tick routing at all)", async () => {
    const route = okRoute();
    const { sampler, records, allRoutes } = harness(route, { hasNode: (capability) => capability !== "foreground-window" });
    sampler.start();
    for (let i = 0; i < 5; i++) await step();
    expect(allRoutes).not.toHaveBeenCalled();
    expect(records.filter((r) => r.msg?.includes("could not be screened"))).toHaveLength(1);
    sampler.stop();
  });

  it("records the FRESH identity, never the pre-filter's assumption", async () => {
    const route = okRoute();
    // T3a still holds the previous window; the live screen sees the one the user actually switched to.
    let recorded = { processName: "Code.exe", windowTitle: "main.ts" };
    const live = { processName: "Code.exe", windowTitle: "notes.md" };
    const { sampler } = harness(route, {
      foreground: () => ({ ...recorded, observedAt: clock }),
      fresh: () => liveSample(live.processName, live.windowTitle),
    });
    sampler.start();
    await step();
    expect(route).toHaveBeenCalledTimes(1);

    recorded = live; // T3a catches up on its next poll
    await step();
    // Unchanged, so nothing is re-captured: had the stale assumption been recorded, this tick would look like a
    // window switch and pay for a second capture.
    expect(route).toHaveBeenCalledTimes(1);
    sampler.stop();
  });
});
