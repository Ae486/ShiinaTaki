/**
 * INPUT:  retained clip bytes, scene-local native speak/stop operations and the actual engine audio state.
 * OUTPUT: native playback state, user-gesture resume, per-play URL ownership and retirement of uncancellable loads.
 * POS:    experimental / lab — not in production path; structural contracts, no engine value imports or extra player.
 */

import type { SpeechClip } from "./speech-provider.ts";

export interface NativeSpeakOptions {
  volume: number;
  resetExpression: false;
  onFinish(): void;
  onError(error: Error): void;
}

export interface NativeSpeechTarget {
  manager: {
    currentAudio?: { isPlaying: boolean; volume: number; duration?: number };
    currentContext?: { state: string; resume(): Promise<void> };
    currentAnalyzer?: unknown;
    mouthSync(): number;
  };
  settings: { lipSyncGain?: number; lipSyncWeight?: number };
  lipSyncEnabled(): boolean | null;
  speak(url: string, options: NativeSpeakOptions): Promise<boolean>;
  /** Captures the manager itself: model.stopSpeaking() cannot be used after the model has been destroyed. */
  stop(): void;
}

export interface NativeAudioFacts {
  isPlaying: boolean;
  contextState: string | null;
  analyzerAvailable: boolean;
  durationSeconds: number | null;
}

export interface NativeSpeechSnapshot {
  status: "idle" | "loading" | "playing" | "suspended" | "stopped" | "error";
  error: string | null;
  hasModel: boolean;
  pendingNativeLoad: boolean;
  sequence: number;
  audio: NativeAudioFacts;
  timing: { requestedAtMs: number | null; resolvedAtMs: number | null; observedAudioStartAtMs: number | null };
}

export interface NativeSpeechPlayback {
  attach(target: NativeSpeechTarget | null): void;
  play(clip: SpeechClip): Promise<boolean>;
  stop(): void;
  reset(): void;
  resume(): Promise<void>;
  configure(settings: { volume: number; gain: number; weight: number }): void;
  snapshot(): NativeSpeechSnapshot;
  dispose(): void;
}

interface PlaybackDeps {
  now(): number;
  createUrl(clip: SpeechClip): string;
  revokeUrl(url: string): void;
  log(line: string): void;
  onStart(): void;
  onSettled(): void;
}

interface NativeRun {
  target: NativeSpeechTarget;
  url: string;
  pending: boolean;
  retired: boolean;
  ended: boolean;
  failed: boolean;
  released: boolean;
}

