/**
 * INPUT:  a validated clip-relative mouth track, a measured costume profile, a frame-hook seam and an audio clock.
 * OUTPUT: an explicitly-owned, Lab-only mouth writer that maps the current cue to declared parameters with `set`.
 * POS:    experimental / lab — not in production path; no engine or provider imports and no native lip-sync policy.
 */

import type { FrameHooks } from "./frame-hooks.ts";
import type { ParamAccess } from "./param-access.ts";
import { mapMouthSample, mouthPoseWrites, type MappedMouthPose, type MouthParameterWrite, type MouthProfile } from "./mouth-profile.ts";
import { sampleMouthTrack, type MouthSample, type MouthTrack } from "./mouth-track.ts";

export interface MouthWriterOptions {
  readonly hooks: FrameHooks;
  readonly params: ParamAccess;
  readonly profile: MouthProfile;
  readonly track?: MouthTrack | null;
  /** Clip-relative elapsed milliseconds. The caller owns the audio clock and may return a fractional value. */
  readonly clock?: () => number;
  /** Minimum confidence before a non-rest cue is reduced to a conservative open pose. */
  readonly confidenceThreshold?: number;
  /** ParamAccess write weight. Keep this at 1 for deterministic ownership. */
  readonly weight?: number;
}

export interface MouthWriterSnapshot {
  readonly enabled: boolean;
  readonly active: boolean;
  readonly fallback: boolean;
  readonly elapsedMs: number | null;
  readonly source: MouthTrack["source"] | null;
  readonly sample: MouthSample;
  readonly mapped: MappedMouthPose | null;
  readonly writes: readonly MouthParameterWrite[];
  readonly skippedIds: readonly string[];
}

export interface MouthWriter {
  setTrack(track: MouthTrack | null, clock?: () => number): void;
  reset(): void;
  snapshot(): MouthWriterSnapshot;
  detach(): void;
  dispose(): void;
}

interface MappedWriteInput {
  readonly sample: MouthSample;
  readonly effective: MouthSample;
  readonly mapped: MappedMouthPose;
  readonly elapsedMs: number;
  readonly fallback: boolean;
}

interface SampleWriteInput {
  readonly sample: MouthSample;
  readonly elapsedMs: number | null;
  readonly mapped: MappedMouthPose | null;
  readonly fallback: boolean;
}

const REST_SAMPLE: MouthSample = { mouth: "rest", openness: 0, confidence: 1, active: false };

export function createMouthWriter(options: MouthWriterOptions): MouthWriter {
  return new LabMouthWriter(options);
}

class LabMouthWriter implements MouthWriter {
  private readonly options: MouthWriterOptions;
  private track: MouthTrack | null;
  private clock: () => number;
  private readonly threshold: number;
  private readonly weight: number;
  private readonly off: () => void;
  private current: MouthWriterSnapshot = emptySnapshot();
  private disposed = false;
  private detached = false;

  constructor(options: MouthWriterOptions) {
    this.options = options;
    this.track = options.track ?? null;
    this.clock = options.clock ?? (() => 0);
    this.threshold = clamp01(options.confidenceThreshold ?? 0.25);
    this.weight = clamp01(options.weight ?? 1);
    this.off = options.hooks.add("beforeModelUpdate", () => {
      if (!this.disposed && !this.detached) this.writeCurrent(safeClock(this.clock));
    });
  }

  setTrack(track: MouthTrack | null, clock?: () => number): void {
    if (this.disposed || this.detached) return;
    this.track = track;
    if (clock !== undefined) this.clock = clock;
    this.current = { ...emptySnapshot(), enabled: true, source: track?.source ?? null };
    this.writeCurrent(safeClock(this.clock));
  }

  reset(): void {
    if (this.disposed || this.detached) return;
    this.track = null;
    this.current = emptySnapshot();
    this.writeSample({ sample: REST_SAMPLE, elapsedMs: null, mapped: null, fallback: false });
  }

  snapshot(): MouthWriterSnapshot {
    return { ...this.current, sample: { ...this.current.sample }, writes: [...this.current.writes], skippedIds: [...this.current.skippedIds] };
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.off();
    this.writeSample({ sample: REST_SAMPLE, elapsedMs: null, mapped: null, fallback: false });
    this.current = { ...emptySnapshot(), enabled: false };
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
  }

  private writeCurrent(elapsedMs: number | null): void {
    const track = this.track;
    if (track === null || elapsedMs === null || elapsedMs < 0 || elapsedMs >= track.durationMs) {
      this.writeSample({ sample: REST_SAMPLE, elapsedMs, mapped: null, fallback: false });
      return;
    }
    const sample = sampleMouthTrack(track, elapsedMs);
    const fallback = sample.active && (sample.mouth === "unknown" || sample.confidence < this.threshold);
    const effective = fallback ? conservativeSample(sample) : sample;
    this.writeMapped({ sample, effective, mapped: mapMouthSample(this.options.profile, effective), elapsedMs, fallback });
  }

  private writeSample(input: SampleWriteInput): void {
    const mapped = input.mapped ?? mapMouthSample(this.options.profile, input.sample);
    this.writeMapped({ ...input, effective: input.sample, mapped, elapsedMs: input.elapsedMs ?? 0 });
    this.current = { ...this.current, active: false, elapsedMs: input.elapsedMs, mapped };
  }

  private writeMapped(input: MappedWriteInput): void {
    const writes: MouthParameterWrite[] = [];
    const skippedIds: string[] = [];
    for (const write of mouthPoseWrites(this.options.profile, input.mapped)) {
      if (!this.options.params.has(write.id)) {
        skippedIds.push(write.id);
        continue;
      }
      this.options.params.set(write.id, write.value, this.weight);
      writes.push(write);
    }
    this.current = { enabled: true, active: input.effective.active, fallback: input.fallback,
      elapsedMs: input.elapsedMs, source: this.track?.source ?? null, sample: { ...input.sample }, mapped: input.mapped, writes, skippedIds };
  }
}

function emptySnapshot(): MouthWriterSnapshot {
  return { enabled: true, active: false, fallback: false, elapsedMs: null, source: null,
    sample: { ...REST_SAMPLE }, mapped: null, writes: [], skippedIds: [] };
}

function conservativeSample(sample: MouthSample): MouthSample {
  const openness = clamp01(Math.min(0.35, sample.openness));
  return { ...sample, mouth: openness > 0 ? "open" : "rest", active: openness > 0, openness };
}

function safeClock(clock: () => number): number | null {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
