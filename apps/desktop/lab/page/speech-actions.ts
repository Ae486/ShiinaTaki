/**
 * INPUT:  LabScene lifecycle and explicit clip, synthesis and native playback commands.
 * OUTPUT: speech actions and a typed observation snapshot; one monitor attaches to each loaded model.
 * POS:    experimental / lab — not in production path; keeps native playback and input cancellation scene-local.
 */

import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import { MouthControl, type CustomMouthSnapshot, type MouthMode } from "../scene/mouth-control.ts";
import type { MouthPreview } from "../scene/mouth-profile.ts";
import type { PreparedMouthClip } from "../speech/mouth-preparation.ts";
import { createNativeSpeechMonitor, emptyMouthSnapshot, type NativeMouthSnapshot, type NativeSpeechMonitor } from "../scene/native-speech-monitor.ts";
import { createNativeClipSource, type NativeClipSnapshot } from "../speech/native-clip-source.ts";
import { createNativeSpeechPlayback, type NativeSpeechSnapshot, type NativeSpeechTarget } from "../speech/native-speech-playback.ts";
import type { SpeechProvider, SpeechRequest } from "../speech/speech-provider.ts";
import type { LogLine } from "./controls.ts";

export interface SpeechPanelSnapshot extends Omit<NativeSpeechSnapshot, "status"> {
  status: Exclude<NativeSpeechSnapshot["status"], "idle"> | "no-audio" | "ready" | "synthesizing";
  clip: NativeClipSnapshot["clip"];
  inputStatus: NativeClipSnapshot["status"];
  mouth: NativeMouthSnapshot;
  custom: CustomMouthSnapshot;
}

export interface SpeechActions {
  loadFile(file: File): Promise<void>;
  synthesize(provider: SpeechProvider, request: SpeechRequest): Promise<void>;
  play(): Promise<boolean>;
  stop(): void;
  resume(): Promise<void>;
  configure(settings: { volume: number; gain: number; weight: number }): void;
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
  private ctx: ModelContext | null = null;
  private target: NativeSpeechTarget | null = null;
  private monitor: NativeSpeechMonitor | null = null;
  private inputRevision = 0;
  private disposed = false;

  constructor(scene: LabScene, log: LogLine, prepareClip?: (bytes: ArrayBuffer) => Promise<PreparedMouthClip>) {
    this.log = log;
    this.custom = new MouthControl(prepareClip);
    this.playback = createNativeSpeechPlayback({ log,
      onStart: () => { this.custom.startPlayback(); this.refreshMonitor(); }, onSettled: () => this.custom.stop() });
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

  configure(settings: { volume: number; gain: number; weight: number }): void { this.playback.configure(settings); }

  setMouthMode(mode: MouthMode): void {
    if (this.disposed) return;
    this.playback.stop();
    this.custom.setMode(mode);
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
      inputStatus: source.status, clip: source.clip, mouth: this.monitor?.snapshot() ?? emptyMouthSnapshot(), custom: this.custom.snapshot() };
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
    return this.inputRevision;
  }

  private detach(): void {
    this.inputRevision += 1;
    this.source.cancel();
    this.custom.attach(null);
    this.monitor?.dispose();
    this.monitor = null;
    this.playback.attach(null);
    this.ctx = null;
    this.target = null;
  }

  private attach(ctx: ModelContext): void {
    this.ctx = ctx;
    this.custom.attach(ctx);
    const manager = ctx.internal.motionManager;
    const target: NativeSpeechTarget = { manager, settings: ctx.internal.options, lipSyncEnabled: () => nativeLipSyncEnabled(ctx),
      speak: (url, options) => ctx.model.speak(url, options), stop: () => manager.stopSpeaking() };
    this.playback.attach(target);
    this.playback.reset();
    this.target = target;
    this.refreshMonitor();
  }

  private refreshMonitor(): void {
    this.monitor?.dispose();
    this.monitor = this.ctx === null || this.target === null ? null : createNativeSpeechMonitor({ hooks: this.ctx.hooks,
      target: this.target, ids: this.ctx.facts.lipSyncIds, playback: this.playback });
  }

  private async prepareSource(): Promise<void> {
    const clip = this.source.clip();
    if (clip !== null) await this.custom.prepare(clip.bytes);
  }
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
