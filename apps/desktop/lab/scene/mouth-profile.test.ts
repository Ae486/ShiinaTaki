import { describe, expect, it } from "vitest";

import { getMouthProfile, hasMouthParameter, mapMouthSample, mouthPoseWrites } from "./mouth-profile.ts";

const sample = (mouth: Parameters<typeof mapMouthSample>[1]["mouth"], openness = 1): Parameters<typeof mapMouthSample>[1] => ({
  mouth,
  openness,
  confidence: 0.9,
  active: mouth !== "rest",
});

describe("measured mouth profiles", () => {
  it("exposes distinct C2/C3 ids and measured ranges", () => {
    const c2 = getMouthProfile("arbeit");
    const c3 = getMouthProfile("live_01");
    expect(c2?.generation).toBe("cubism2");
    expect(c2?.ids.form).toBe("PARAM_MOUTH_FORM_01");
    expect(c2?.ranges.PARAM_MOUTH_FORM_01).toEqual({ min: -0.5, max: 1 });
    expect(c3?.generation).toBe("cubism3");
    expect(c3?.ids.form).toBe("ParamMouthForm");
    expect(c3?.ranges.ParamMouthForm).toEqual({ min: -1, max: 1 });
  });

  it("refuses the C3 form id on C2 and does not claim phantom support", () => {
    const c2 = getMouthProfile("arbeit");
    if (c2 === null) throw new Error("C2 profile missing");
    expect(hasMouthParameter(c2, "ParamMouthForm")).toBe(false);
    expect(hasMouthParameter(c2, c2.ids.form ?? "")).toBe(true);
  });

  it("maps supported poses to clamped writes and degrades unknown classes", () => {
    const c2 = getMouthProfile("arbeit");
    const c3 = getMouthProfile("live_01");
    if (c2 === null || c3 === null) throw new Error("measured profiles missing");
    const c2Pose = mapMouthSample(c2, sample("rounded", 1));
    expect(c2Pose.supported).toBe(true);
    expect(c2Pose.pose.width).toBe(-0.65);
    expect(mouthPoseWrites(c2, c2Pose).some((write) => write.id === "ParamMouthForm")).toBe(false);
    const unknown = mapMouthSample(c3, sample("unknown", 1));
    expect(unknown.resolved).toBe("rest");
    expect(unknown.pose.open).toBe(0);
  });
});
