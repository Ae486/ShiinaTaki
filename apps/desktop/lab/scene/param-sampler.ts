/**
 * INPUT:  a model's FrameHooks + an isMotionPlaying probe (motionManager.isFinished() inverted).
 * OUTPUT: createParamSampler(hooks, probe) -> ParamSampler: track(ids) / snapshot() / dispose(). Every frame the
 *         tracked ids are read at the three hook positions into { before, after, final }; `drift` latches per id when
 *         the `before` (persistent base) value changes between two consecutive motion-idle frames — the visible
 *         signature of an `add` write at afterMotionUpdate accumulating (design §3 / §5.6).
 * POS:    experimental / lab — not in production path; pure over FrameHooks, node-testable with fakes.
 */

import type { FrameHooks } from "./frame-hooks.ts";

export interface ParamSample {
  before: number;
  after: number;
  final: number;
}

export interface SamplerSnapshot {
  samples: Record<string, ParamSample>;
  drift: Record<string, boolean>;
}

export interface ParamSampler {
  /** Replaces the tracked id set; drift latches reset for ids no longer tracked. */
  track(ids: readonly string[]): void;
  ids(): string[];
  snapshot(): SamplerSnapshot;
  dispose(): void;
}

// Below this a change is float noise, not a write (both cores hold parameters as 32-bit floats).
const DRIFT_EPSILON = 1e-5;

export function createParamSampler(hooks: FrameHooks, isMotionPlaying: () => boolean): ParamSampler {
  let tracked: string[] = [];
  const samples: Record<string, ParamSample> = {};
  const drift: Record<string, boolean> = {};
  let previousIdleBefore: Record<string, number> = {};

  const offs = [
    hooks.add("beforeMotionUpdate", (ctx) => {
      const playing = isMotionPlaying();
      const idleBefore: Record<string, number> = {};
      for (const id of tracked) {
        const value = ctx.params.get(id);
        samples[id] = { ...(samples[id] ?? blank()), before: value };
        if (playing) continue;
        idleBefore[id] = value;
        const previous = previousIdleBefore[id];
        if (previous !== undefined && Math.abs(previous - value) > DRIFT_EPSILON) drift[id] = true;
      }
      // Only two consecutive idle frames count: the frame a motion ends still carries that motion's last write.
      previousIdleBefore = idleBefore;
    }),
    hooks.add("afterMotionUpdate", (ctx) => {
      for (const id of tracked) samples[id] = { ...(samples[id] ?? blank()), after: ctx.params.get(id) };
    }),
    hooks.add("beforeModelUpdate", (ctx) => {
      for (const id of tracked) samples[id] = { ...(samples[id] ?? blank()), final: ctx.params.get(id) };
    }),
  ];

  return {
    track(ids) {
      tracked = [...new Set(ids)];
      for (const id of Object.keys(samples)) {
        if (tracked.includes(id)) continue;
        delete samples[id];
        delete drift[id];
        delete previousIdleBefore[id];
      }
    },
    ids: () => [...tracked],
    snapshot: () => ({ samples: { ...samples }, drift: { ...drift } }),
    dispose() {
      for (const off of offs) off();
      tracked = [];
    },
  };
}

function blank(): ParamSample {
  return { before: Number.NaN, after: Number.NaN, final: Number.NaN };
}
