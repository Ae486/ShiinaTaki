/**
 * INPUT:  the native speech panel's observed state and computed lip-sync contribution.
 * OUTPUT: compact labeled readout and command availability, with unavailable values rendered as n/a.
 * POS:    experimental / lab — not in production path; measured final parameters remain separate from estimates.
 */

import { MOUTH_ARMS, type MouthArmRangesSnapshot } from "../scene/mouth-arm-ranges.ts";
import type { CustomMouthSnapshot } from "../scene/mouth-control.ts";
import type { NativeArmSnapshot, SpeechPanelSnapshot } from "./speech-actions.ts";

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
    nativeArmLine(snapshot.nativeArm),
    ...customLines(snapshot.custom),
    ...rangeLines(snapshot.ranges),
  ].join("\n");
}

function nativeArmLine(arm: NativeArmSnapshot): string {
  const source = arm.mode === "native" ? "engine defaults" : "sliders";
  return `native arm: gain ${fmt(arm.gain)} / weight ${fmt(arm.weight)} (${source}); sliders ${arm.slidersLive ? "live" : "locked"}`;
}

/** One line per observed id with all three arms side by side, so amplitude caps read next to algorithm differences. */
function rangeLines(ranges: MouthArmRangesSnapshot): string[] {
  const ids = [...new Set(MOUTH_ARMS.flatMap((arm) => Object.keys(ranges[arm] ?? {})))];
  if (ids.length === 0) return ["mouth ranges: n/a"];
  return ids.map((id) => `range ${id}: ${MOUTH_ARMS.map((arm) => {
    const stat = ranges[arm]?.[id];
    return `${arm} ${stat === undefined ? "n/a" : `${fmt(stat.min)}..${fmt(stat.max)} (${stat.frames}f)`}`;
  }).join(" | ")}`);
}

function customLines(custom: CustomMouthSnapshot): string[] {
  const { preparation, clock, writer } = custom;
  const timings = preparation.status === "ready"
    ? ` (decode ${fmt(preparation.decodeMs)} ms, analysis ${fmt(preparation.envelopeMs)} ms, ${fmt(preparation.durationMs)} ms clip)` : "";
  return [
    `mouth mode: ${custom.mode} (effective ${custom.effectiveMode}); profile: ${custom.profileId ?? "none"}`,
    ...(custom.fallbackReason === null ? [] : [`fallback: ${custom.fallbackReason}`]),
    `envelope: ${preparation.status}${timings}`,
    `audio clock: ${fmt(clock.positionMs)} ms (${clock.source ?? "n/a"})`,
    `custom writer: ${writer === null || !writer.enabled ? "detached" : writerLine(writer)}`,
  ];
}

function writerLine(writer: NonNullable<CustomMouthSnapshot["writer"]>): string {
  const writes = writer.writes.map((write) => `${write.id}=${fmt(write.value)}`).join(", ");
  return `${writer.active ? "active" : "rest"}; ${writes || "no writes"}${writer.skippedIds.length === 0 ? "" : `; skipped ${writer.skippedIds.join(", ")}`}`;
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
