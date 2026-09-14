/**
 * INPUT:  an observed native mouthSync value and the engine's live gain/weight options.
 * OUTPUT: the computed engine clamp and weighted additive contribution, separate from the observed final parameter.
 * POS:    experimental / lab — not in production path; pure mirror of the installed engine's positive-value transform.
 */

export interface NativeLipsyncComputation {
  clamped: number;
  contribution: number;
}

export function computeNativeLipsync(raw: number | null, options: { gain: number; weight: number }): NativeLipsyncComputation | null {
  if (raw === null || ![raw, options.gain, options.weight].every(Number.isFinite)) return null;
  if (raw < 0 || options.gain < 0 || options.weight < 0) return null;
  const gained = raw * options.gain;
  const clamped = Math.min(1, Math.max(gained > 0 ? 0.1 : 0, gained ** 1.15));
  return { clamped, contribution: clamped * options.weight };
}
