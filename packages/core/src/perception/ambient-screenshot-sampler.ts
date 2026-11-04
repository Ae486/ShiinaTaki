/**
 * INPUT:  governed routes, privacy/foreground facts, frame/context stores and change observer
 * OUTPUT: start/stop/running; screened ambient context and data-free scheduling transitions
 * POS:    core/perception — default-off high-sensitivity sampler; deterministic pre-capture privacy gate; no model work
 */
import { ScreenshotOutputSchema } from "@taki/shared";
import type { CapabilityRouteProvenance, RouteFailureCode, RouteResult } from "../capabilities/route-capability.ts";
import type { Logger } from "../logging/logger.ts";
import type { AmbientShotStore } from "./ambient-shot-store.ts";
import { foregroundKey, screenForegroundNow, FOREGROUND_CAPABILITY, type ForegroundScreen } from "./foreground-screen.ts";
import { observeAmbientFrame } from "./ambient-observation.ts";
import { samePerceptionSource, type PerceptionEvidence } from "./perception-evidence.ts";
import { notifyPerceptionChange } from "./notify-perception-change.ts";
import type { ScreenContext } from "./screen-context.ts";

const CAPABILITY = "screenshot-ambient";
// Both refusals of the final screen, worded so neither discloses what it refused to look at.
const SENSITIVE_SKIP = "sensitive foreground app; ambient capture skipped";
const UNSCREENABLE_SKIP = "live foreground could not be screened; ambient capture skipped";

export interface AmbientScreenshotSamplerConfig {
  /** The ambient switch (env today, panel at #26). False = the loop is never scheduled — Recall's silent off-state. */
  enabled: boolean;
  /** Base poll cadence: how often the loop CONSIDERS a capture (a tick usually decides not to). */
  pollMs: number;
  /** Refresh the same window after this long, so the screen block never silently goes stale under a still user. */
  refreshMs: number;
  /** A foreground sample older than this is treated as UNKNOWN — fail-closed, no capture (see captureTarget). */
  foregroundMaxAgeMs: number;
  /** Retention `drop-after-consumption`: delete the raw frame once its same-attempt input is released (factory default). */
  dropRawAfterConsumption: boolean;
  errorBackoffThreshold: number;
  maxBackoffMs: number;
}

/** The foreground the T3a sampler last recorded; observedAt is when that sample was taken (freshness, not start). */
export interface AmbientForeground {
  processName: string;
  windowTitle: string;
  observedAt: number;
}

export interface AmbientScreenshotSamplerDeps {
  route: (capability: string, input: unknown, targetHostId?: string) => Promise<RouteResult>;
  /** True iff a node currently provides `capability`; asked for BOTH the capture and its pre-capture foreground screen. */
  hasNode: (capability: string) => boolean;
  isPaused: () => boolean;
  isSensitive: (processName: string | null) => boolean;
  foreground: () => AmbientForeground | undefined;
  store: AmbientShotStore;
  context: ScreenContext;
  evidence?: PerceptionEvidence;
  logger: Logger;
  config: AmbientScreenshotSamplerConfig;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic clock. */
  now?: () => number;
  /** Called after running() changes; capture, native consumption and GC results are not card changes. */
  onChange?: () => void;
}

export interface AmbientScreenshotSampler {
  start(): void;
  stop(): void;
  /** Consent/source retirement clears refresh suppression; it never restarts a stopped loop. */
  reset(): void;
  /** True while the loop is scheduled — false when never enabled, stopped or denied. */
  running(): boolean;
}

// One context so the tick/decision logic lives at module scope (function size cap), mirroring activity-sampler.
interface AmbientRuntime {
  deps: AmbientScreenshotSamplerDeps;
  log: Logger;
  now: () => number;
  timer: ReturnType<typeof setInterval> | undefined;
  stopped: boolean;
  inflight: boolean;
  consecutiveErrors: number;
  backoffUntil: number;
  offlineLogged: boolean;
  pausedLogged: boolean;
  skipLogged: boolean;
  /** The final pre-capture screen keeps its OWN log-once streak: it runs far more rarely than the cheap pre-filter. */
  screenLogged: boolean;
  /** The foreground identity of the last successful capture + when it happened (change/refresh decision). */
  lastKey: string | undefined;
  lastCaptureAt: number;
}

interface CaptureAttempt {
  at: number;
  epoch: number | undefined;
}

function current(rt: AmbientRuntime, attempt: CaptureAttempt, source?: CapabilityRouteProvenance): boolean {
  return !rt.stopped && !rt.deps.isPaused() && (source?.isCurrent() ?? true)
    && (attempt.epoch === undefined || rt.deps.evidence?.isCurrent(attempt.epoch, source) === true);
}

function logOnce(rt: AmbientRuntime, flag: "skipLogged" | "screenLogged", message: string): void {
  if (rt[flag]) return;
  rt.log.debug(message);
  rt[flag] = true;
}

