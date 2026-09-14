/**
 * INPUT:  the engine-owned @pixi/sound audio instance and its AudioContext state.
 * OUTPUT: clip-relative audio position, or unavailable state while no single source is playing.
 * POS:    experimental / lab - not in production path; follows audio progress, never renderer wall time.
 */

export interface NativeClockManager {
  currentAudio?: { isPlaying: boolean; duration?: number; instances?: readonly { progress: number }[] };
  currentContext?: { state: string };
}

export interface MouthClockSnapshot {
  positionMs: number | null;
  source: "pixi-sound-progress" | null;
  contextState: string | null;
}

export function nativeAudioClock(manager: NativeClockManager): MouthClockSnapshot {
  const audio = manager.currentAudio;
  const contextState = manager.currentContext?.state ?? null;
  const duration = audio?.duration;
  const progress = audio?.instances?.length === 1 ? audio.instances[0]?.progress : undefined;
  if (!audio?.isPlaying || typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 ||
      typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    return { positionMs: null, source: null, contextState };
  }
  // @pixi/sound 6 derives instance.progress from AudioContext.currentTime in its shared ticker.
  // Suspension therefore freezes this position; resuming or replaying requires no wall-clock correction.
  return { positionMs: progress * duration * 1000, source: "pixi-sound-progress", contextState };
}
