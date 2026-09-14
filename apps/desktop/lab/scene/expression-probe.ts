/**
 * INPUT:  a successfully applied expression, its effective parameter writes and a three-position frame sample.
 * OUTPUT: a narrowly labeled single-parameter comparison, or an explicit pending/unknown/idle reference reading.
 * POS:    experimental / lab — not in production path; pure interpretation, never whole-face certification.
 */

import type { ExpressionState } from "./expression-control.ts";
import { type FaceParam, isDeclaredMult } from "./face-params.ts";
import type { ParamSample } from "./param-sampler.ts";

const TOLERANCE = 0.05;

export interface ExpressionProbeInput {
  state: ExpressionState;
  probe: FaceParam | null;
  sample: ParamSample | undefined;
  available: boolean;
  playing: boolean;
  nowMs: number;
}

export function pickExpressionProbe(entries: readonly FaceParam[]): FaceParam | null {
  // C2 declared mult actually sets eye-open; C3 numeric Blend 2 adds then often clamps it. Both make poor probes.
  const candidates = entries.filter((p) => p.calc !== "mult" && !isDeclaredMult(p) && p.blend !== 2 && Number.isFinite(p.value) && p.value !== 0);
  return candidates.reduce<FaceParam | null>((best, p) => best === null || Math.abs(p.value) > Math.abs(best.value) ? p : best, null);
}

export function describeExpressionProbe(input: ExpressionProbeInput): string {
  const { state, probe, sample, playing } = input;
  if (state.kind === "pending") return `expression probe: pending (${state.name})`;
  if (state.kind !== "applied") return "expression probe: unavailable (no successfully applied expression)";
  if (input.nowMs < state.settleAt) return `expression probe: settling (${state.name})`;
  if (probe === null) return `expression probe: unknown (${state.name}: no suitable nonzero parameter)`;
  if (!input.available || sample === undefined || !Number.isFinite(sample.final) || !Number.isFinite(sample.after)) {
    return `expression probe: unknown (${state.name}; ${probe.id} unavailable or not sampled)`;
  }
  const detail = `expression ${state.name}; ${probe.id}; expected ${probe.value.toFixed(3)}, observed ${sample.final.toFixed(3)}; motion output ${sample.after.toFixed(3)}`;
  if (!playing) return `expression reference: ${detail}; motion idle; no gate verdict`;
  const matches = Math.abs(sample.final - probe.value) <= TOLERANCE;
  return `expression parameter probe: ${matches ? "yes" : "no"} (single parameter; ${detail}; motion playing)`;
}
