/**
 * INPUT:  beforeModelUpdate frames, the native audio manager and the playback observer's performance.now timestamps.
 * OUTPUT: observed raw/final values, separately computed lip-sync values and a labeled observation-time difference.
 * POS:    experimental / lab — not in production path; read-only monitor, never a second player or speaker-latency claim.
 */

import { computeNativeLipsync } from "../speech/native-lipsync.ts";
import type { NativeSpeechPlayback, NativeSpeechTarget } from "../speech/native-speech-playback.ts";
import type { FrameContext, FrameHooks } from "./frame-hooks.ts";

export interface NativeMouthSnapshot {
  sampledAtMs: number | null;
  raw: number | null;
  computedClamped: number | null;
  computedContribution: number | null;
  lipSyncEnabled: boolean | null;
  final: Record<string, number | null>;
  /** First observed positive computed contribution with native lipSync enabled, not measured mouth movement. */
  firstNonzeroMouthAtMs: number | null;
  observedAudioToMouthMs: number | null;
}

interface MonitorInput {
  hooks: FrameHooks;
  target: NativeSpeechTarget;
  ids: readonly string[];
  playback: NativeSpeechPlayback;
}

export interface NativeSpeechMonitor {
  snapshot(): NativeMouthSnapshot;
  dispose(): void;
}

export function createNativeSpeechMonitor(input: MonitorInput, now = () => performance.now()): NativeSpeechMonitor {
  let current: NativeMouthSnapshot = emptyMouthSnapshot();
  let sequence = -1;
  const syncSequence = (next: number): void => {
    if (next === sequence) return;
    current = emptyMouthSnapshot();
    sequence = next;
  };
  const off = input.hooks.add("beforeModelUpdate", (frame) => {
    const playback = input.playback.snapshot();
    syncSequence(playback.sequence);
    current = sampleMouth(input, frame, current);
    // FrameContext.nowMs was captured at beforeMotionUpdate; these observations happen later. Use the same current
    // performance clock as playback observation to avoid inventing a negative delta from the two hook positions.
    current.sampledAtMs = now();
    const audioStart = playback.timing.observedAudioStartAtMs;
    if (audioStart !== null && current.lipSyncEnabled === true && current.computedContribution !== null && current.computedContribution > 0) {
      current.firstNonzeroMouthAtMs ??= current.sampledAtMs;
    }
    current.observedAudioToMouthMs = audioStart !== null && current.firstNonzeroMouthAtMs !== null ? current.firstNonzeroMouthAtMs - audioStart : null;
  });
  return {
    snapshot() {
      // Source replacement can occur while the ticker is paused. Retire the old clip's observations immediately.
      syncSequence(input.playback.snapshot().sequence);
      return { ...current, final: { ...current.final } };
    },
    dispose: off,
  };
}

export function emptyMouthSnapshot(): NativeMouthSnapshot {
  return { sampledAtMs: null, raw: null, computedClamped: null, computedContribution: null, lipSyncEnabled: null,
    final: {}, firstNonzeroMouthAtMs: null, observedAudioToMouthMs: null };
}

function sampleMouth(input: MonitorInput, frame: FrameContext, previous: NativeMouthSnapshot): NativeMouthSnapshot {
  const manager = input.target.manager;
  // mouthSync() returns zero without an analyzer. Absence of analysis is unavailable data, not measured silence.
  const raw = manager.currentAudio && manager.currentAnalyzer != null ? finite(manager.mouthSync()) : null;
  const computed = computeNativeLipsync(raw, { gain: input.target.settings.lipSyncGain ?? Number.NaN, weight: input.target.settings.lipSyncWeight ?? Number.NaN });
  const final = Object.fromEntries(input.ids.map((id) => [id, frame.params.has(id) ? finite(frame.params.get(id)) : null]));
  return { ...previous, sampledAtMs: frame.nowMs, raw, computedClamped: computed?.clamped ?? null,
    computedContribution: computed?.contribution ?? null, lipSyncEnabled: input.target.lipSyncEnabled(), final };
}

function finite(value: number): number | null { return Number.isFinite(value) ? value : null; }
