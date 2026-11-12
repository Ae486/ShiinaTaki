/**
 * INPUT:  LabScene lifecycle and explicit clip, synthesis and native playback commands.
 * OUTPUT: speech actions and a typed observation snapshot; one monitor attaches to each loaded model.
 * POS:    experimental / lab — not in production path; keeps native playback and input cancellation scene-local.
 */

import type { FrameContext } from "../scene/frame-hooks.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import { createMouthArmRanges, type MouthArmRangesSnapshot } from "../scene/mouth-arm-ranges.ts";
import { MouthControl, type CustomMouthSnapshot, type MouthMode } from "../scene/mouth-control.ts";
import type { MouthPreview } from "../scene/mouth-profile.ts";
import type { PreparedMouthClip } from "../speech/mouth-preparation.ts";
import { createNativeSpeechMonitor, emptyMouthSnapshot, type NativeMouthSnapshot, type NativeSpeechMonitor } from "../scene/native-speech-monitor.ts";
import { createNativeClipSource, type NativeClipSnapshot } from "../speech/native-clip-source.ts";
import { createNativeSpeechPlayback, type NativeSpeechSnapshot, type NativeSpeechTarget } from "../speech/native-speech-playback.ts";
import type { SpeechProvider, SpeechRequest } from "../speech/speech-provider.ts";
import type { LogLine } from "./controls.ts";

export interface SpeechSettings { volume: number; gain: number; weight: number }

/** Which lip-sync gain/weight the engine currently holds and whether the panel sliders may change them. */
export interface NativeArmSnapshot {
  mode: MouthMode;
  gain: number | null;
  weight: number | null;
  slidersLive: boolean;
}

export interface SpeechPanelSnapshot extends Omit<NativeSpeechSnapshot, "status"> {
  status: Exclude<NativeSpeechSnapshot["status"], "idle"> | "no-audio" | "ready" | "synthesizing";
  clip: NativeClipSnapshot["clip"];
  inputStatus: NativeClipSnapshot["status"];
  mouth: NativeMouthSnapshot;
  custom: CustomMouthSnapshot;
  nativeArm: NativeArmSnapshot;
  ranges: MouthArmRangesSnapshot;
}

export interface SpeechActions {
  loadFile(file: File): Promise<void>;
  synthesize(provider: SpeechProvider, request: SpeechRequest): Promise<void>;
  play(): Promise<boolean>;
  stop(): void;
  resume(): Promise<void>;
  configure(settings: SpeechSettings): void;
  setMouthMode(mode: MouthMode): void;
  previewPose(preview: MouthPreview): void;
  snapshot(): SpeechPanelSnapshot;
  dispose(): void;
}

export function createSpeechActions(scene: LabScene, log: LogLine, prepareClip?: (bytes: ArrayBuffer) => Promise<PreparedMouthClip>): SpeechActions {
  return new PanelSpeechActions(scene, log, prepareClip);
}

class PanelSpeechActions implements SpeechActions {
  private readonly source = createNativeClipSource();
  private readonly playback;
  private readonly log: LogLine;
  private readonly offs: (() => void)[];
  private readonly custom: MouthControl;
  private readonly ranges = createMouthArmRanges();
  private ctx: ModelContext | null = null;
  private target: NativeSpeechTarget | null = null;
  private monitor: NativeSpeechMonitor | null = null;
  private rangesOff: (() => void) | null = null;
  private sliders: SpeechSettings | null = null;
  private engineDefaults: { gain: number; weight: number } | null = null;
  private inputRevision = 0;
  private disposed = false;

  constructor(scene: LabScene, log: LogLine, prepareClip?: (bytes: ArrayBuffer) => Promise<PreparedMouthClip>) {
    this.log = log;
    this.custom = new MouthControl(prepareClip);
    this.playback = createNativeSpeechPlayback({ log,
      onStart: () => { this.custom.startPlayback(); this.ranges.begin(this.custom.snapshot().mode); this.refreshMonitor(); },
      onSettled: () => this.custom.stop() });
    this.offs = [scene.onBeforeDispose(() => this.detach()), scene.onModel((ctx) => this.attach(ctx))];
    if (scene.current !== null) this.attach(scene.current);
  }

  async loadFile(file: File): Promise<void> {
    if (this.disposed) return;
    const revision = this.beginInput();
    const loaded = await this.source.loadFile(file);
    if (revision !== this.inputRevision) return;
    if (loaded) await this.prepareSource();
    if (revision !== this.inputRevision) return;
    this.log(loaded ? "speech clip: local file ready" : "speech clip: file read failed");
  }

  async synthesize(provider: SpeechProvider, request: SpeechRequest): Promise<void> {
    if (this.disposed) return;
    const revision = this.beginInput();
    this.log(`speech synthesis: requested (${provider.id})`);
    const loaded = await this.source.synthesize(provider, request);
    if (revision !== this.inputRevision) return;
    if (loaded) await this.prepareSource();
    if (revision !== this.inputRevision) return;
    this.log(loaded ? `speech clip: ${provider.id} ready` : "speech synthesis: failed");
  }

  async play(): Promise<boolean> {
    if (this.disposed) return false;
    const source = this.source.snapshot();
    if (source.status === "synthesizing" || source.status === "loading-file") return false;
    if (this.custom.snapshot().mode === "envelope" && this.custom.snapshot().preparation.status === "preparing") return false;
    const clip = this.source.clip();
    if (clip === null) return false;
    this.source.cancel();
    const accepted = await this.playback.play(clip);
    if (accepted) this.custom.confirmPlayback();
    return accepted;
  }

