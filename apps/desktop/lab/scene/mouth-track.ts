/**
 * INPUT:  serializable, clip-relative mouth cues produced by a locale adapter or an audio analyser.
 * OUTPUT: validated/sorted `MouthTrack` values plus deterministic time sampling and cue interpolation.
 * POS:    experimental / lab — not in production path; language and renderer independent; no Live2D or provider imports.
 */

export type MouthClass =
  | "rest"
  | "closed"
  | "open"
  | "wide"
  | "spread"
  | "rounded"
  | "narrow-rounded"
  | "fricative"
  | "unknown";

export type MouthTrackSource =
  | "native-energy"
  | "envelope"
  | "text-heuristic"
  | "aligned"
  | "provider-viseme"
  | "authored-pose"
  | "acoustic";

export interface MouthCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly mouth: MouthClass;
  readonly openness: number;
  readonly confidence: number;
  readonly locale?: string;
}

export interface MouthTrack {
  readonly durationMs: number;
  readonly cues: readonly MouthCue[];
  readonly source: MouthTrackSource;
  readonly approximate: boolean;
}

export interface MouthSample {
  readonly mouth: MouthClass;
  readonly openness: number;
  readonly confidence: number;
  readonly active: boolean;
  readonly locale?: string;
}

export interface TrackValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface CreateMouthTrackInput {
  readonly durationMs: number;
  readonly cues: readonly MouthCue[];
  readonly source: MouthTrackSource;
  readonly approximate: boolean;
}

export function createMouthTrack(input: CreateMouthTrackInput): MouthTrack {
  const track: MouthTrack = {
    durationMs: finiteNonNegative(input.durationMs),
    cues: sortMouthCues(input.cues).map(normalizeCue),
    source: input.source,
    approximate: input.approximate,
  };
  const validation = validateMouthTrack(track);
  if (!validation.valid) throw new Error(`lab mouth-track: ${validation.issues.join("; ")}`);
  return track;
}

export function sortMouthCues(cues: readonly MouthCue[]): MouthCue[] {
  return [...cues].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export function validateMouthTrack(track: MouthTrack): TrackValidation {
  const issues: string[] = [];
  if (!Number.isFinite(track.durationMs) || track.durationMs < 0) issues.push("durationMs must be finite and non-negative");
  let previousStart = -Infinity;
  for (const cue of track.cues) {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)) issues.push("cue times must be finite");
    if (cue.startMs < 0 || cue.endMs > track.durationMs) issues.push("cue must stay within track duration");
    if (cue.endMs <= cue.startMs) issues.push("cue endMs must be greater than startMs");
    if (cue.startMs < previousStart) issues.push("cues must be sorted by startMs");
    if (!Number.isFinite(cue.openness) || cue.openness < 0 || cue.openness > 1) issues.push("openness must be in [0, 1]");
    if (!Number.isFinite(cue.confidence) || cue.confidence < 0 || cue.confidence > 1) issues.push("confidence must be in [0, 1]");
    previousStart = cue.startMs;
  }
  return { valid: issues.length === 0, issues };
}

export function sampleMouthTrack(track: MouthTrack, timeMs: number): MouthSample {
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs >= track.durationMs) return restSample();
  const active = track.cues.filter((cue) => timeMs >= cue.startMs && timeMs < cue.endMs);
  if (active.length === 0) return restSample();
  const first = active[0];
  const second = active[active.length - 1];
  if (first === undefined || second === undefined) return restSample();
  if (active.length === 1) return sampleCue(first, timeMs);
  const overlapStart = Math.max(first.startMs, second.startMs);
  const overlapEnd = Math.min(first.endMs, second.endMs);
  const progress = overlapEnd <= overlapStart ? 0 : (timeMs - overlapStart) / (overlapEnd - overlapStart);
  return interpolateMouthCues(first, second, progress);
}

export function interpolateMouthCues(from: MouthCue, to: MouthCue, progress: number): MouthSample {
  const amount = clamp01(progress);
  const mouth = amount < 0.5 ? from.mouth : to.mouth;
  const locale = amount < 0.5 ? from.locale : to.locale;
  return {
    mouth,
    openness: lerp(from.openness, to.openness, amount),
    confidence: lerp(from.confidence, to.confidence, amount),
    active: mouth !== "rest",
    ...(locale === undefined ? {} : { locale }),
  };
}

function sampleCue(cue: MouthCue, timeMs: number): MouthSample {
  const duration = cue.endMs - cue.startMs;
  const progress = duration <= 0 ? 0 : (timeMs - cue.startMs) / duration;
  return interpolateMouthCues(cue, cue, progress);
}

function normalizeCue(cue: MouthCue): MouthCue {
  return {
    ...cue,
    startMs: Math.max(0, cue.startMs),
    endMs: Math.max(0, cue.endMs),
    openness: clamp01(cue.openness),
    confidence: clamp01(cue.confidence),
  };
}

function restSample(): MouthSample {
  return { mouth: "rest", openness: 0, confidence: 0, active: false };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
