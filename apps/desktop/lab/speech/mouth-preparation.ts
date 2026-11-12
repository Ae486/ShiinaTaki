/**
 * INPUT:  retained audio bytes decoded with the browser audio decoder.
 * OUTPUT: a measured envelope MouthTrack and separate decode/analysis timings for one exact clip.
 * POS:    experimental / lab - not in production path; offline decoding produces no second audio output.
 */

import { analyzeMouthEnvelope } from "../scene/mouth-envelope.ts";
import { createMouthTrack, type MouthTrack } from "../scene/mouth-track.ts";

export interface PreparedMouthClip {
  track: MouthTrack;
  decodeMs: number;
  envelopeMs: number;
  durationMs: number;
}

export async function prepareMouthClip(bytes: ArrayBuffer): Promise<PreparedMouthClip> {
  const start = performance.now();
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const audio = await decoder.decodeAudioData(bytes.slice(0));
  const decodeMs = performance.now() - start;
  const analyzeAt = performance.now();
  const envelope = analyzeMouthEnvelope({ pcm: mixChannels(audio), sampleRate: audio.sampleRate });
  const track = createMouthTrack({ durationMs: envelope.durationMs, source: "envelope", approximate: true,
    cues: envelope.frames.map((frame) => ({ startMs: frame.timeMs,
      endMs: Math.min(envelope.durationMs, frame.timeMs + envelope.frameMs),
      mouth: frame.closed || frame.value === 0 ? "rest" : "open", openness: frame.value, confidence: 1 })) });
  return { track, decodeMs, envelopeMs: performance.now() - analyzeAt, durationMs: audio.duration * 1000 };
}

function mixChannels(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const mono = new Float32Array(audio.length);
  for (let sample = 0; sample < mono.length; sample += 1) {
    // RMS energy downmix preserves antiphase stereo instead of cancelling speech to silence.
    let squared = 0;
    for (const channel of channels) squared += (channel[sample] ?? 0) ** 2;
    mono[sample] = Math.sqrt(squared / channels.length);
  }
  return mono;
}
