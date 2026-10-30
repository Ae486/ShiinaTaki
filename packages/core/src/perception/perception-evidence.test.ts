import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import type { CapabilityRouteProvenance, RouteResult } from "../capabilities/route-capability.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createPerceptionLayer, type PerceptionLayer } from "./perception-layer.ts";

const POLL = 30_000;
const HOST = "11111111-1111-4111-8111-111111111111";
const SHOT = { mediaType: "image/png", dataBase64: "AAAA", width: 1, height: 1 };
const layers: PerceptionLayer[] = [];
const dirs: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function harness(options: { ambient?: boolean; legacy?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "taki-perception-evidence-"));
  dirs.push(dir);
  let generation = 1;
  let catalog = 1;
  let online = true;
  let sample: ForegroundWindowOutput = { available: true, processName: "Code.exe", windowTitle: "main.ts", idleSeconds: 0 };
  let routeHook: ((capability: string, result: RouteResult) => Promise<RouteResult>) | undefined;
  const route = vi.fn<(capability: string, input: unknown, targetHostId?: string) => Promise<RouteResult>>(async (capability) => {
    const capturedGeneration = generation;
    const capturedCatalog = catalog;
    const provenance: CapabilityRouteProvenance = {
      hostId: HOST, connectionGeneration: capturedGeneration, catalogGeneration: capturedCatalog,
      isCurrent: () => online && generation === capturedGeneration && catalog === capturedCatalog,
    };
    const result: RouteResult = {
      ok: true, output: capability === "screenshot-ambient" ? SHOT : { ...sample },
      ...(options.legacy ? {} : { provenance }),
    };
    return routeHook ? routeHook(capability, result) : result;
  });
  const vision = vi.fn(async (): Promise<string | null> => "An editor window");
  const save = vi.fn();
  const { logger } = createCaptureLogger();
  const layer = createPerceptionLayer({
    route, hasNode: () => online, describe: vision,
    ambient: { enabled: options.ambient ?? false, retention: { mode: "keep" } },
    ambientShotsDir: dir, pauseStore: { load: () => undefined, save }, logger,
  });
  layers.push(layer);
  layer.start();
  return {
    layer, route, vision, save, dir,
    show: (next: Partial<ForegroundWindowOutput>) => { sample = { ...sample, ...next }; },
    hook: (next: typeof routeHook) => { routeHook = next; },
    replaceHost: () => { generation += 1; },
    replaceCatalog: () => { catalog += 1; },
    offline: () => { online = false; },
  };
}

