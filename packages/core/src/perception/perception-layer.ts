/**
 * INPUT:  governed routes, availability, optional VLM, ambient config/store, durable pause store and Logger
 * OUTPUT: shared privacy, activity/screen producers, card reads and opt-in content-free invalidations
 * POS:    core/perception — single ambient composition; subscribing never captures or mutates pause consent
 */
import type { PerceptionCard } from "@taki/shared";
import { createActivityLayer, ACTIVITY_POLL_MS, type ActivityLayer } from "../activity/activity-layer.ts";
import { renderActivityContext } from "../activity/render-activity.ts";
import type { RouteResult } from "../capabilities/route-capability.ts";
import type { AmbientScreenshotConfig } from "../config/ambient-screenshot-config.ts";
import type { Logger } from "../logging/logger.ts";
import {
  createAmbientScreenshotSampler,
  type AmbientForeground,
  type AmbientScreenshotSampler,
  type AmbientScreenshotSamplerConfig,
} from "./ambient-screenshot-sampler.ts";
import { startAmbientShotGc } from "./ambient-shot-gc.ts";
import { createAmbientShotStore, type AmbientShotStore } from "./ambient-shot-store.ts";
import { buildPerceptionCard, type PerceptionCardDeps } from "./perception-card.ts";
import { createPerceptionChanges, type PerceptionChanges } from "./perception-changes.ts";
import { createPerceptionEvidence, type PerceptionEvidence } from "./perception-evidence.ts";
import { createPrivacyPause, type PrivacyPause, type PrivacyPauseStore } from "./privacy-pause.ts";
import { createScreenContext, renderScreenContext, type ScreenContext } from "./screen-context.ts";
import { createSensitiveProcessCheck } from "./sensitive-processes.ts";

// Ambient defaults, beside the activity layer's own (D11 config-ize when #26 gives them a panel):
// - POLL: 30s, the same ambient floor T3a took (research ra R2 — how often a capture is CONSIDERED, not taken).
// - REFRESH: DERIVED (research ra §OMITTED holds no sourced number). Re-describe a still window every 5 min so the
//   screen block cannot silently go stale, while capture stays event-driven (~12 VLM calls/h at rest, not 120).
// - STALE: 2x REFRESH bounds a stopped sampler's observation age. Consent/source retirement clears it immediately.
// - FOREGROUND_MAX_AGE: 2x the T3a poll — the same pulsetime tolerance the activity state uses to call a sample
//   contiguous; older than that we do not know what is on screen (fail-closed, see captureTarget).
const AMBIENT_POLL_MS = 30_000;
const AMBIENT_REFRESH_MS = 5 * 60 * 1000;
const SCREEN_STALE_MS = 2 * AMBIENT_REFRESH_MS;
const FOREGROUND_MAX_AGE_MS = 2 * ACTIVITY_POLL_MS;
const AMBIENT_BACKOFF = { errorBackoffThreshold: 3, maxBackoffMs: 10 * 60 * 1000 };

export interface PerceptionLayerDeps {
  route: (capability: string, input: unknown, targetHostId?: string) => Promise<RouteResult>;
  /** True iff a node currently provides `capability`; each sampler asks about its OWN capability name. */
  hasNode: (capability: string) => boolean;
  /** The screenshot→VLM bridge (vision slot); absent = ambient sampling never starts (capture with no text is cost). */
  describe?: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
  /** The ambient switch + raw-frame retention (env today, panel at #26). */
  ambient: AmbientScreenshotConfig;
  /** The ambient-ONLY frame directory — never the on-demand screenshots dir, which the sweeper must not reach. */
  ambientShotsDir: string;
  /** Where the Privacy Pause survives a restart (the DB row in production); absent = in-memory only. */
  pauseStore?: PrivacyPauseStore;
  logger: Logger;
  onChanged?: () => void;
}

export interface PerceptionLayer {
  /** The Privacy Pause every ambient sampler consults; its operator WS surface + UI land with #26. */
  pause: PrivacyPause;
  /** The shared sensitive-process skip predicate; the user-editable list lands with #26. */
  isSensitive: (processName: string | null) => boolean;
  activity: ActivityLayer;
  screen: ScreenContext;
  ambient: AmbientScreenshotSampler;
  changes: PerceptionChanges;
  evidence: PerceptionEvidence;
  /** Start every ambient sampler + the retention sweeper (one call from the composition root). */
  start(): void;
  /** Retire projection interest/deadlines and stop sampler schedules at Core shutdown. */
  dispose(): void;
  /** The fenced ambient prompt sections (activity + screen), joined; "" when nothing is reportable. */
  renderContext(now: number): string;
  /** The human-facing status card served by `perception.card` (panel at #26) — never a prompt surface. */
  card(now: number): PerceptionCard;
}

