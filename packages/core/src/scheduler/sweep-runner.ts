/**
 * INPUT:  a named sweep function + a Logger (+ an optional interval override)
 * OUTPUT: startSweeper(spec) -> stop handle; one boot sweep plus an unref'd 6h interval, with no overlapping pass
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
  sweep(): SweepCounts | undefined | Promise<SweepCounts | undefined>;
  logger: Logger;
  intervalMs?: number;
  /** Optional authority gate; disabled sweeps remain installed but perform no retired work. */
  enabled?: () => boolean;
}

export function startSweeper(spec: SweeperSpec): { stop(): void } {
  const log = spec.logger.child({ mod: spec.name });
  let running = false;
  let stopped = false;
  const complete = (counts: SweepCounts | undefined): void => {
    running = false;
    if (counts) log.info(counts, spec.message);
  };
  const fail = (): void => {
    running = false;
    // A provider/database rejection may contain private payloads. Only the stable failure class is diagnostic.
    log.warn({ code: "SWEEP_FAILED" }, "retention sweep failed; will retry");
  };
  const run = (): void => {
    if (stopped || running) return;
    try {
      if (spec.enabled && !spec.enabled()) return;
      running = true;
      const swept = spec.sweep();
      // Legacy filesystem sweepers remain synchronous. Authority-provider maintenance reports only after its
      // durable async result arrives, and a slow provider can never start a second overlapping interval pass.
      if (swept instanceof Promise) void swept.then(complete, fail);
      else complete(swept);
    } catch {
      fail();
    }
  };
  run(); // the boot sweep covers what expired while the process was down
  const timer = setInterval(run, spec.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