  stop(): void {
    this.inputRevision += 1;
    this.source.cancel();
    this.playback.stop();
    this.custom.stop();
    this.custom.cancelPreparation();
    this.log("speech: stopped; pending synthesis cancelled");
  }

  resume(): Promise<void> { return this.playback.resume(); }

  configure(settings: SpeechSettings): void {
    this.sliders = settings;
    this.applyArm();
  }

  setMouthMode(mode: MouthMode): void {
    if (this.disposed) return;
    this.playback.stop();
    this.custom.setMode(mode);
    this.applyArm();
  }

  previewPose(preview: MouthPreview): void {
    if (this.disposed || this.playback.snapshot().pendingNativeLoad) return;
    this.stop();
    this.custom.previewPose(preview);
    this.refreshMonitor();
  }

  snapshot(): SpeechPanelSnapshot {
    const source = this.source.snapshot();
    const native = this.playback.snapshot();
    return { ...native, status: panelStatus(source, native), error: source.error ?? native.error,
      inputStatus: source.status, clip: source.clip, mouth: this.monitor?.snapshot() ?? emptyMouthSnapshot(), custom: this.custom.snapshot(),
      nativeArm: this.nativeArm(), ranges: this.ranges.snapshot() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    for (const off of this.offs) off();
    this.source.dispose();
    this.playback.dispose();
    this.custom.dispose();
  }

  private beginInput(): number {
    this.inputRevision += 1;
    this.playback.reset();
    this.custom.clearInput();
    this.ranges.reset();
    return this.inputRevision;
  }

  private detach(): void {
    this.inputRevision += 1;
    this.source.cancel();
    this.custom.attach(null);
    this.monitor?.dispose();
    this.monitor = null;
    this.rangesOff?.();
    this.rangesOff = null;
    this.playback.attach(null);
    this.ctx = null;
    this.target = null;
    this.engineDefaults = null;
  }

  private attach(ctx: ModelContext): void {
    this.ctx = ctx;
    this.custom.attach(ctx);
    this.ranges.reset();
    // Read the engine's own lip-sync numbers before playback.attach() writes the panel's settings into the same object.
    this.engineDefaults = finiteSettings(ctx.internal.options.lipSyncGain, ctx.internal.options.lipSyncWeight);
    const manager = ctx.internal.motionManager;
    const target: NativeSpeechTarget = { manager, settings: ctx.internal.options, lipSyncEnabled: () => nativeLipSyncEnabled(ctx),
      speak: (url, options) => ctx.model.speak(url, options), stop: () => manager.stopSpeaking() };
    this.playback.attach(target);
    this.playback.reset();
    this.target = target;
    this.applyArm();
    this.refreshMonitor();
  }

  private refreshMonitor(): void {
    this.monitor?.dispose();
    this.rangesOff?.();
    this.monitor = this.ctx === null || this.target === null ? null : createNativeSpeechMonitor({ hooks: this.ctx.hooks,
      target: this.target, ids: this.ctx.facts.lipSyncIds, playback: this.playback });
    // Subscribed after the custom writer (created in onStart), so the ranges see this frame's final values.
    this.rangesOff = this.ctx === null ? null : this.ctx.hooks.add("beforeModelUpdate", (frame) => this.observeRanges(frame));
  }

  private observeRanges(frame: FrameContext): void {
    const ctx = this.ctx;
    const audio = this.playback.snapshot().audio;
    if (ctx === null || !audio.isPlaying || audio.contextState !== "running") return;
    const ids = new Set([...ctx.facts.lipSyncIds, ...this.custom.parameterIds()]);
    this.ranges.observe(this.custom.snapshot().mode,
      Object.fromEntries([...ids].map((id) => [id, frame.params.has(id) ? frame.params.get(id) : null])));
  }

  /** "native" pins the engine's own defaults; the other arms follow the sliders. */
  private applyArm(): void {
    const defaults = this.custom.snapshot().mode === "native" ? this.engineDefaults : null;
    const gain = defaults?.gain ?? this.sliders?.gain;
    const weight = defaults?.weight ?? this.sliders?.weight;
    if (gain === undefined || weight === undefined) return;
    this.playback.configure({ volume: this.sliders?.volume ?? 1, gain, weight });
  }

  private nativeArm(): NativeArmSnapshot {
    const mode = this.custom.snapshot().mode;
    return { mode, gain: this.target?.settings.lipSyncGain ?? null, weight: this.target?.settings.lipSyncWeight ?? null,
      slidersLive: mode !== "native" };
  }

  private async prepareSource(): Promise<void> {
    const clip = this.source.clip();
    if (clip !== null) await this.custom.prepare(clip.bytes);
  }
}

function finiteSettings(gain: number | undefined, weight: number | undefined): { gain: number; weight: number } | null {
  return gain !== undefined && weight !== undefined && Number.isFinite(gain) && Number.isFinite(weight) ? { gain, weight } : null;
}

function nativeLipSyncEnabled(ctx: ModelContext): boolean | null {
  const enabled = "lipSync" in ctx.internal ? ctx.internal.lipSync : undefined;
  return typeof enabled === "boolean" ? enabled : null;
}

function panelStatus(source: NativeClipSnapshot, native: NativeSpeechSnapshot): SpeechPanelSnapshot["status"] {
  if (source.status === "synthesizing") return "synthesizing";
  if (source.status === "loading-file") return "loading";
  if (source.status === "error") return "error";
  if (native.status !== "idle") return source.clip === null && native.status === "stopped" ? "no-audio" : native.status;
  return source.clip === null ? "no-audio" : "ready";
}
