/**
 * INPUT:  governed foreground route, privacy/availability predicates, ActivityState, cadence and change observer
 * OUTPUT: start/stop/running; admitted scrubbed samples and data-free scheduling transitions
 * POS:    core/activity — system sampling only; pause before route, sensitive seal + scrub before state publication
 */
import { ForegroundWindowOutputSchema, type ForegroundWindowOutput } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { RouteFailureCode, RouteResult } from "../capabilities/route-capability.ts";
import { scrubPii } from "../perception/pii-scrub.ts";
import { notifyPerceptionChange } from "../perception/notify-perception-change.ts";
import type { ActivityState } from "./activity-state.ts";

const CAPABILITY = "foreground-window";

export interface ActivitySamplerConfig {
  /** Base poll cadence: the interval between foreground-window samples. */
  pollMs: number;
  /** Consecutive non-terminal errors before exponential backoff engages. */
  errorBackoffThreshold: number;
  /** Ceiling for the exponential backoff window (a dead Shell must not spin the loop). */
  maxBackoffMs: number;
}

export interface ActivitySamplerDeps {
  route: (capability: string, input: unknown) => Promise<RouteResult>;
  /** True iff a node currently provides foreground-window; a false skips routing entirely so no route-level log fires. */
  hasNode: () => boolean;
  /** True while Privacy Pause suspends ambient observation: the tick never routes — no sample, no dialog, no noise. */
  isPaused: () => boolean;
  /** True when the sampled app is on the sensitive skip list; its whole sample (title included) is dropped. */
  isSensitive: (processName: string | null) => boolean;
  state: ActivityState;
  logger: Logger;
  config: ActivitySamplerConfig;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic clock. */
  now?: () => number;
  /** Called after running() changes, never for an attempted/skipped capture. */
  onChange?: () => void;
}

export interface ActivitySampler {
  start(): void;
  stop(): void;
  /** True while the poll is scheduled — false before start(), after stop(), and once a denial ended the session. */
  running(): boolean;
}

// The loop's mutable state travels in one context so the tick/failure logic lives at module scope (function size cap).
interface SamplerRuntime {
  deps: ActivitySamplerDeps;
  log: Logger;
  now: () => number;
  timer: ReturnType<typeof setInterval> | undefined;
  stopped: boolean;
  inflight: boolean;
  consecutiveErrors: number;
  backoffUntil: number;
  offlineLogged: boolean;
  pausedLogged: boolean;
  sensitiveLogged: boolean;
}

// A paused core must stay silent (Recall off-state): log once per pause streak, exactly like the offline skip, and
// never route — so a pause produces no capture, no approval dialog and no per-tick log pair.
function pausedSkip(rt: SamplerRuntime): boolean {
  if (!rt.deps.isPaused()) {
    rt.pausedLogged = false;
    return false;
  }
  if (!rt.pausedLogged) {
    rt.log.info("privacy pause active; foreground sampling suspended");
    rt.pausedLogged = true;
  }
  return true;
}

// A skip-list hit drops the WHOLE sample: a password-manager / banking window TITLE leaks by itself, so it never
// enters the activity layer. The process name is deliberately absent from the log — naming it would re-leak the very
// observation the skip exists to prevent.
// SEAL, don't merely drop (prd ruling 6, privacy layer 1): dropping would leave the last NON-sensitive entry live, so
// for up to one staleness window the ambient sampler would still believe that app is in front and photograph the
// sensitive one — pixels sent to a REMOTE endpoint, past any semantic check. Sealing carries no data (no name, no
// title, no timestamp) and self-clears: the next ordinary sample opens a fresh entry and observation resumes.
// It takes effect from the tick AFTER this one (the ambient sampler reads a foreground that is one poll old by
// construction); the window BEFORE T3a's first sight of the app is closed by that sampler's own fresh pre-capture
// screen (perception/foreground-screen.ts), not here — D48 tracks what is left of it.
function sensitiveSkip(rt: SamplerRuntime, sample: ForegroundWindowOutput): boolean {
  if (!rt.deps.isSensitive(sample.processName)) {
    rt.sensitiveLogged = false;
    return false;
  }
  rt.deps.state.seal();
  if (!rt.sensitiveLogged) {
    rt.log.debug("sensitive foreground app; sample dropped");
    rt.sensitiveLogged = true;
  }
  return true;
}

