/**
 * INPUT:  decoded mono PCM and a short analysis-frame configuration.
 * OUTPUT: deterministic, normalised speech envelope with noise-floor subtraction, attack/release smoothing and pause closure.
 * POS:    experimental / lab — not in production path; provider and renderer independent; the result is indexed by clip-relative milliseconds.
 */

export interface EnvelopeInput {
  readonly pcm: Float32Array;
  readonly sampleRate: number;
  readonly frameMs?: number;
  readonly attackMs?: number;
  readonly releaseMs?: number;
  readonly pauseMs?: number;
}

export interface EnvelopeFrame {
  readonly timeMs: number;
  readonly value: number;
  readonly rms: number;
  readonly closed: boolean;
}

export interface MouthEnvelope {
  readonly durationMs: number;
  readonly frameMs: number;
  readonly noiseFloor: number;
  readonly peak: number;
  readonly frames: readonly EnvelopeFrame[];
}

const DEFAULT_FRAME_MS = 16;
const DEFAULT_ATTACK_MS = 24;
const DEFAULT_RELEASE_MS = 84;
const DEFAULT_PAUSE_MS = 64;
const SILENCE_THRESHOLD = 0.12;

export function analyzeMouthEnvelope(input: EnvelopeInput): MouthEnvelope {
  const frameMs = clamp(input.frameMs ?? DEFAULT_FRAME_MS, 10, 20);
  const sampleRate = input.sampleRate > 0 && Number.isFinite(input.sampleRate) ? input.sampleRate : 1;
  const frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const rawRms = collectRms(input.pcm, frameSamples);
  const noiseFloor = percentile(rawRms, 0.1) * 0.5;
  const adjusted = rawRms.map((value) => Math.max(0, value - noiseFloor));
  const peak = adjusted.reduce((maximum, value) => Math.max(maximum, value), 0);
  const attackMs = positiveOr(input.attackMs, DEFAULT_ATTACK_MS);
  const releaseMs = positiveOr(input.releaseMs, DEFAULT_RELEASE_MS);
  const pauseMs = Math.max(frameMs, positiveOr(input.pauseMs, DEFAULT_PAUSE_MS));
  const pauseFrames = Math.max(1, Math.ceil(pauseMs / frameMs));
  const frames: EnvelopeFrame[] = [];
  let smoothed = 0;
  let quietFrames = 0;
  for (let index = 0; index < adjusted.length; index += 1) {
    const target = peak === 0 ? 0 : (adjusted[index] ?? 0) / peak;
    const deltaMs = frameMs;
    const timeConstant = target >= smoothed ? attackMs : releaseMs;
    const alpha = 1 - Math.exp(-deltaMs / timeConstant);
    smoothed += (target - smoothed) * alpha;
    // A release tail should decay naturally, but a sustained low-energy run must still close the mouth promptly.
    if (target < SILENCE_THRESHOLD) quietFrames += 1;
    else quietFrames = 0;
    const closed = quietFrames >= pauseFrames;
    const value = closed ? 0 : clamp01(smoothed);
    frames.push({ timeMs: index * frameMs, value, rms: rawRms[index] ?? 0, closed });
  }
  return {
    durationMs: input.pcm.length === 0 ? 0 : (input.pcm.length / sampleRate) * 1000,
    frameMs,
    noiseFloor,
    peak,
    frames,
  };
}

export function envelopeValueAt(envelope: MouthEnvelope, timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs >= envelope.durationMs || envelope.frames.length === 0) return 0;
  const position = timeMs / envelope.frameMs;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(envelope.frames.length - 1, lowerIndex + 1);
  const lower = envelope.frames[lowerIndex];
  const upper = envelope.frames[upperIndex];
  if (lower === undefined || upper === undefined) return 0;
  return lowerIndex === upperIndex ? lower.value : lower.value + (upper.value - lower.value) * (position - lowerIndex);
}

function collectRms(pcm: Float32Array, frameSamples: number): number[] {
  const result: number[] = [];
  for (let start = 0; start < pcm.length; start += frameSamples) {
    const end = Math.min(pcm.length, start + frameSamples);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const sample = pcm[index] ?? 0;
      sum += sample * sample;
    }
    result.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  return result;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index] ?? 0;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
