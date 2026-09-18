import { describe, expect, it } from "vitest";

import { applyModelView, MODEL_VIEWS, modelViewTransform } from "./model-view.ts";

const screen = { width: 800, height: 1000 };

describe("model view transform", () => {
  it("reproduces the production centred 90 % fit for the full view", () => {
    expect(modelViewTransform("full", screen, 3000)).toEqual({ scale: 0.3, x: 400, y: 500 });
    expect(MODEL_VIEWS).toEqual(["full", "face"]);
  });

  it("magnifies the fit and moves the model down so the upper face region lands at screen centre", () => {
    const face = modelViewTransform("face", screen, 3000);
    expect(face.scale).toBeCloseTo(0.72);
    expect(face.x).toBe(400);
    // The point 22 % from the model top sits (0.5 - 0.22) * height * scale above the anchored centre.
    expect(face.y).toBeCloseTo(500 + 0.28 * 3000 * 0.72);
  });
});

describe("applyModelView", () => {
  function fakeModel(height: number, scale: number) {
    const model = { height, scale: { x: scale, y: scale, set(value: number) { model.scale.x = value; model.scale.y = value; } },
      position: { x: 0, y: 0, set(x: number, y: number) { model.position.x = x; model.position.y = y; } },
      anchor: { value: 0, set(value: number) { model.anchor.value = value; } } };
    return model;
  }

  it("derives the unscaled height from the current scale and writes anchor, position and scale", () => {
    const model = fakeModel(900, 0.3);
    expect(applyModelView(model, "full", screen)).toEqual({ scale: 0.3, x: 400, y: 500 });
    expect(model.anchor.value).toBe(0.5);
    expect(model.scale.y).toBeCloseTo(0.3);
    const face = applyModelView(model, "face", screen);
    expect(face?.scale).toBeCloseTo(0.72);
    expect(model.position.y).toBeCloseTo(500 + 0.28 * 3000 * 0.72);
  });

  it("leaves a model with unusable geometry untouched", () => {
    const model = fakeModel(0, 0);
    expect(applyModelView(model, "face", screen)).toBeNull();
    expect(model.anchor.value).toBe(0);
  });
});