// Scrub-then-fence (prd ruling 5): PII leaves the title HERE, at the sense seam, so the prompt path (fenced in
// render-activity) and any future store both inherit the same minimized string. The fence stays where it is.
function scrubSample(sample: ForegroundWindowOutput): ForegroundWindowOutput {
  if (sample.windowTitle === null) return sample;
  return { ...sample, windowTitle: scrubPii(sample.windowTitle) };
}

function stop(rt: SamplerRuntime): void {
  const wasRunning = rt.timer !== undefined && !rt.stopped;
  rt.stopped = true;
  if (rt.timer) {
    clearInterval(rt.timer);
    rt.timer = undefined;
  }
  if (wasRunning) notifyPerceptionChange(rt.deps.onChange);
}

function handleFailure(rt: SamplerRuntime, code: RouteFailureCode, at: number): void {
  if (code === "NO_NODE") {
    // Shell offline: quiet skip, retry next tick; log at most once per offline streak (no backoff escalation).
    if (!rt.offlineLogged) {
      rt.log.info({ code }, "no device provides foreground-window; sampler idle until one connects");
      rt.offlineLogged = true;
    }
    return;
  }
  if (code === "DENIED") {
    // The user denied (or let the single dialog time out): stop for the session so no further dialog ever originates
    // here (Recall off = fully silent). A session/always grant would have resolved ok and never reached this arm.
    rt.log.info({ code }, "foreground-window sampling denied; stopping the sampler for this session");
    stop(rt);
    return;
  }
  // Any other routed failure (CAPABILITY_TIMEOUT / EXEC_FAILED / …): skip, and back off once errors persist.
  rt.consecutiveErrors += 1;
  const { errorBackoffThreshold, maxBackoffMs, pollMs } = rt.deps.config;
  if (rt.consecutiveErrors >= errorBackoffThreshold) {
    const steps = rt.consecutiveErrors - errorBackoffThreshold;
    const backoff = Math.min(maxBackoffMs, pollMs * 2 ** (steps + 1));
    rt.backoffUntil = at + backoff;
    rt.log.warn({ code, consecutiveErrors: rt.consecutiveErrors, backoffMs: backoff }, "activity sampler backing off");
  }
}

async function tick(rt: SamplerRuntime): Promise<void> {
  if (rt.stopped || rt.inflight) return;
  const at = rt.now();
  if (at < rt.backoffUntil) return; // still inside a backoff window
  if (pausedSkip(rt)) return;
  // Pre-flight: with no node providing the capability, routeCapability would log a per-call "tool invoked" + NO_NODE
  // "routing failed" pair every tick. Skip routing entirely and take the same quiet once-per-streak NO_NODE arm; the
  // route-side handleFailure NO_NODE branch stays as defense-in-depth (a node can drop between this check and the route).
  if (!rt.deps.hasNode()) {
    handleFailure(rt, "NO_NODE", at);
    return;
  }
  rt.inflight = true;
  try {
    const routed = await rt.deps.route(CAPABILITY, {});
    if (!routed.ok) {
      handleFailure(rt, routed.code, at);
      return;
    }
    rt.consecutiveErrors = 0;
    rt.backoffUntil = 0;
    rt.offlineLogged = false;
    const parsed = ForegroundWindowOutputSchema.safeParse(routed.output);
    if (!parsed.success) {
      rt.log.warn({ code: "MALFORMED_SAMPLE" }, "foreground sample failed schema; skipping tick");
      return;
    }
    if (sensitiveSkip(rt, parsed.data)) return;
    rt.deps.state.push(scrubSample(parsed.data), at);
  } catch (error) {
    // Defense-in-depth: routeCapability never throws, but the loop must survive any surprise without crashing.
    const message = error instanceof Error ? error.message : String(error);
    rt.log.warn({ err: message }, "activity sampler tick threw; skipping");
  } finally {
    rt.inflight = false;
  }
}

export function createActivitySampler(deps: ActivitySamplerDeps): ActivitySampler {
  const rt: SamplerRuntime = {
    deps,
    log: deps.logger.child({ mod: "activity" }),
    now: deps.now ?? Date.now,
    timer: undefined,
    stopped: false,
    inflight: false,
    consecutiveErrors: 0,
    backoffUntil: 0,
    offlineLogged: false,
    pausedLogged: false,
    sensitiveLogged: false,
  };
  return {
    start() {
      if (rt.timer || rt.stopped) return;
      rt.timer = setInterval(() => void tick(rt), deps.config.pollMs);
      rt.timer.unref();
      notifyPerceptionChange(deps.onChange);
    },
    stop: () => stop(rt),
    running: () => rt.timer !== undefined && !rt.stopped,
  };
}
