/**
 * INPUT:  a fake model (expression/motion sinks + currentPriority) + a controllable clock, cursor points near/far.
 * OUTPUT: assertions that a proximity reaction fires once on ENTER of the near zone, does not re-fire while inside,
 *         respects the cooldown on re-entry, re-fires after it, and is suppressed while a foreground motion plays (D17).
 * POS:    unit test for the framework-free proximity reactor. Engine mocked so MotionPriority loads in node. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("untitled-pixi-live2d-engine", () => ({
  MotionPriority: { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 },
}));

import { createProximityReactor, type ProximityDeps } from "./proximity-reaction.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

// "surprised" → synonyms {amazed}: boundary-matches exp_amazed01 (expression) + mtn_amazed01_C (motion).
const VOCAB: AvatarVocabulary = { motions: ["mtn_amazed01_C"], expressions: ["exp_amazed01"] };
const CENTER = { x: 100, y: 100 };

function fakeModel(priority = 0) {
  const motion = vi.fn();
  const expression = vi.fn();
  const model = { motion, expression, internalModel: { motionManager: { state: { currentPriority: priority } } } };
  return { model: model as unknown as ProximityDeps["model"], motion, expression };
}

describe("createProximityReactor", () => {
  it("fires one NORMAL one-shot reaction (expression + motion) when the cursor enters the near zone", () => {
    const { model, motion, expression } = fakeModel();
    const reactor = createProximityReactor({ model, center: CENTER, vocabulary: VOCAB, now: () => 0 });
    reactor.handleProximity(100, 100); // distance 0 <= NEAR_PX
    expect(expression).toHaveBeenCalledWith("exp_amazed01");
    expect(motion).toHaveBeenCalledWith("mtn_amazed01_C", undefined, 2, { loop: false }); // NORMAL, one-shot
  });

  it("does not re-fire while the cursor stays inside the zone", () => {
    const { model, motion } = fakeModel();
    const reactor = createProximityReactor({ model, center: CENTER, vocabulary: VOCAB, now: () => 0 });
    reactor.handleProximity(100, 100); // enter → fire
    reactor.handleProximity(105, 105); // still inside
    reactor.handleProximity(110, 110); // still inside
    expect(motion).toHaveBeenCalledTimes(1);
  });

  it("ignores a re-entry that happens before the cooldown elapses", () => {
    const clock = { t: 0 };
    const { model, motion } = fakeModel();
    const reactor = createProximityReactor({ model, center: CENTER, vocabulary: VOCAB, now: () => clock.t });
    reactor.handleProximity(100, 100); // fire at t=0
    reactor.handleProximity(400, 400); // leave (distance ~424 > NEAR_PX)
    clock.t = 5_000; // < COOLDOWN
    reactor.handleProximity(100, 100); // re-enter too soon
    expect(motion).toHaveBeenCalledTimes(1);
  });

  it("re-fires on a re-entry after the cooldown elapses", () => {
    const clock = { t: 0 };
    const { model, motion } = fakeModel();
    const reactor = createProximityReactor({ model, center: CENTER, vocabulary: VOCAB, now: () => clock.t });
    reactor.handleProximity(100, 100); // fire at t=0
    reactor.handleProximity(400, 400); // leave
    clock.t = 11_000; // > COOLDOWN
    reactor.handleProximity(100, 100); // re-enter after cooldown
    expect(motion).toHaveBeenCalledTimes(2);
  });

  it("is suppressed while a foreground motion is playing (currentPriority > IDLE)", () => {
    const { model, motion, expression } = fakeModel(2); // NORMAL foreground
    const reactor = createProximityReactor({ model, center: CENTER, vocabulary: VOCAB, now: () => 0 });
    reactor.handleProximity(100, 100);
    expect(motion).not.toHaveBeenCalled();
    expect(expression).not.toHaveBeenCalled();
  });
});
