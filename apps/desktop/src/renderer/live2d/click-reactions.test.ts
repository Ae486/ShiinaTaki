/**
 * INPUT:  clicks at canvas-local px over a stub model (fixed width/height/center) + a vocabulary and preset.
 * OUTPUT: assertions that a click normalizes into the right region and plays its resolved reaction, and that a click
 *         outside the model bounds returns null and plays nothing (the untested normalization + bounds math).
 * POS:    unit test for the click-reaction applier (F4). Engine mocked so its runtime enum loads in node. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("untitled-pixi-live2d-engine", () => ({
  MotionPriority: { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 },
}));

import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { reactToClick } from "./click-reactions.ts";
import type { ClickPreset } from "./click-presets.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

const VOCAB: AvatarVocabulary = { motions: ["angry01"], expressions: ["angry01", "shame01"] };
// Region → tag; head resolves to angry (present in both), body-center to shame (expression only).
const PRESET = { head: "angry", upper_body_center: "shy" } as unknown as ClickPreset;

// 200×400 model centered at (100, 200) ⇒ bounds x:[0,200] y:[0,400]; a point maps to (nx,ny)=(x/200, y/400).
function stubModel() {
  const expression = vi.fn();
  const motion = vi.fn();
  return { model: { width: 200, height: 400, expression, motion } as unknown as Live2DModel, expression, motion };
}
const CENTER = { x: 100, y: 200 };

describe("reactToClick", () => {
  it("buckets a head click and plays the resolved reaction", () => {
    const { model, expression, motion } = stubModel();
    // y=40 ⇒ ny=0.1 (< 0.38) ⇒ head; tag "angry" resolves to angry01 in both expr + motion.
    expect(reactToClick({ model, center: CENTER, vocabulary: VOCAB, preset: PRESET, point: { x: 100, y: 40 } })).toBe("head");
    expect(expression).toHaveBeenCalledWith("angry01");
    // loop:false pins the one-shot override — newer-game C3 motions ship Meta.Loop=true (B-test round 3).
    expect(motion).toHaveBeenCalledWith("angry01", undefined, 2, { loop: false });
  });

  it("plays only what resolves (shy→shame01 expression; no matching motion)", () => {
    const { model, expression, motion } = stubModel();
    // x=100,y=200 ⇒ (0.5, 0.5) ⇒ upper_body_center; "shy" → shame01 exists as expression, not as a motion.
    expect(reactToClick({ model, center: CENTER, vocabulary: VOCAB, preset: PRESET, point: { x: 100, y: 200 } })).toBe("upper_body_center");
    expect(expression).toHaveBeenCalledWith("shame01");
    expect(motion).not.toHaveBeenCalled();
  });

  it("returns null and plays nothing for a click outside the model bounds", () => {
    const { model, expression, motion } = stubModel();
    expect(reactToClick({ model, center: CENTER, vocabulary: VOCAB, preset: PRESET, point: { x: 500, y: 40 } })).toBeNull();
    expect(expression).not.toHaveBeenCalled();
    expect(motion).not.toHaveBeenCalled();
  });

  it("returns null when the model has no measurable bounds", () => {
    const expression = vi.fn();
    const model = { width: 0, height: 0, expression, motion: vi.fn() } as unknown as Live2DModel;
    expect(reactToClick({ model, center: CENTER, vocabulary: VOCAB, preset: PRESET, point: { x: 100, y: 40 } })).toBeNull();
    expect(expression).not.toHaveBeenCalled();
  });
});