/**
 * The cheap PRE-FILTER over the foreground T3a recorded: false here means we never route at all. It decides WHETHER a
 * capture is worth considering, never that one is SAFE — screenNow() has the last word, because this entry is one poll
 * old by construction. Three guards, in privacy order:
 * 1. UNKNOWN or STALE foreground -> skip. Fail-closed: with no recent sample (T3a paused, denied, offline, or it
 *    SEALED the state on a sensitive app) we cannot tell what has been on screen, and a capture we cannot screen is
 *    exactly the one to refuse.
 * 2. SENSITIVE app -> skip (prd ruling 4; the process name is never logged — that would re-leak the observation).
 * 3. UNCHANGED window, not yet due for a refresh -> skip. Event-driven capture (research R2/[SP-INTRO]): capturing
 *    the same window every tick adds no new selected evidence.
 */
function captureTarget(rt: AmbientRuntime, at: number): boolean {
  const { config, isSensitive, foreground } = rt.deps;
  const current = foreground();
  if (current === undefined || at < current.observedAt || at - current.observedAt > config.foregroundMaxAgeMs) {
    logOnce(rt, "skipLogged", "foreground unknown or stale; ambient capture skipped");
    return false;
  }
  if (isSensitive(current.processName)) {
    logOnce(rt, "skipLogged", SENSITIVE_SKIP);
    return false;
  }
  rt.skipLogged = false;
  const key = foregroundKey(current.processName, current.windowTitle);
  return key !== rt.lastKey || at - rt.lastCaptureAt >= config.refreshMs;
}

function stop(rt: AmbientRuntime): void {
  const wasRunning = rt.timer !== undefined && !rt.stopped;
  rt.stopped = true;
  if (rt.timer) {
    clearInterval(rt.timer);
    rt.timer = undefined;
  }
  if (wasRunning) notifyPerceptionChange(rt.deps.onChange);
  rt.deps.context.clear();
}

function handleFailure(rt: AmbientRuntime, code: RouteFailureCode, at: number): void {
  if (code === "NO_NODE") {
    if (!rt.offlineLogged) {
      rt.log.info({ code }, "no device provides screenshot-ambient; ambient sampler idle until one connects");
      rt.offlineLogged = true;
    }
    return;
  }
  if (code === "DENIED") {
    // The user denied (or let the single dialog time out): stop for the session — ask-over-poll etiquette, at most
    // ONE ambient dialog per session, and a refusal is respected quietly (no per-tick re-prompt).
    rt.log.info({ code }, "ambient screen capture denied; stopping the ambient sampler for this session");
    stop(rt);
    return;
  }
  rt.consecutiveErrors += 1;
  const { errorBackoffThreshold, maxBackoffMs, pollMs } = rt.deps.config;
  if (rt.consecutiveErrors >= errorBackoffThreshold) {
    const steps = rt.consecutiveErrors - errorBackoffThreshold;
    const backoff = Math.min(maxBackoffMs, pollMs * 2 ** (steps + 1));
    rt.backoffUntil = at + backoff;
    rt.log.warn({ code, consecutiveErrors: rt.consecutiveErrors, backoffMs: backoff }, "ambient sampler backing off");
  }
}

/**
 * The FINAL gate, as late as possible: one fresh foreground-window route immediately before the capture, so the
 * decision rests on what is in front NOW, not on the entry T3a recorded a poll ago. Returns the identity to record,
 * or undefined to skip; fail-closed on everything it cannot read. NOT atomic — the user can still switch between this
 * reply and the capture's, which is D48's remaining residual (one round-trip, down from one poll interval).
 */
async function screenNow(rt: AmbientRuntime, attempt: CaptureAttempt): Promise<Extract<ForegroundScreen, { status: "clear" }> | undefined> {
  const screened = await screenForegroundNow({ route: rt.deps.route, isSensitive: rt.deps.isSensitive });
  if (!current(rt, attempt)) return undefined;
  if (screened.status === "clear") {
    if (!current(rt, attempt, screened.provenance)) return undefined;
    rt.screenLogged = false;
    return screened;
  }
  rt.deps.evidence?.reject();
  if (screened.status === "denied") {
    // Without a fresh foreground this sampler can never satisfy its safety precondition again, so continuing would
    // mean ticking forever only to skip forever — stop, exactly as a denial of its own capability does.
    rt.log.info({ code: "DENIED" }, "foreground screening denied; stopping the ambient sampler for this session");
    stop(rt);
    return undefined;
  }
  logOnce(rt, "screenLogged", screened.status === "sensitive" ? SENSITIVE_SKIP : UNSCREENABLE_SKIP);
  return undefined;
}

