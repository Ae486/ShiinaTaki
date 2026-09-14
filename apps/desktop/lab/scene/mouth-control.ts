/**
 * INPUT:  Lab model lifecycle, retained-clip preparation and explicit playback/preview commands.
 * OUTPUT: one custom writer with scoped native-lipsync ownership and truthful preparation/fallback state.
 * POS:    experimental / lab - not in production path; no synthesis, audio output or phoneme recognition.
 */

import { nativeAudioClock, type MouthClockSnapshot } from "../speech/native-audio-clock.ts";
import { prepareMouthClip, type PreparedMouthClip } from "../speech/mouth-preparation.ts";
import type { ModelContext } from "./lab-scene.ts";
import { getMouthProfile, mouthPreviewProfile, type MouthPreview, type MouthProfile } from "./mouth-profile.ts";
import { createMouthTrack } from "./mouth-track.ts";
import { createMouthWriter, type MouthWriter, type MouthWriterSnapshot } from "./mouth-writer.ts";

export type MouthMode = "native" | "envelope";
export interface MouthPreparationSnapshot {
  status: "empty" | "preparing" | "ready" | "error";
  decodeMs: number | null;
  envelopeMs: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface CustomMouthSnapshot {
  mode: MouthMode;
  effectiveMode: MouthMode | "preview";
  profileId: string | null;
  preparation: MouthPreparationSnapshot;
  preview: MouthPreview;
  writer: MouthWriterSnapshot | null;
  clock: MouthClockSnapshot;
  fallbackReason: string | null;
}

export class MouthControl {
  private ctx: ModelContext | null = null;
  private profile: MouthProfile | null = null;
  private writer: MouthWriter | null = null;
  private prepared: PreparedMouthClip | null = null;
  private preparation = emptyPreparation();
  private revision = 0;
  private disposed = false;
  private mode: MouthMode = "envelope";
  private preview: MouthPreview = "off";
  private nativeBefore: boolean | null = null;
  private runFallback: string | null = null;
  private readonly prepareClip: (bytes: ArrayBuffer) => Promise<PreparedMouthClip>;

  constructor(prepareClip = prepareMouthClip) { this.prepareClip = prepareClip; }

  attach(ctx: ModelContext | null): void {
    this.stop();
    this.cancelPreparation();
    this.ctx = this.disposed ? null : ctx;
    this.profile = this.ctx === null ? null : modelProfile(this.ctx);
    this.runFallback = null;
  }

  clearInput(): void {
    this.stop();
    this.revision += 1;
    this.prepared = null;
    this.preparation = emptyPreparation();
    this.runFallback = null;
  }

  async prepare(bytes: ArrayBuffer): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    this.prepared = null;
    this.preparation = { ...emptyPreparation(), status: "preparing" };
    try {
      const result = await this.prepareClip(bytes);
      if (revision !== this.revision || this.disposed) return;
      this.prepared = result;
      this.preparation = { status: "ready", decodeMs: result.decodeMs, envelopeMs: result.envelopeMs,
        durationMs: result.durationMs, error: null };
    } catch {
      if (revision !== this.revision || this.disposed) return;
      this.preparation = { ...emptyPreparation(), status: "error", error: "Envelope analysis unavailable; native playback remains available." };
    }
  }

  cancelPreparation(): void {
    this.revision += 1;
    if (this.preparation.status === "preparing") this.preparation = emptyPreparation();
  }

  setMode(mode: MouthMode): void {
    this.stop();
    this.mode = mode;
    this.runFallback = null;
  }

  startPlayback(): void {
    this.stop();
    this.runFallback = null;
    const ctx = this.ctx;
    if (ctx === null || this.profile === null || this.prepared === null || this.mode !== "envelope") return;
    if (!this.claimNative()) { this.runFallback = "Native lip-sync switch unavailable"; return; }
    this.writer = createMouthWriter({ hooks: ctx.hooks, params: ctx.params, profile: this.profile,
      track: this.prepared.track, clock: () => nativeAudioClock(ctx.internal.motionManager).positionMs ?? Number.NaN });
  }

  confirmPlayback(): void {
    if (this.writer === null || this.ctx === null) return;
    if (nativeAudioClock(this.ctx.internal.motionManager).positionMs !== null) return;
    this.stop();
    this.runFallback = "Audio position unavailable; native playback active";
  }

  previewPose(preview: MouthPreview): void {
    this.stop();
    const ctx = this.ctx;
    if (this.disposed || preview === "off" || ctx === null || this.profile === null) return;
    if (!this.claimNative()) return;
    this.preview = preview;
    const track = createMouthTrack({ durationMs: 1, source: "authored-pose", approximate: true,
      cues: [{ startMs: 0, endMs: 1, mouth: "open", openness: 1, confidence: 1 }] });
    this.writer = createMouthWriter({ hooks: ctx.hooks, params: ctx.params,
      profile: mouthPreviewProfile(this.profile, preview), track, clock: () => 0 });
  }

  stop(): void {
    this.writer?.dispose();
    this.writer = null;
    this.preview = "off";
    if (this.ctx !== null && this.nativeBefore !== null && "lipSync" in this.ctx.internal) {
      this.ctx.internal.lipSync = this.nativeBefore;
    }
    this.nativeBefore = null;
  }

  snapshot(): CustomMouthSnapshot {
    const fallbackReason = this.fallbackReason();
    return { mode: this.mode, effectiveMode: this.preview !== "off" ? "preview" : fallbackReason === null ? this.mode : "native",
      profileId: this.profile === null ? null : `${this.profile.characterId}/${this.profile.costumeId}`,
      preparation: { ...this.preparation }, preview: this.preview, writer: this.writer?.snapshot() ?? null,
      clock: this.ctx === null ? { positionMs: null, source: null, contextState: null } : nativeAudioClock(this.ctx.internal.motionManager),
      fallbackReason };
  }

  dispose(): void {
    this.attach(null);
    this.clearInput();
    this.disposed = true;
  }

  private claimNative(): boolean {
    if (this.ctx === null || !("lipSync" in this.ctx.internal) || typeof this.ctx.internal.lipSync !== "boolean") return false;
    this.nativeBefore = this.ctx.internal.lipSync;
    this.ctx.internal.lipSync = false;
    return true;
  }

  private fallbackReason(): string | null {
    if (this.mode === "native" || this.preview !== "off") return null;
    if (this.runFallback !== null) return this.runFallback;
    if (this.profile === null) return "No calibrated profile for this character/costume";
    if (this.preparation.status === "error") return this.preparation.error;
    if (this.prepared === null) return this.preparation.status === "preparing" ? "Preparing envelope" : "No prepared envelope";
    return null;
  }
}

function modelProfile(ctx: ModelContext): MouthProfile | null {
  const profile = getMouthProfile(ctx.entry.costume, ctx.entry.characterId);
  if (profile === null || profile.generation !== ctx.facts.generation) return null;
  // Exact known rig identity is essential on C2: touching arbitrary IDs can create phantom parameters.
  return Object.values(profile.ids).every((id) => ctx.params.has(id)) ? profile : null;
}

function emptyPreparation(): MouthPreparationSnapshot {
  return { status: "empty", decodeMs: null, envelopeMs: null, durationMs: null, error: null };
}
