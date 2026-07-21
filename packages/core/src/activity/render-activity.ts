/**
 * INPUT:  an ActivityState + an epoch-ms clock; reads its reportable entries + current live entry
 * OUTPUT: renderActivityContext(state, now) -> a compact English activity block wrapped in the A1 untrusted fence,
 *         or "" when nothing is reportable (empty contributes nothing to the instructionsExtra join)
 * POS:    core/activity — the read-side renderer that turns the OS-neutral activity layer into a prompt section;
 *         the WHOLE block is fenced (window titles are untrusted external content) via agents/untrusted-fence.
 */
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import type { ActivityEntry, ActivityState } from "./activity-state.ts";

const SOURCE = "foreground-activity-sampler";
// Keep the prompt budget small: at most this many recent stretches beyond the current one.
const MAX_RECENT = 3;

function minutes(durationMs: number): string {
  const mins = Math.round(durationMs / 60_000);
  return mins < 1 ? "<1 min" : `${mins} min`;
}

function label(entry: ActivityEntry): string {
  const title = entry.windowTitle.length > 0 ? ` — ${entry.windowTitle}` : "";
  return `${entry.processName}${title}`;
}

/** Build the fenced activity section, or "" when the user's activity is not yet reportable. */
export function renderActivityContext(state: ActivityState, now: number): string {
  const reportable = state.entries();
  if (reportable.length === 0) return "";
  const current = state.current();
  const isLive = (e: ActivityEntry): boolean =>
    current !== undefined && e.startedAt === current.startedAt && e.processName === current.processName;

  const lines: string[] = [];
  const live = reportable.find(isLive);
  if (live) {
    // Live duration reflects real elapsed time on the window (now - start), not just the last-sample gap.
    const dur = minutes(Math.max(live.durationMs, now - live.startedAt));
    lines.push(`Now: ${label(live)} (for ${dur})${live.idle ? ", user idle" : ""}`);
  }
  const earlier = reportable.filter((e) => !isLive(e)).slice(-MAX_RECENT).reverse();
  for (const e of earlier) lines.push(`Earlier: ${label(e)} (${minutes(e.durationMs)})${e.idle ? ", idle" : ""}`);
  if (lines.length === 0) return "";

  return fenceUntrusted({ source: SOURCE, content: lines.join("\n") });
}
