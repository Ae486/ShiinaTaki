/**
 * INPUT:  an AmbientShotStore, the configured AmbientRetention, a Logger, an optional injected clock
 * OUTPUT: startAmbientShotGc(deps) -> stop handle; one boot sweep plus a 6h unref'd interval (none under `keep`)
 * POS:    core/perception — the retention ENFORCEMENT arm of ambient capture. Retention that nobody sweeps is not
 *         retention: the inline drop-after-consumption covers the normal path, this covers the crash-interrupted one and
 *         the day-granularity policy. Runs independently of the enable flag, so frames captured before ambient
 *         sensing was switched off still expire. The schedule/log shape is scheduler/sweep-runner.ts (T5-R8).
 */
import { startSweeper } from "../scheduler/sweep-runner.ts";
import type { AmbientRetention } from "../config/ambient-screenshot-config.ts";
import type { Logger } from "../logging/logger.ts";
import type { AmbientShotStore } from "./ambient-shot-store.ts";

export interface AmbientShotGcDeps {
  store: AmbientShotStore;
  retention: AmbientRetention;
  logger: Logger;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic one. */
  now?: () => number;
}

/** The sweep cutoff for a policy, or null when nothing is ever swept (`keep`). */
function cutoffFor(retention: AmbientRetention, at: number): number | null {
  if (retention.mode === "keep") return null;
  // drop-after-consumption: startup removes leftovers; later sweeps exclude live protected pending/in-use frames.
  return retention.mode === "delete-after-days" ? at - retention.ttlMs : Number.POSITIVE_INFINITY;
}

export function startAmbientShotGc(deps: AmbientShotGcDeps): { stop(): void } {
  if (deps.retention.mode === "keep") return { stop() { /* No retention timer exists for this policy. */ } };
  const now = deps.now ?? Date.now;
  return startSweeper({
    name: "ambient-shots",
    message: "ambient frames swept",
    logger: deps.logger,
    sweep: () => {
      const cutoff = cutoffFor(deps.retention, now());
      if (cutoff === null) return undefined;
      const swept = deps.store.sweepOlderThan(cutoff);
      return swept.removedCount > 0 ? { ...swept, retention: deps.retention.mode } : undefined;
    },
  });
}