export function createNativeSpeechPlayback(overrides: Partial<PlaybackDeps> = {}): NativeSpeechPlayback {
  return new NativePlayback({
    now: () => performance.now(),
    createUrl: (clip) => URL.createObjectURL(new Blob([clip.bytes], { type: clip.mimeType })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    log: () => undefined,
    onStart: () => undefined,
    onSettled: () => undefined,
    ...overrides,
  });
}

class NativePlayback implements NativeSpeechPlayback {
  private readonly deps: PlaybackDeps;
  private target: NativeSpeechTarget | null = null;
  private run: NativeRun | null = null;
  private disposed = false;
  private status: NativeSpeechSnapshot["status"] = "idle";
  private error: string | null = null;
  private sequence = 0;
  private settings = { volume: 1, gain: 1.5, weight: 0.4 };
  private timing: NativeSpeechSnapshot["timing"] = { requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null };

  constructor(deps: PlaybackDeps) { this.deps = deps; }

  attach(target: NativeSpeechTarget | null): void {
    this.stop();
    this.target = this.disposed ? null : target;
    this.applySettings();
  }

  async play(clip: SpeechClip): Promise<boolean> {
    const target = this.target;
    if (this.disposed || target === null || this.run?.pending || this.snapshot().audio.isPlaying) return false;
    if (clip.bytes.byteLength === 0) { this.fail("The audio clip is empty."); return false; }
    this.stop();
    const run: NativeRun = { target, url: this.deps.createUrl(clip), pending: true, retired: false, ended: false, failed: false, released: false };
    this.run = run;
    this.sequence += 1;
    this.status = "loading";
    this.error = null;
    this.timing = { requestedAtMs: this.deps.now(), resolvedAtMs: null, observedAudioStartAtMs: null };
    this.deps.log("native speak: loading");
    void this.resume();
    try {
      this.deps.onStart();
      const accepted = await target.speak(run.url, {
        volume: this.settings.volume, resetExpression: false,
        onFinish: () => this.finish(run),
        onError: () => this.finish(run, true),
      });
      if (run.retired || this.disposed) return false;
      this.timing.resolvedAtMs = this.deps.now();
      if (!accepted && !run.failed) this.finish(run, true);
      if (accepted && !run.ended) void this.resume();
      return accepted && !run.failed;
    } catch {
      if (!run.retired && !this.disposed) this.finish(run, true);
      return false;
    } finally {
      run.pending = false;
      if (run.retired || run.failed) run.target.stop();
      if (run.retired || run.ended) this.release(run);
      this.observe();
    }
  }

  stop(): void {
    const run = this.run;
    if (run !== null && !run.retired) {
      run.retired = true;
      run.target.stop();
      if (!run.pending) this.release(run);
      this.deps.onSettled();
    }
    this.status = "stopped";
  }

  reset(): void {
    this.stop();
    this.sequence += 1;
    this.timing = { requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null };
    this.status = "idle";
    this.error = null;
  }

  async resume(): Promise<void> {
    const target = this.target;
    const context = target?.manager.currentContext;
    if (this.disposed || context === undefined || context.state !== "suspended") return;
    try { await context.resume(); } catch { /* A user gesture can retry via Resume audio; actual state remains visible. */ }
    if (this.target === target && !this.disposed) this.observe();
  }

  configure(settings: { volume: number; gain: number; weight: number }): void {
    if (![settings.volume, settings.gain, settings.weight].every(Number.isFinite)) return;
    this.settings = { volume: Math.min(1, Math.max(0, settings.volume)), gain: Math.max(0, settings.gain), weight: Math.max(0, settings.weight) };
    this.applySettings();
  }

  snapshot(): NativeSpeechSnapshot {
    this.observe();
    return { status: this.status, error: this.error, hasModel: this.target !== null, pendingNativeLoad: this.run?.pending ?? false,
      sequence: this.sequence, audio: nativeAudioFacts(this.target), timing: { ...this.timing } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.target = null;
  }

  private observe(): void {
    const run = this.run;
    if (run === null || run.retired || run.ended || this.disposed) return;
    const facts = nativeAudioFacts(run.target);
    if (facts.contextState === "suspended") { this.status = "suspended"; return; }
    if (facts.isPlaying && facts.contextState === "running") {
      this.status = "playing";
      this.timing.observedAudioStartAtMs ??= this.deps.now();
    } else if (!run.pending && run.target.manager.currentAudio === undefined) {
      this.finish(run);
    }
  }

  private finish(run: NativeRun, failed = false): void {
    if (this.run !== run || run.retired || run.ended || this.disposed) return;
    run.ended = true;
    run.failed = failed;
    this.deps.onSettled();
    if (failed) this.fail("The native engine could not decode or play this audio clip.");
    else { this.status = "stopped"; this.deps.log("native speak: finished"); }
    if (!run.pending) this.release(run);
  }

  private fail(message: string): void {
    this.error = message;
    this.status = "error";
    this.deps.log("native speak: error");
  }

  private release(run: NativeRun): void {
    if (run.released) return;
    run.released = true;
    this.deps.revokeUrl(run.url);
    if (this.run === run) this.run = null;
  }

  private applySettings(): void {
    if (this.target === null) return;
    this.target.settings.lipSyncGain = this.settings.gain;
    this.target.settings.lipSyncWeight = this.settings.weight;
    if (this.target.manager.currentAudio) this.target.manager.currentAudio.volume = this.settings.volume;
  }
}

export function nativeAudioFacts(target: NativeSpeechTarget | null): NativeAudioFacts {
  const manager = target?.manager;
  const duration = manager?.currentAudio?.duration;
  return { isPlaying: manager?.currentAudio?.isPlaying === true, contextState: manager?.currentContext?.state ?? null,
    analyzerAvailable: manager?.currentAnalyzer != null,
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) ? duration : null };
}
