/**
 * INPUT:  a fake model capturing focus() calls; cursor points relative to the model center.
 * OUTPUT: assertions that the offset is reach-clamped and that sub-delta moves are gated out.
 * POS:    unit test for gaze follow (F4). Type-only engine import ⇒ node-safe. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { createGazeFocuser } from "./gaze.ts";

function fakeModel() {
  const focus = vi.fn();
  return { model: { focus } as unknown as Live2DModel, focus };
}

describe("createGazeFocuser", () => {
  it("clamps the gaze offset to maxReach around the model center", () => {
    const { model, focus } = fakeModel();
    const gaze = createGazeFocuser({ model, center: { x: 100, y: 100 }, options: { maxReachPx: 10, minDeltaPx: 0 } });
    gaze.focusAt(1000, 100); // far to the right → clamped to +10px on x
    expect(focus).toHaveBeenCalledWith(110, 100);
  });

  it("skips sub-threshold moves so cursor jitter does not churn the focus target", () => {
    const { model, focus } = fakeModel();
    const gaze = createGazeFocuser({ model, center: { x: 0, y: 0 }, options: { minDeltaPx: 50 } });
    gaze.focusAt(5, 5); // within 50px of the last target (center) → gated
    expect(focus).not.toHaveBeenCalled();
  });
});
