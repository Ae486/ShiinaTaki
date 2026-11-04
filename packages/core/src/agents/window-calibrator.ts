/**
 * INPUT:  a WindowStateRepo (persisted calibration), the slot id, the slot's DECLARED contextTokens (config)
 * OUTPUT: createWindowCalibrator({repo, slot, declared}) -> { effectiveWindow, onUsage, onOverflow }
 * POS:    core/agents — T5-R1 tier 2: the provider's post-hoc usage back-calibrates a rolling correction factor
 *         over our estimator; T5-R2: an overflow SHRINKS the persisted effective window (never triggers compaction)
 */
import type { WindowStateRepo } from "../db/window-state-repo.ts";
import type { ContextWindowSnapshot } from "@taki/shared";

// EMA smoothing for the observed/estimated ratio. LOCAL choice: heavy enough that a handful of turns converge,
// light enough that one outlier request cannot swing the window (the clamp below is the hard guard).
export const EMA_ALPHA = 0.3;

// Factor clamp [0.5, 2] (LOCAL): one bad sample must not halve or double the usable window.
export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2;

// R2's own number: after an overflow the effective window becomes 90% of the observed usage.
export const OVERFLOW_RETAIN = 0.9;

export interface WindowCalibrator {
  /**
   * The usable window in ESTIMATOR units: effective real tokens ÷ correction factor. A factor > 1 means the
   * estimator undercounts, so fewer estimated tokens fit the same real window (and vice versa). Callers budget
   * against THIS number (history slice = effectiveWindow × historyRatio).
   */
  effectiveWindow(): number;
  /** Read-only dispatch snapshot; provider occupancy uses the real-token denominator. */
  snapshot(): ContextWindowSnapshot;
  /** Feed one turn's observed input tokens + our estimate for the SAME request; non-positive samples are ignored. */
  onUsage(observedInput: number, estimatedInput: number): void;
  /** R2: shrink the effective window to floor(observed × 0.9), persist, return the new REAL-token window. */
  onOverflow(observedInput: number): number;
}

export interface WindowCalibratorDeps {
  repo: WindowStateRepo;
  slot: string;
  declared: number;
}

export function createWindowCalibrator(deps: WindowCalibratorDeps): WindowCalibrator {
  const { repo, slot, declared } = deps;
  const persisted = repo.get(slot);
  // The declared config is the operator's authority: a persisted window above a LOWERED declaration clamps down;
  // a persisted overflow-shrink below it survives the restart (that is the point of persisting, R2).
  let effective = persisted ? Math.min(persisted.effectiveWindow, declared) : declared;
  let factor = persisted ? clampFactor(persisted.factor) : 1;
  if (persisted && persisted.effectiveWindow > declared) {
    repo.set(slot, { effectiveWindow: effective, factor });
  }

  return {
    effectiveWindow: () => Math.max(1, Math.floor(effective / factor)),
    snapshot: () => ({ declaredRealTokens: declared, effectiveRealTokens: effective,
      estimatorWindowUnits: Math.max(1, Math.floor(effective / factor)), factor }),
    onUsage(observedInput, estimatedInput) {
      if (!isPositive(observedInput) || !isPositive(estimatedInput)) return;
      factor = clampFactor(EMA_ALPHA * (observedInput / estimatedInput) + (1 - EMA_ALPHA) * factor);
      repo.set(slot, { effectiveWindow: effective, factor });
    },
    onOverflow(observedInput) {
      if (isPositive(observedInput)) {
        // Never raises above declared; the max(1) floor keeps a garbage observation from zeroing the window.
        effective = Math.max(1, Math.min(declared, Math.floor(observedInput * OVERFLOW_RETAIN)));
        repo.set(slot, { effectiveWindow: effective, factor });
      }
      return effective;
    },
  };
}

function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, value));
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
