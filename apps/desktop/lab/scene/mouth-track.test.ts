import { describe, expect, it } from "vitest";

import { createMouthTrack, interpolateMouthCues, sampleMouthTrack, validateMouthTrack, type MouthCue } from "./mouth-track.ts";

const cue = (startMs: number, endMs: number, details: Pick<MouthCue, "mouth" | "openness">): MouthCue => ({
  startMs,
  endMs,
  ...details,
  confidence: 0.8,
});

describe("mouth track", () => {
  it("sorts cues and samples gaps as rest", () => {
    const track = createMouthTrack({ durationMs: 300, source: "text-heuristic", approximate: true, cues: [cue(150, 250, { mouth: "rounded", openness: 0.6 }), cue(0, 80, { mouth: "open", openness: 1 })] });
    expect(track.cues.map((entry) => entry.startMs)).toEqual([0, 150]);
    expect(sampleMouthTrack(track, 40).mouth).toBe("open");
    expect(sampleMouthTrack(track, 100).mouth).toBe("rest");
    expect(sampleMouthTrack(track, 290).active).toBe(false);
  });

  it("interpolates openness and selects the incoming class halfway through an overlap", () => {
    const first = cue(0, 100, { mouth: "open", openness: 0.2 });
    const second = cue(0, 100, { mouth: "spread", openness: 0.8 });
    const sample = interpolateMouthCues(first, second, 0.75);
    expect(sample.mouth).toBe("spread");
    expect(sample.openness).toBeCloseTo(0.65);
  });

  it("reports invalid ordering and bounds without mutating the track", () => {
    const track = { durationMs: 100, source: "envelope" as const, approximate: false, cues: [cue(50, 40, { mouth: "open", openness: 0.5 }), cue(-2, 110, { mouth: "open", openness: 1.2 })] };
    const result = validateMouthTrack(track);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
    expect(track.cues[0]?.startMs).toBe(50);
  });
});
