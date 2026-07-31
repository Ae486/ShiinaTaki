/**
 * INPUT:  a named sweep function + a Logger (+ an optional interval override)
 * OUTPUT: startSweeper(spec) -> void; one boot sweep plus an unref'd 6h interval, logging only what the sweep returns
 * POS:    core/scheduler — the shape every retention arm shares (attachment bytes, ambient frames, memory entries),
 *         extracted at the third instance (T5-R8). Deliberately not the croner scheduler (D5): these are internal
 *         housekeeping timers, not user-visible schedules; unref() keeps them from holding the process open
 */
import type { Logger } from "../logging/logger.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** What one pass reclaimed, as log fields. Counts and policy names only — memory content never reaches a log line. */
export type SweepCounts = Record<string, number | string>;

export interface SweeperSpec {
  /** Child-logger `mod` name for this sweeper's line. */
  name: string;
  /** The message logged after a pass that reported something. */
  message: string;
  /**
   * One pass. Returns the count fields to log, or `undefined` when the pass reclaimed nothing: a sweeper that logs
   * every idle tick trains its reader to ignore it.
   */
  sweep(): SweepCounts | undefined;
  logger: Logger;
  intervalMs?: number;
}

export function startSweeper(spec: SweeperSpec): void {
  const log = spec.logger.child({ mod: spec.name });
  const run = (): void => {
    const swept = spec.sweep();
    if (swept) log.info(swept, spec.message);
  };
  run(); // the boot sweep covers what expired while the process was down
  setInterval(run, spec.intervalMs ?? SWEEP_INTERVAL_MS).unref();
}
