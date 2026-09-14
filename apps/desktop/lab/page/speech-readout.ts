/**
 * INPUT:  the native speech panel's observed state and computed lip-sync contribution.
 * OUTPUT: compact labeled readout and command availability, with unavailable values rendered as n/a.
 * POS:    experimental / lab — not in production path; measured final parameters remain separate from estimates.
 */

import type { SpeechPanelSnapshot } from "./speech-actions.ts";

export function renderSpeechSnapshot(snapshot: SpeechPanelSnapshot): string {
  const { clip, audio, timing, mouth } = snapshot;
  return [
    `speech: ${snapshot.status}${snapshot.hasModel ? "" : " (no model)"}`,
    `clip: ${clip ? `${clip.name} (${clip.bytes} bytes, ${clip.mimeType})` : "none"}`,
    ...(clip?.synthesisMs == null ? [] : [`synthesis: ${fmt(clip.synthesisMs)} ms`]),
    ...(snapshot.error === null ? [] : [`error: ${snapshot.error}`]),
    `native load pending: ${snapshot.pendingNativeLoad}`,
    `audio.isPlaying: ${audio.isPlaying}; context: ${audio.contextState ?? "n/a"}`,
    `analyzer: ${audio.analyzerAvailable ? "present" : "n/a"}; lipSync: ${mouth.lipSyncEnabled ?? "n/a"}`,
    `mouthSync observed: ${fmt(mouth.raw)}`,
    `computed clamp: ${fmt(mouth.computedClamped)}; contribution: ${fmt(mouth.computedContribution)}`,
    ...Object.entries(mouth.final).map(([id, value]) => `final ${id}: ${fmt(value)}`),
    `performance.now request / resolved: ${fmt(timing.requestedAtMs)} / ${fmt(timing.resolvedAtMs)} ms`,
    `observed audio start / positive contribution: ${fmt(timing.observedAudioStartAtMs)} / ${fmt(mouth.firstNonzeroMouthAtMs)} ms`,
    `observation delta: ${fmt(mouth.observedAudioToMouthMs)} ms (not speaker latency)`,
  ].join("\n");
}

export function updateSpeechButtons(buttons: { synthesize: HTMLButtonElement; play: HTMLButtonElement; stop: HTMLButtonElement; resume: HTMLButtonElement; file: HTMLInputElement }, snapshot: SpeechPanelSnapshot): void {
  const inputBusy = snapshot.inputStatus === "synthesizing" || snapshot.inputStatus === "loading-file";
  const nativeBusy = snapshot.pendingNativeLoad || snapshot.audio.isPlaying || snapshot.status === "loading" || snapshot.status === "suspended";
  buttons.play.disabled = snapshot.clip === null || !snapshot.hasModel || inputBusy || nativeBusy;
  buttons.synthesize.disabled = inputBusy || nativeBusy;
  buttons.file.disabled = nativeBusy;
  buttons.stop.disabled = !inputBusy && !nativeBusy;
  buttons.resume.disabled = snapshot.audio.contextState !== "suspended";
}

function fmt(value: number | null): string { return value !== null && Number.isFinite(value) ? value.toFixed(3) : "n/a"; }
