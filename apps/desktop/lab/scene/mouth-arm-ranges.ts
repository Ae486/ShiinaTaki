/**
 * INPUT:  per-frame final mouth parameter values observed while one comparison arm plays audio.
 * OUTPUT: per-arm min/max/frame-count per parameter id, so amplitude caps are not mistaken for algorithm differences.
 * POS:    experimental / lab - not in production path; pure accumulator, no engine imports, never coerces unknown to 0.
 */

import type { MouthMode } from "./mouth-control.ts";

export type MouthArm = MouthMode;

export interface MouthRangeStat {
  readonly min: number;
  readonly max: number;
  readonly frames: number;
}

export type MouthArmRangesSnapshot = Readonly<Record<MouthArm, Readonly<Record<string, MouthRangeStat>> | null>>;

export interface MouthArmRanges {
  /** Clears the arm's previous run so each readout describes exactly one playback. */
  begin(arm: MouthArm): void;
  observe(arm: MouthArm, values: Readonly<Record<string, number | null>>): void;
  reset(): void;
  snapshot(): MouthArmRangesSnapshot;
}

export const MOUTH_ARMS: readonly MouthArm[] = ["native", "native-tuned", "envelope"];

export function createMouthArmRanges(): MouthArmRanges {
  let arms = emptyArms();
  return {
    begin(arm) { arms = { ...arms, [arm]: {} }; },
    observe(arm, values) {
      const stats: Record<string, MouthRangeStat> = { ...(arms[arm] ?? {}) };
      for (const [id, value] of Object.entries(values)) {
        if (value === null || !Number.isFinite(value)) continue;
        const previous = stats[id];
        stats[id] = previous === undefined ? { min: value, max: value, frames: 1 }
          : { min: Math.min(previous.min, value), max: Math.max(previous.max, value), frames: previous.frames + 1 };
      }
      arms = { ...arms, [arm]: stats };
    },
    reset() { arms = emptyArms(); },
    snapshot: () => arms,
  };
}

function emptyArms(): Record<MouthArm, Record<string, MouthRangeStat> | null> {
  return { native: null, "native-tuned": null, envelope: null };
}
