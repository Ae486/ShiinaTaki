/**
 * INPUT:  a route fn (partial-applied routeCapability) + a Logger
 * OUTPUT: createActivityLayer(deps) -> { state, sampler }; the perception layer wired with its default cadence/bounds
 * POS:    core/activity — the single composition point + home of the deterministic defaults (D11 config-ize later);
 *         main.ts constructs one of these, starts the sampler, and renders state via render-activity.
 */
import type { Logger } from "../logging/logger.ts";
import type { RouteResult } from "../capabilities/route-capability.ts";
import { createActivitySampler, type ActivitySampler } from "./activity-sampler.ts";
import { createActivityState, type ActivityState } from "./activity-state.ts";

// Deterministic defaults (tunable later): pulsetime = 2× poll so one missed tick never splits a stretch; dwell 2
// samples (~60s) before an entry is reportable; idle 180s (ActivityWatch/BANDORI convergent default); 2h rolling span;
// maxEntries 240 = 2h ÷ 30s poll (worst case: every tick a distinct window, never coalesced).
/** Exported so a sibling sampler can express its freshness tolerance in TICKS of this poll, never as a magic number. */
export const ACTIVITY_POLL_MS = 30_000;
const DEFAULTS = {
  pollMs: ACTIVITY_POLL_MS,
  pulsetimeMs: 2 * ACTIVITY_POLL_MS,
  dwellMinSamples: 2,
  idleThresholdSeconds: 180,
  spanMs: 2 * 60 * 60 * 1000,
  maxEntries: 240,
  errorBackoffThreshold: 3,
  maxBackoffMs: 10 * 60 * 1000,
} as const;

export interface ActivityLayerDeps {
  route: (capability: string, input: unknown) => Promise<RouteResult>;
  /** True iff a node currently provides foreground-window; forwarded to the sampler's pre-route offline skip. */
  hasNode: () => boolean;
  /** Privacy Pause (core/perception): forwarded verbatim — the layer owns cadence, never privacy policy. */
  isPaused: () => boolean;
  /** Sensitive-process skip (core/perception): forwarded verbatim; a hit drops the sample before it is stored. */
  isSensitive: (processName: string | null) => boolean;
  logger: Logger;
}

export interface ActivityLayer {
  state: ActivityState;
  sampler: ActivitySampler;
}

export function createActivityLayer(deps: ActivityLayerDeps): ActivityLayer {
  const state = createActivityState({
    pulsetimeMs: DEFAULTS.pulsetimeMs,
    dwellMinSamples: DEFAULTS.dwellMinSamples,
    idleThresholdSeconds: DEFAULTS.idleThresholdSeconds,
    spanMs: DEFAULTS.spanMs,
    maxEntries: DEFAULTS.maxEntries,
  });
  const sampler = createActivitySampler({
    route: deps.route,
    hasNode: deps.hasNode,
    isPaused: deps.isPaused,
    isSensitive: deps.isSensitive,
    state,
    logger: deps.logger,
    config: { pollMs: DEFAULTS.pollMs, errorBackoffThreshold: DEFAULTS.errorBackoffThreshold, maxBackoffMs: DEFAULTS.maxBackoffMs },
  });
  return { state, sampler };
}