async function capture(rt: AmbientRuntime, screened: Extract<ForegroundScreen, { status: "clear" }>, attempt: CaptureAttempt): Promise<void> {
  if (!current(rt, attempt, screened.provenance)) return;
  const routed = await (screened.provenance
    ? rt.deps.route(CAPABILITY, {}, screened.provenance.hostId) : rt.deps.route(CAPABILITY, {}));
  if (!current(rt, attempt, screened.provenance)) return;
  if (!routed.ok) {
    handleFailure(rt, routed.code, attempt.at);
    return;
  }
  if (!current(rt, attempt, routed.provenance)) return;
  if (screened.provenance || routed.provenance) {
    if (!screened.provenance || !routed.provenance || !samePerceptionSource(screened.provenance, routed.provenance)) return;
  }
  rt.consecutiveErrors = 0;
  rt.backoffUntil = 0;
  rt.offlineLogged = false;
  const parsed = ScreenshotOutputSchema.safeParse(routed.output);
  if (!parsed.success) {
    rt.log.warn({ code: "MALFORMED_SAMPLE" }, "ambient capture failed schema; skipping tick");
    return;
  }
  // The FRESH identity is what gets recorded (never the pre-filter's assumption) and it is recorded BEFORE the
  // main decision: a failing request must not turn every tick into a new capture — the refresh window is the retry.
  rt.lastKey = screened.key;
  rt.lastCaptureAt = attempt.at;
  await observeAmbientFrame({
    store: rt.deps.store, context: rt.deps.context,
    dropRawAfterConsumption: rt.deps.config.dropRawAfterConsumption,
  }, parsed.data, {
    observedAt: attempt.at,
    sourceContext: { materials: [{ label: "Ambient screen capture", reference: screened.provenance?.hostId, time: new Date(attempt.at).toISOString() }] },
    isCurrent: () => current(rt, attempt, screened.provenance) && current(rt, attempt, routed.provenance),
  });
}

async function tick(rt: AmbientRuntime): Promise<void> {
  if (rt.stopped || rt.inflight) return;
  const at = rt.now();
  if (at < rt.backoffUntil) return; // still inside a backoff window
  if (rt.deps.isPaused()) {
    if (!rt.pausedLogged) {
      rt.log.info("privacy pause active; ambient screen sampling suspended");
      rt.pausedLogged = true;
    }
    return;
  }
  rt.pausedLogged = false;
  const attempt = { at, epoch: rt.deps.evidence?.generation() };
  if (!captureTarget(rt, at)) return;
  // Pre-flights (activity-sampler precedent): with no node providing a capability, routing would log a per-tick "tool
  // invoked" + NO_NODE pair. Skip it and take the same quiet once-per-streak arm — and no node for the final screen
  // is a refusal like any other.
  if (!rt.deps.hasNode(CAPABILITY)) {
    handleFailure(rt, "NO_NODE", at);
    return;
  }
  if (!rt.deps.hasNode(FOREGROUND_CAPABILITY)) {
    logOnce(rt, "screenLogged", UNSCREENABLE_SKIP);
    return;
  }
  rt.inflight = true;
  try {
    const screened = await screenNow(rt, attempt);
    if (screened === undefined) return;
    await capture(rt, screened, attempt);
  } catch (error) {
    // Defense-in-depth: routeCapability normally does not throw, but the loop must survive any surprise.
    const message = error instanceof Error ? error.message : String(error);
    rt.log.warn({ err: message }, "ambient sampler tick threw; skipping");
  } finally {
    rt.inflight = false;
  }
}

export function createAmbientScreenshotSampler(deps: AmbientScreenshotSamplerDeps): AmbientScreenshotSampler {
  const rt: AmbientRuntime = {
    deps,
    log: deps.logger.child({ mod: "ambient-screen" }),
    now: deps.now ?? Date.now,
    timer: undefined,
    stopped: false,
    inflight: false,
    consecutiveErrors: 0,
    backoffUntil: 0,
    offlineLogged: false,
    pausedLogged: false,
    skipLogged: false,
    screenLogged: false,
    lastKey: undefined,
    lastCaptureAt: Number.NEGATIVE_INFINITY,
  };
  return {
    start() {
      // Gate 1 — DEFAULT OFF (prd ruling 1): not scheduled means no capture, no approval dialog and NO log line
      // either. An "ambient sampling disabled" line every boot would itself advertise a feature the user never
      // enabled; Recall's off-state is fully silent.
      if (!deps.config.enabled) return;
      if (rt.timer || rt.stopped) return;
      rt.timer = setInterval(() => void tick(rt), deps.config.pollMs);
      rt.timer.unref();
      notifyPerceptionChange(deps.onChange);
    },
    stop: () => stop(rt),
    reset() {
      rt.lastKey = undefined;
      rt.lastCaptureAt = Number.NEGATIVE_INFINITY;
    },
    running: () => rt.timer !== undefined && !rt.stopped,
  };
}
