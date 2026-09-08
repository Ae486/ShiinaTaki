/**
 * INPUT:  admitted scrubbed foreground samples, epoch-ms sample times and an optional data-free change observer
 * OUTPUT: bounded rolling activity with dwell-filtered entries, latest current and post-change notification
 * POS:    core/activity — in-memory, OS-neutral state; no timers, capture, persistence or permission decisions
 */
import type { ForegroundWindowOutput } from "@taki/shared";
import { notifyPerceptionChange } from "../perception/notify-perception-change.ts";

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
  /**
   * End the live stretch WITHOUT recording anything: current() goes undefined and the next push opens a fresh entry.
   * Deliberately argument-less and data-free — a caller that must not disclose WHAT it saw (the sensitive-app skip)
   * can still say "the foreground left the entry we were tracking", and the record itself leaks nothing.
   */
  seal(): void;
  /** Reportable entries (>= dwellMinSamples), oldest-first, as defensive copies. */
  entries(): ActivityEntry[];
  /** The live entry still accepting merges, or undefined when the foreground is currently unavailable / empty. */
  current(): ActivityEntry | undefined;
}

// A no-focused-window sample (pet window / desktop foreground) has no process/title; unknown process name is a
// stable placeholder so coalescing identity stays well-defined even on the degraded path.
const UNKNOWN_PROCESS = "unknown";

/** Bound the window: drop entries that ended before the span cutoff, then anything past the hard entry cap. */
function prune(list: ActivityEntry[], config: ActivityConfig, at: number): void {
  const cutoff = at - config.spanMs;
  let head = list[0];
  while (head !== undefined && head.startedAt + head.durationMs < cutoff) {
    list.shift();
    head = list[0];
  }
  while (list.length > config.maxEntries) list.shift();
}

export function createActivityState(config: ActivityConfig, onChange?: () => void): ActivityState {
  const list: ActivityEntry[] = [];
  // A sealed live entry has ended: the next available sample always opens a fresh entry, so idle/away gaps (and the
  // sensitive-app skip, which pushes nothing at all) never silently extend a stretch the user has left.
  let sealed = false;

  // The ONE writer of the flag — push's unavailable branch delegates here, so "the foreground left" means exactly the
  // same thing whichever caller says it.
  function seal(): void {
    const changed = !sealed && list.length > 0;
    sealed = true;
    if (changed) notifyPerceptionChange(onChange);
  }

  return {
    push(sample, at) {
      if (!sample.available) {
        seal();
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
      prune(list, config, at);
      notifyPerceptionChange(onChange);
    },
    seal,
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
