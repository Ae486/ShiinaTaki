import { describe, expect, it, vi } from "vitest";

import { createFrameHooks, type FrameEmitter } from "./frame-hooks.ts";
import { createParamAccess, type ParamAccess } from "./param-access.ts";
import { getMouthProfile } from "./mouth-profile.ts";
import { createMouthTrack } from "./mouth-track.ts";
import { createMouthWriter } from "./mouth-writer.ts";

function emitter(): { emitter: FrameEmitter; fire: (event: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  const emitter: FrameEmitter = {
    on(event, fn) { const set = listeners.get(event) ?? new Set<() => void>(); set.add(fn); listeners.set(event, set); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
  };
  return { emitter, fire: (event) => { for (const fn of listeners.get(event) ?? []) fn(); } };
}

function fakeParams(ids: string[]): { params: ParamAccess; values: Map<string, number> } {
  const values = new Map(ids.map((id) => [id, 0]));
  const core = {
    setParamFloat(id: string, value: number) { values.set(id, value); },
    addToParamFloat() {},
    multParamFloat() {},
    getParamFloat(id: string) { return values.get(id) ?? Number.NaN; },
    getParamIndex(id: string) { return ids.indexOf(id); },
  };
  return { params: createParamAccess({ coreModel: core }), values };
}

describe("mouth writer", () => {
  it("writes only declared profile ids with set and returns to rest after the track", () => {
    const { emitter: source, fire } = emitter();
    const profile = getMouthProfile("arbeit");
    if (profile === null) throw new Error("arbeit profile missing");
    const formId = profile.ids.form;
    if (formId === undefined) throw new Error("arbeit form id missing");
    const { params, values } = fakeParams([profile.ids.open, formId]);
    const hooks = createFrameHooks(source, params, () => 100);
    const set = vi.spyOn(params, "set");
    const track = createMouthTrack({ durationMs: 200, source: "text-heuristic", approximate: true,
      cues: [{ startMs: 0, endMs: 150, mouth: "wide", openness: 1, confidence: 1 }] });
    const writer = createMouthWriter({ hooks, params, profile, track, clock: () => 50 });
    fire("beforeMotionUpdate");
    fire("beforeModelUpdate");
    expect(values.get(profile.ids.open)).toBeCloseTo(0.9);
    expect(set.mock.calls.every((call) => call[0] !== "ParamMouthForm")).toBe(true);
    writer.setTrack(track, () => 250);
    expect(values.get(profile.ids.open)).toBe(0);
    expect(values.get(formId)).toBe(0);
    expect(writer.snapshot().active).toBe(false);
    writer.dispose();
    hooks.dispose();
  });

  it("degrades an unknown low-confidence cue to a conservative opening", () => {
    const { emitter: source, fire } = emitter();
    const profile = getMouthProfile("live_01");
    if (profile === null) throw new Error("live profile missing");
    const { params, values } = fakeParams([profile.ids.open]);
    const hooks = createFrameHooks(source, params, () => 0);
    const writer = createMouthWriter({ hooks, params, profile,
      track: createMouthTrack({ durationMs: 100, source: "acoustic", approximate: true,
        cues: [{ startMs: 0, endMs: 100, mouth: "unknown", openness: 1, confidence: 0 }] }), clock: () => 20 });
    fire("beforeMotionUpdate");
    fire("beforeModelUpdate");
    expect(values.get(profile.ids.open)).toBeCloseTo(0.72 * 0.35);
    expect(writer.snapshot().fallback).toBe(true);
    writer.detach();
    expect(writer.snapshot().enabled).toBe(false);
    hooks.dispose();
  });
});