describe("accepted Perception evidence and source lifetime", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
  afterEach(() => {
    for (const layer of layers.splice(0)) layer.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("keeps null idle unknown while preserving the legacy activity/UI projection", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.evidence.latest(Date.now())?.idleSeconds).toBe(0);
    expect(h.layer.evidence.foreground(Date.now())).toMatchObject({ application: "Code.exe", meaningful: false });
    h.show({ idleSeconds: null });
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.activity.state.current()).toMatchObject({ idle: false, samples: 2 });
    expect(h.layer.evidence.latest(Date.now())).toEqual({
      observationEpoch: 0, observedAt: Date.now(), idleSeconds: null,
      source: { hostId: HOST, connectionGeneration: 1, catalogGeneration: 1 },
    });
    expect(h.layer.evidence.foreground(Date.now())).toMatchObject({ application: "Code.exe", idleSeconds: null, meaningful: false });
    const copy = h.layer.evidence.latest(Date.now())!;
    Object.assign(copy.source, { hostId: "changed" });
    expect(h.layer.evidence.latest(Date.now())?.source.hostId).toBe(HOST);
  });

  it("does not promote legacy activity or stale/future timestamps into presence", async () => {
    const legacy = harness({ legacy: true });
    const current = harness();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(legacy.layer.activity.state.current()?.idle).toBe(false);
    expect(legacy.layer.evidence.latest(Date.now())).toBeUndefined();
    expect(current.layer.evidence.latest(Date.now() - 1)).toBeUndefined();
    expect(current.layer.evidence.latest(Date.now() + 60_001)).toBeUndefined();
  });

  it.each(["sensitive", "refused", "malformed", "unavailable"])("retires %s foreground without reusing its prior idle or dwell", async (kind) => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(2 * POLL);
    if (kind === "sensitive") h.show({ processName: "1Password", windowTitle: "private" });
    if (kind === "unavailable") h.show({ available: false });
    if (kind === "refused") h.hook(async () => ({ ok: false, code: "EXEC_FAILED", message: "refused" }));
    if (kind === "malformed") h.hook(async () => ({ ok: true, output: {} }));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
    expect(h.layer.activity.state.current()).toBeUndefined();
    h.hook(undefined);
    h.show({ available: true, processName: "Code.exe", windowTitle: "main.ts" });
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.activity.state.current()?.samples).toBe(1);
  });

  it.each(["paused", "resumed", "expired"])("drops a foreground await whose consent was %s before completion", async (mode) => {
    const h = harness();
    const pending = deferred<RouteResult>();
    let captured: RouteResult | undefined;
    h.hook(async (_capability, result) => { captured = result; return pending.promise; });
    await vi.advanceTimersByTimeAsync(POLL);
    const epoch = h.layer.evidence.generation();
    if (mode === "expired") h.layer.pause.pauseUntil(Date.now() + 10);
    else h.layer.pause.pauseUntilResumed();
    if (mode === "resumed") h.layer.pause.resume();
    if (mode === "expired") await vi.advanceTimersByTimeAsync(11);
    // No pause read occurs between pause creation, expiry and the delayed capability completion.
    pending.resolve(captured!);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.layer.evidence.generation()).toBeGreaterThan(epoch);
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
    expect(h.layer.activity.state.current()).toBeUndefined();
  });

  it("commits consent before retirement; a failed pause or resume cannot publish another epoch", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(POLL);
    const epoch = h.layer.evidence.generation();
    h.save.mockImplementation(() => {
      expect(h.layer.evidence.generation()).toBe(epoch);
      expect(h.layer.evidence.latest(Date.now())).toBeDefined();
      throw new Error("disk full");
    });
    expect(() => h.layer.pause.pauseUntilResumed()).toThrow("disk full");
    expect(h.layer.evidence.generation()).toBe(epoch);
    expect(h.layer.evidence.latest(Date.now())).toBeDefined();
    h.save.mockReset();
    h.layer.pause.pauseUntilResumed();
    const pausedEpoch = h.layer.evidence.generation();
    h.save.mockImplementation(() => { throw new Error("disk full"); });
    expect(() => h.layer.pause.resume()).toThrow("disk full");
    expect(h.layer.pause.isPaused()).toBe(true);
    expect(h.layer.evidence.generation()).toBe(pausedEpoch);
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
  });

  it("clears cached dwell and screen on pause, then requires fresh evidence and a new ambient capture", async () => {
    const h = harness({ ambient: true });
    await vi.advanceTimersByTimeAsync(2 * POLL);
    expect(h.layer.activity.state.current()?.samples).toBe(2);
    expect(h.layer.screen.latest(Date.now())).toBeDefined();
    expect(h.vision).toHaveBeenCalledTimes(1);
    h.layer.pause.pauseUntilResumed();
    h.layer.pause.resume();
    expect(h.layer.renderContext(Date.now())).toBe("");
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.activity.state.current()?.samples).toBe(1);
    expect(h.vision).toHaveBeenCalledTimes(2);
  });

  it.each(["host", "catalog"])("retires replaced %s evidence before reads and never stitches replacement dwell", async (kind) => {
    const h = harness({ ambient: true });
    await vi.advanceTimersByTimeAsync(2 * POLL);
    const epoch = h.layer.evidence.generation();
    if (kind === "host") h.replaceHost(); else h.replaceCatalog();
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
    expect(h.layer.renderContext(Date.now())).toBe("");
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.activity.state.current()?.samples).toBe(1);
    expect(h.layer.evidence.generation()).toBeGreaterThan(epoch);
    if (kind === "host") {
      h.layer.evidence.retireHost({ hostId: HOST, connectionGeneration: 1 });
      expect(h.layer.evidence.latest(Date.now())?.source.connectionGeneration).toBe(2);
    }
  });

  it("drops a foreground result from a replaced Host instead of attributing it to the replacement", async () => {
    const h = harness();
    const pending = deferred<RouteResult>();
    let captured: RouteResult | undefined;
    h.hook(async (_capability, result) => { captured = result; return pending.promise; });
    await vi.advanceTimersByTimeAsync(POLL);
    h.replaceHost();
    pending.resolve(captured!);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.layer.evidence.latest(Date.now())).toBeUndefined();
    expect(h.layer.activity.state.current()).toBeUndefined();
    h.hook(undefined);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.layer.evidence.latest(Date.now())?.source.connectionGeneration).toBe(2);
  });

  it.each(["foreground-screen", "screenshot", "vision"])("fences pause+resume during ambient %s and discards retired raw frames even under keep retention", async (stage) => {
    const h = harness({ ambient: true });
    const pending = deferred<RouteResult>();
    const description = deferred<string | null>();
    let captured: RouteResult | undefined;
    let foregroundCalls = 0;
    h.hook(async (capability, result) => {
      if (capability === "foreground-window") foregroundCalls += 1;
      if ((stage === "foreground-screen" && foregroundCalls === 2)
        || (stage === "screenshot" && capability === "screenshot-ambient")) {
        captured = result;
        return pending.promise;
      }
      return result;
    });
    if (stage === "vision") h.vision.mockImplementation(() => description.promise);
    await vi.advanceTimersByTimeAsync(POLL);
    if (stage === "vision") expect(h.vision).toHaveBeenCalledOnce();
    else expect(captured).toBeDefined();
    h.layer.pause.pauseUntilResumed();
    h.layer.pause.resume();
    if (captured) pending.resolve(captured);
    description.resolve("old description");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.layer.screen.latest(Date.now())).toBeUndefined();
    expect(readdirSync(h.dir)).toEqual([]);
    if (stage !== "vision") expect(h.vision).not.toHaveBeenCalled();
    if (stage === "foreground-screen") expect(h.route.mock.calls.some(([capability]) => capability === "screenshot-ambient")).toBe(false);
  });

  it("pins ambient capture to the screened Host and rejects Host retirement during vision", async () => {
    const h = harness({ ambient: true });
    const description = deferred<string | null>();
    h.vision.mockImplementation(() => description.promise);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(h.route).toHaveBeenCalledWith("screenshot-ambient", {}, HOST);
    h.replaceHost();
    description.resolve("obsolete screen");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.layer.screen.latest(Date.now())).toBeUndefined();
    expect(readdirSync(h.dir)).toEqual([]);
  });
});
