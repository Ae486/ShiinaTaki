/**
 * INPUT:  parsed ForegroundWindowOutput samples + an injected epoch-ms clock (never reads the OS/Date itself)
 * OUTPUT: createActivityState(config) -> { push, entries, current }; a bounded, coalesced rolling window of activity
 * POS:    core/activity — the OS-neutral activity layer (invariant 8); pure/deterministic, zero timers, zero Windows deps.
 *         T4's heartbeat reason-gate reads entries()/current(); the sampler feeds push(). In-memory only (no DB in T3a).
 */
import type { ForegroundWindowOutput } from "@taki/shared";

export interface ActivityConfig {
  /** Merge a sample into the live entry only if it lands within this gap of the entry's end (ActivityWatch pulsetime). */
  pulsetimeMs: number;
  /** An entry is REPORTABLE (visible via entries()) only once it has coalesced at least this many samples (dwell). */
  dwellMinSamples: number;
  /** idleSeconds >= this marks a sample idle; idle-ness is part of the merge identity, so active->idle splits entries. */
  idleThresholdSeconds: number;
  /** Drop entries whose end fell more than this before the newest sample (rolling window span). */
  spanMs: number;
  /** Hard cap on retained entries regardless of span (bounds memory even under rapid window churn). */
  maxEntries: number;
}

/** One coalesced stretch of foreground activity. durationMs grows monotonically as identical samples merge in. */
export interface ActivityEntry {
  processName: string;
  windowTitle: string;
  startedAt: number;
  durationMs: number;
  samples: number;
  idle: boolean;
}

export interface ActivityState {
  /** Fold one parsed sample taken at epoch-ms `at` into the rolling window (coalesce / split / drop-old). */
  push(sample: ForegroundWindowOutput, at: number): void;
  /** Reportable entries (>= dwellMinSamples), oldest-first, as defensive copies. */
  entries(): ActivityEntry[];
  /** The live entry still accepting merges, or undefined when the foreground is currently unavailable / empty. */
  current(): ActivityEntry | undefined;
}

// A no-focused-window sample (pet window / desktop foreground) has no process/title; unknown process name is a
// stable placeholder so coalescing identity stays well-defined even on the degraded path.
const UNKNOWN_PROCESS = "unknown";

export function createActivityState(config: ActivityConfig): ActivityState {
  const list: ActivityEntry[] = [];
  // After an available:false sample the live entry is sealed: the next available sample always opens a fresh entry
  // (its growth "ended"), so idle/away gaps never silently extend a stretch the user has left.
  let sealed = false;

  function prune(at: number): void {
    const cutoff = at - config.spanMs;
    let head = list[0];
    while (head !== undefined && head.startedAt + head.durationMs < cutoff) {
      list.shift();
      head = list[0];
    }
    while (list.length > config.maxEntries) list.shift();
  }

  return {
    push(sample, at) {
      if (!sample.available) {
        sealed = true;
        return;
      }
      const processName = sample.processName ?? UNKNOWN_PROCESS;
      const windowTitle = sample.windowTitle ?? "";
      const idle = sample.idleSeconds !== null && sample.idleSeconds >= config.idleThresholdSeconds;
      const live = list[list.length - 1];
      const mergeable =
        !sealed &&
        live !== undefined &&
        live.processName === processName &&
        live.windowTitle === windowTitle &&
        live.idle === idle &&
        at - (live.startedAt + live.durationMs) <= config.pulsetimeMs;
      if (mergeable) {
        // Monotonic extension: a later sample can only lengthen the stretch, never shorten it (AW max-duration guard).
        const grown = at - live.startedAt;
        if (grown > live.durationMs) live.durationMs = grown;
        live.samples += 1;
      } else {
        list.push({ processName, windowTitle, startedAt: at, durationMs: 0, samples: 1, idle });
      }
      sealed = false;
      prune(at);
    },
    entries() {
      return list.filter((e) => e.samples >= config.dwellMinSamples).map((e) => ({ ...e }));
    },
    current() {
      if (sealed) return undefined;
      const live = list[list.length - 1];
      return live ? { ...live } : undefined;
    },
  };
}
