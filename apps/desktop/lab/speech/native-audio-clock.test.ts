import { describe, expect, it } from "vitest";

import { nativeAudioClock } from "./native-audio-clock.ts";

const unavailable = (contextState: string | null) => ({ positionMs: null, source: null, contextState });

describe("native audio clock", () => {
  it("is unavailable without a single playing instance or a finite progress", () => {
    expect(nativeAudioClock({})).toEqual(unavailable(null));
    expect(nativeAudioClock({ currentAudio: { isPlaying: false, duration: 4, instances: [{ progress: 0.5 }] }, currentContext: { state: "running" } }))
      .toEqual(unavailable("running"));
    expect(nativeAudioClock({ currentAudio: { isPlaying: true, duration: 4, instances: [] } })).toEqual(unavailable(null));
    expect(nativeAudioClock({ currentAudio: { isPlaying: true, duration: 4, instances: [{ progress: 0.1 }, { progress: 0.2 }] } })).toEqual(unavailable(null));
    expect(nativeAudioClock({ currentAudio: { isPlaying: true, duration: 4, instances: [{ progress: Number.NaN }] } })).toEqual(unavailable(null));
    expect(nativeAudioClock({ currentAudio: { isPlaying: true, duration: Number.POSITIVE_INFINITY, instances: [{ progress: 0.5 }] } })).toEqual(unavailable(null));
  });

  it("converts progress into clip-relative milliseconds and passes the context state through", () => {
    expect(nativeAudioClock({ currentAudio: { isPlaying: true, duration: 4.5, instances: [{ progress: 0.2 }] }, currentContext: { state: "suspended" } }))
      .toEqual({ positionMs: 900, source: "pixi-sound-progress", contextState: "suspended" });
  });
});
