/**
 * INPUT:  a route fn (partial-applied routeCapability), an ActivityState sink, a Logger, cadence/backoff config
 * OUTPUT: createActivitySampler(deps) -> { start, stop }; a self-scheduling poll that feeds the activity layer
 * POS:    core/activity — the SYSTEM-initiated poll loop (no LLM, no tool()): calls the foreground-window capability
 *         directly over the WS→Gate seam. setInterval(...).unref() per the attachment-GC precedent (main.ts:337).
 *         Never throws; a denied grant stops the loop for the session (at most ONE approval dialog ever originates here).
 */
import { ForegroundWindowOutputSchema } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { RouteFailureCode, RouteResult } from "../capabilities/route-capability.ts";
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
  state: ActivityState;
  logger: Logger;
  config: ActivitySamplerConfig;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic clock. */
  now?: () => number;
}

export interface ActivitySampler {
  start(): void;
  stop(): void;
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
}

function stop(rt: SamplerRuntime): void {
  rt.stopped = true;
  if (rt.timer) {
    clearInterval(rt.timer);
    rt.timer = undefined;
  }
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
    rt.deps.state.push(parsed.data, at);
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
  };
  return {
    start() {
      if (rt.timer || rt.stopped) return;
      rt.timer = setInterval(() => void tick(rt), deps.config.pollMs);
      rt.timer.unref();
    },
    stop: () => stop(rt),
  };
}
