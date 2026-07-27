/**
 * INPUT:  the OS-neutral ActivityState, the Privacy Pause, a per-sampler running() probe, and an epoch-ms clock
 * OUTPUT: buildPerceptionCard(deps, now) -> PerceptionCard { current, recent, samplingStatus, pauseState }
 * POS:    core/perception — the read side of perception for HUMANS (the #26 panel over `perception.card`), the twin of
 *         render-activity's agent-facing block. No fence here: nothing on this path enters a prompt. Pure and
 *         deterministic — it reads the same in-memory state the samplers feed, and computes nothing of its own.
 */
import type { PerceptionActivityEntry, PerceptionCard, PerceptionSamplingStatus } from "@taki/shared";
import type { ActivityEntry, ActivityState } from "../activity/activity-state.ts";
import type { PrivacyPause } from "./privacy-pause.ts";

// The card is a status surface, not a history query (activity history stays in-memory and bounded, D43): a fixed
// newest-first slice keeps the frame small whatever the rolling window holds.
const RECENT_LIMIT = 10;

export interface PerceptionCardDeps {
  activity: ActivityState;
  pause: PrivacyPause;
  /** Whether each ambient sampler is actually scheduled right now (enable flag, degrade, stop and denial included). */
  sampling: () => PerceptionSamplingStatus;
}

/** Live duration reflects real elapsed time on the window, not just the last-sample gap (render-activity's rule). */
function entryOf(entry: ActivityEntry, elapsedMs?: number): PerceptionActivityEntry {
  return { ...entry, durationMs: elapsedMs === undefined ? entry.durationMs : Math.max(entry.durationMs, elapsedMs) };
}

export function buildPerceptionCard(deps: PerceptionCardDeps, now: number): PerceptionCard {
  const live = deps.activity.current();
  const isLive = (entry: ActivityEntry): boolean =>
    live !== undefined && entry.startedAt === live.startedAt && entry.processName === live.processName;
  const recent = deps.activity
    .entries()
    .filter((entry) => !isLive(entry))
    .slice(-RECENT_LIMIT)
    .reverse()
    .map((entry) => entryOf(entry));
  return {
    // The live entry is shown before it reaches the prompt's dwell threshold: the card answers "what am I on now" for
    // the person who already knows, where the prompt must wait for a stretch worth mentioning.
    current: live === undefined ? null : entryOf(live, now - live.startedAt),
    recent,
    samplingStatus: deps.sampling(),
    pauseState: deps.pause.state(now),
  };
}
