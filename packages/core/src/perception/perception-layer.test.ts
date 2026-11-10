import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { AmbientScreenshotConfig } from "../config/ambient-screenshot-config.ts";
import { createPerceptionLayer } from "./perception-layer.ts";
import type { PrivacyPauseStore } from "./privacy-pause.ts";

const POLL_MS = 30_000; // the activity + ambient layers share this cadence
const SHOT = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };
const OFF: AmbientScreenshotConfig = { enabled: false, retention: { mode: "drop-after-consumption" } };

function sampleOf(processName: string, windowTitle: string): ForegroundWindowOutput {
  return { available: true, processName, windowTitle, idleSeconds: 0 };
}

interface LayerOptions {
  ambient?: AmbientScreenshotConfig;
  dir?: string;
  /** A production-shaped WS round-trip. Zero (the default) makes every reply land before the next sampler's tick
   *  callback even runs, which HIDES the ordering the two independent round-trips really have. */
  delayMs?: number;
  pauseStore?: PrivacyPauseStore;
}

/** A fixed sample, or a getter the test can switch mid-run to model the user changing windows. */
function layerFor(sample: ForegroundWindowOutput | (() => ForegroundWindowOutput), opts: LayerOptions = {}) {
  const foreground = typeof sample === "function" ? sample : () => sample;
  const route = vi.fn(async (capability: string): Promise<RouteResult> => {
    if (opts.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    return { ok: true, output: capability === "screenshot-ambient" ? SHOT : foreground() };
  });
  const { logger } = createCaptureLogger();
  const perception = createPerceptionLayer({
    route,
    hasNode: () => true,
    ambient: opts.ambient ?? OFF,
    ambientShotsDir: opts.dir ?? join(tmpdir(), "taki-ambient-unused"),
    pauseStore: opts.pauseStore,
    logger,
  });
  return { perception, route };
}

const routedTo = (route: ReturnType<typeof vi.fn>, capability: string): number =>
  route.mock.calls.filter((call) => call[0] === capability).length;

const AMBIENT_ON: AmbientScreenshotConfig = { enabled: true, retention: { mode: "drop-after-consumption" } };
const AMBIENT_REFRESH_MS = 5 * 60 * 1000; // the layer's refresh window: after it, a still window is due again
const ROUTE_DELAY_MS = 50; // one WS round-trip: enough that a reply lands AFTER the sibling sampler's tick, as in production

/**
 * An ambient-ENABLED layer over a foreground the body can switch, driven through the REAL seam: the real
 * ActivityState, the real sensitive-process check and the layer's own foreground derivation — never a stubbed
 * `foreground()`. The defect these tests guard lives exactly in that seam (what the ambient sampler believes is on
 * screen after T3a refused to record it), so a test that stubs it proves nothing.
 */
async function withAmbientLayer(
  body: (ctx: {
    route: ReturnType<typeof vi.fn>;
    /** Switch what the foreground-window capability reports from the NEXT sample on. */
    show: (sample: ForegroundWindowOutput) => void;
  }) => Promise<void>,
  opts: { delayMs?: number } = {},
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "taki-ambient-"));
  let sample = sampleOf("Code.exe", "main.ts");
  const { perception, route } = layerFor(
    () => sample,
    { ambient: AMBIENT_ON, dir, delayMs: opts.delayMs },
  );
  perception.start();
  try {
    await body({ route, show: (next) => void (sample = next) });
  } finally {
    perception.ambient.stop();
    perception.activity.sampler.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("createPerceptionLayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replaces retention schedules without losing activity or duplicating timers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-ambient-reconfigure-"));
    const { perception } = layerFor(sampleOf("Code.exe", "main.ts"), {
      ambient: { enabled: false, retention: { mode: "keep" } }, dir,
    });
    try {
      perception.start();
      perception.start();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      const activity = perception.activity.state.current();
      expect(activity).toBeDefined();
      expect(vi.getTimerCount()).toBe(1);
      for (let i = 0; i < 5; i++) {
        perception.reconfigureAmbient(AMBIENT_ON);
        expect(vi.getTimerCount()).toBe(3);
        perception.reconfigureAmbient({ enabled: false, retention: { mode: "keep" } });
        expect(vi.getTimerCount()).toBe(1);
        expect(perception.activity.state.current()).toEqual(activity);
      }
      perception.dispose();
      perception.reconfigureAmbient(AMBIENT_ON);
      perception.start();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      perception.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("threads the shared Privacy Pause into the foreground sampler (production wiring, not just the dep)", async () => {
    const { perception, route } = layerFor(sampleOf("Code.exe", "main.ts"));
    perception.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(route).toHaveBeenCalledTimes(1);

    perception.pause.pauseUntilResumed();
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(route).toHaveBeenCalledTimes(1); // paused: not one further capture

    perception.pause.resume();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(route).toHaveBeenCalledTimes(2);
    perception.activity.sampler.stop();
  });

  it("boots PAUSED from the persisted state — a restart must not silently resume observation", async () => {
    const stored = { paused: true, until: null };
    const { perception, route } = layerFor(sampleOf("Code.exe", "main.ts"), {
      pauseStore: { load: () => stored, save: () => undefined },
    });
    perception.start();
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(route).not.toHaveBeenCalled(); // hydrated through the FACTORY, so the very first tick is already gated
    expect(perception.card(Date.now()).pauseState).toEqual({ paused: true, until: null });

    perception.pause.resume();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(route).toHaveBeenCalledTimes(1);
    perception.activity.sampler.stop();
  });

  it("drops a built-in sensitive app's sample and scrubs an ordinary one, end to end", async () => {
    const sensitive = layerFor(sampleOf("1Password", "Chase Visa 4111 1111 1111 1111"));
    sensitive.perception.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(sensitive.perception.activity.state.current()).toBeUndefined();
    sensitive.perception.activity.sampler.stop();

    const ordinary = layerFor(sampleOf("Thunderbird", "Re: invoice — alice@example.com"));
    ordinary.perception.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(ordinary.perception.activity.state.current()?.windowTitle).toBe("Re: invoice — [redacted:email]");
    ordinary.perception.activity.sampler.stop();
  });

  it("never routes screenshot-ambient with the factory (OFF) config, however long it runs", async () => {
    const { perception, route } = layerFor(sampleOf("Code.exe", "main.ts"), {});
    perception.start();
    await vi.advanceTimersByTimeAsync(20 * POLL_MS);
    expect(routedTo(route, "foreground-window")).toBeGreaterThan(0); // the low-sensitivity half still runs
    expect(routedTo(route, "screenshot-ambient")).toBe(0);
    expect(perception.renderContext(Date.now())).not.toContain("Screen");
    perception.activity.sampler.stop();
  });

  it("serves a card whose sampling badge follows the REAL sampler state and whose pause is the shared one", async () => {
    const { perception } = layerFor(sampleOf("Code.exe", "main.ts"));
    expect(perception.card(Date.now()).samplingStatus).toEqual({ foreground: false, ambientScreen: false });

    perception.start();
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    const running = perception.card(Date.now());
    // Ambient stays false: the factory config is OFF, so that loop was never scheduled (prd ruling 1).
    expect(running.samplingStatus).toEqual({ foreground: true, ambientScreen: false });
    expect(running.current?.processName).toBe("Code.exe");

    perception.pause.pauseUntilResumed();
    expect(perception.card(Date.now()).pauseState).toEqual({ paused: true, until: null });

    perception.activity.sampler.stop();
    expect(perception.card(Date.now()).samplingStatus.foreground).toBe(false);
  });

  it("captures native pixels and renders fenced source guidance once ambient sampling is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-ambient-"));
    try {
      const { perception, route } = layerFor(sampleOf("Code.exe", "main.ts"), {
        ambient: { enabled: true, retention: { mode: "drop-after-consumption" } },
        dir,
      });
      perception.start();
      // Tick 1 records the foreground; the ambient loop needs a KNOWN foreground before it may capture (fail-closed).
      await vi.advanceTimersByTimeAsync(2 * POLL_MS);
      expect(routedTo(route, "screenshot-ambient")).toBe(1);

      const rendered = perception.renderContext(Date.now());
      expect(rendered).toContain('<untrusted-observation source="ambient-screen-sampler">');
      expect(rendered).toContain("native visual evidence");
      expect(rendered).not.toContain("alice@example.com");
      expect(rendered).toContain("foreground-activity-sampler"); // both perception sections join here
      // drop-after-consumption leaves no raw frame behind.
      expect(readdirSync(dir)).toHaveLength(1);
      perception.acquireScreenInput()!.release();
      expect(readdirSync(dir)).toHaveLength(0);
      perception.ambient.stop();
      perception.activity.sampler.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("photographs nothing while a sensitive app is in front, even on the tick a refresh falls due", async () => {
    await withAmbientLayer(async ({ route, show }) => {
      // Settle on an ordinary window: tick 1 captures it, and the next capture is not due until the refresh window
      // elapses (tick 11, at REFRESH + one poll).
      await vi.advanceTimersByTimeAsync(AMBIENT_REFRESH_MS);
      expect(routedTo(route, "screenshot-ambient")).toBe(1);

      show(sampleOf("1Password", "Chase Visa"));
      // The very next tick is the refresh-due one AND the first tick that sees the password manager. Before the seal,
      // T3a merely DROPPED that sample, leaving the editor entry live and only ~30s old — inside the 60s freshness
      // tolerance — so this tick captured the password manager and shipped the pixels to a primary model.
      await vi.advanceTimersByTimeAsync(4 * POLL_MS);
      expect(routedTo(route, "screenshot-ambient")).toBe(1); // not one frame of it ever left the machine
    });
  });

  it("resumes ambient capture on the very first tick after the sensitive app leaves (no permanent block)", async () => {
    await withAmbientLayer(async ({ route, show }) => {
      await vi.advanceTimersByTimeAsync(AMBIENT_REFRESH_MS);
      show(sampleOf("1Password", "Chase Visa"));
      await vi.advanceTimersByTimeAsync(4 * POLL_MS);
      expect(routedTo(route, "screenshot-ambient")).toBe(1);

      // Self-clearing by construction: an ordinary sample opens a fresh entry, so the foreground is known again with
      // no reset step anywhere. One tick is all it takes.
      show(sampleOf("Code.exe", "notes.md"));
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(routedTo(route, "screenshot-ambient")).toBe(2);
    });
  });

  it("photographs nothing on an app T3a has never sampled yet (the pre-first-sight window, D48)", async () => {
    await withAmbientLayer(
      async ({ route, show }) => {
        // Tick 1 dispatches T3a's first sample; the ambient loop has no known foreground yet and skips.
        await vi.advanceTimersByTimeAsync(POLL_MS);
        await vi.advanceTimersByTimeAsync(ROUTE_DELAY_MS); // the reply lands: the editor is recorded
        expect(routedTo(route, "screenshot-ambient")).toBe(0);

        // The user switches to a password manager BETWEEN two T3a samples — nothing on the machine knows yet.
        show(sampleOf("1Password", "Chase Visa"));
        // Tick 2: T3a's reply is still in flight, so the recorded entry still says the editor and is only one poll
        // old — well inside the freshness tolerance, and the seal cannot have fired. This is the tick that used to
        // photograph a password manager and ship the pixels to a primary model. The final gate — one fresh
        // foreground route immediately before the capture — is what refuses it.
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(routedTo(route, "screenshot-ambient")).toBe(0);
      },
      { delayMs: ROUTE_DELAY_MS },
    );
  });

  it("still captures under that same round-trip delay when the live screen agrees", async () => {
    await withAmbientLayer(
      async ({ route }) => {
        await vi.advanceTimersByTimeAsync(POLL_MS + ROUTE_DELAY_MS);
        expect(routedTo(route, "screenshot-ambient")).toBe(0); // nothing recorded yet on tick 1
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(routedTo(route, "screenshot-ambient")).toBe(1); // the ordinary path is untouched by the extra gate
      },
      { delayMs: ROUTE_DELAY_MS },
    );
  });
});