/** The foreground the T3a sampler last recorded. `startedAt + durationMs` IS the last sample's timestamp (freshness). */
function foregroundOf(activity: ActivityLayer): AmbientForeground | undefined {
  const current = activity.state.current();
  if (current === undefined) return undefined;
  return {
    processName: current.processName,
    windowTitle: current.windowTitle,
    observedAt: current.startedAt + current.durationMs,
  };
}

/** The ambient sampler's cadence/retention knobs: the layer's own defaults + the two user-facing config values. */
function ambientConfigOf(ambient: AmbientScreenshotConfig): AmbientScreenshotSamplerConfig {
  return {
    enabled: ambient.enabled,
    pollMs: AMBIENT_POLL_MS,
    refreshMs: AMBIENT_REFRESH_MS,
    foregroundMaxAgeMs: FOREGROUND_MAX_AGE_MS,
    dropRawAfterDescribe: ambient.retention.mode === "drop-after-describe",
    ...AMBIENT_BACKOFF,
  };
}

/** The card's live source. Each sampler's scheduling is probed per READ, never cached: one that stopped itself on a
 *  denial must not keep claiming it observes. */
function cardDepsOf(parts: { activity: ActivityLayer; ambient: AmbientScreenshotSampler; pause: PrivacyPause }): PerceptionCardDeps {
  return {
    activity: parts.activity.state,
    pause: parts.pause,
    sampling: () => ({ foreground: parts.activity.sampler.running(), ambientScreen: parts.ambient.running() }),
  };
}

function disposePerception(parts: Pick<PerceptionLayer, "changes" | "activity" | "ambient">): void {
  // Retire interest before stopping schedules so Core shutdown cannot publish new view work.
  parts.changes.dispose();
  parts.activity.sampler.stop();
  parts.ambient.stop();
}

export function createPerceptionLayer(deps: PerceptionLayerDeps): PerceptionLayer {
  // The pause thunk is not read until interest exists; every producer hook is installed before start().
  const changes = createPerceptionChanges({ pauseState: (at) => pause.state(at), onChanged: deps.onChanged });
  // Hydrated from the store by the FACTORY: restoring a pause must never look like a mutation (privacy-pause.ts).
  const pause = createPrivacyPause({ store: deps.pauseStore, onChange: () => {
    // This observer runs only after the durable consent write. Even pause+resume within one await retires its epoch.
    changes.batch(() => {
      evidence.retire();
      changes.pauseChanged();
    });
  } });
  const screen = createScreenContext({ staleAfterMs: SCREEN_STALE_MS });
  const evidence = createPerceptionEvidence({
    isPaused: () => pause.isPaused(),
    freshnessMs: FOREGROUND_MAX_AGE_MS,
    onRetire: (clearHistory) => { if (clearHistory) activity.state.clear(); else activity.state.seal(); screen.clear(); ambient.reset(); },
    onChange: changes.changed,
  });
  const isSensitive = createSensitiveProcessCheck();
  const activity = createActivityLayer({
    route: deps.route,
    hasNode: () => deps.hasNode("foreground-window"),
    isPaused: () => pause.isPaused(),
    isSensitive,
    logger: deps.logger,
    onChange: changes.changed,
    evidence,
  });
  const store = createAmbientShotStore({ ambientDir: deps.ambientShotsDir });
  const ambient = createAmbientScreenshotSampler({
    route: deps.route,
    // Two capabilities, not one: the capture itself and the fresh foreground-window screen it takes immediately
    // before capturing (the sampler asks per capability, so a missing node for either one keeps it quiet).
    hasNode: deps.hasNode,
    isPaused: () => pause.isPaused(),
    isSensitive,
    foreground: () => foregroundOf(activity),
    describe: deps.describe,
    store,
    context: screen,
    logger: deps.logger,
    config: ambientConfigOf(deps.ambient),
    onChange: changes.changed,
    evidence,
  });
  return completeLayer({ pause, isSensitive, activity, screen, ambient, changes, evidence }, deps, store);
}

type PerceptionParts = Pick<PerceptionLayer, "pause" | "isSensitive" | "activity" | "screen" | "ambient" | "changes" | "evidence">;

function completeLayer(parts: PerceptionParts, deps: PerceptionLayerDeps, store: AmbientShotStore): PerceptionLayer {
  const { activity, ambient, screen, evidence } = parts;
  const cardDeps = cardDepsOf(parts);
  return {
    ...parts,
    start() {
      activity.sampler.start();
      ambient.start();
      // Retention runs regardless of the enable flag: frames captured before ambient sensing was switched off must
      // still expire. `keep` schedules nothing at all.
      startAmbientShotGc({ store, retention: deps.ambient.retention, logger: deps.logger });
    },
    dispose: () => disposePerception(parts),
    renderContext: (now) => {
      evidence.generation();
      return [renderActivityContext(activity.state, now), renderScreenContext(screen, now)]
        .filter((section) => section.length > 0)
        .join("\n\n");
    },
    card: (now) => { evidence.generation(); return buildPerceptionCard(cardDeps, now); },
  };
}
