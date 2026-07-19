/**
 * INPUT:  a cursor point in canvas-local px (from the pet window's global-cursor poll) + the model, its center, vocab.
 * OUTPUT: createProximityReactor({model, center, vocabulary}) -> handleProximity(x, y): plays a one-shot NORMAL reaction
 *         when the cursor ENTERS the near zone, throttled by a cooldown and suppressed while a foreground motion plays.
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). UI-LOCAL, no LLM (agent-chosen expressions are
 *         Heartbeat, T4). Deterministic renderer reflex; reuses the emotion-resolver tag machinery (D17).
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";
import { resolveByTag } from "./emotion-resolver.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

// Enter radius: a close approach, deliberately smaller than the gaze reach (600px) — the pet reacts to a cursor coming
// in, not merely being on screen. Cooldown keeps it from spamming when the cursor lingers near (prd "never spams").
const NEAR_PX = 140;
const COOLDOWN_MS = 10_000;
// A light "noticed you" beat, tried in order and resolved against the LIVE vocabulary via the shared resolver.
const PROXIMITY_TAGS = ["surprised", "smile", "shy"];

interface ProximityModel {
  motion: Live2DModel["motion"];
  expression: Live2DModel["expression"];
  internalModel: { motionManager: { state: { currentPriority: MotionPriority } } };
}

export interface ProximityReactor {
  handleProximity: (x: number, y: number) => void;
}

export interface ProximityDeps {
  model: ProximityModel;
  center: { x: number; y: number };
  vocabulary: AvatarVocabulary;
  // Injected in tests to drive the cooldown deterministically (the reactor is poll-driven, not timer-driven).
  now?: () => number;
}

export function createProximityReactor(deps: ProximityDeps): ProximityReactor {
  const { model, center, vocabulary } = deps;
  const now = deps.now ?? (() => Date.now());
  let wasNear = false;
  let lastReactAt = Number.NEGATIVE_INFINITY;

  return {
    handleProximity(x, y) {
      const near = Math.hypot(x - center.x, y - center.y) <= NEAR_PX;
      if (!near) {
        wasNear = false;
        return;
      }
      if (wasNear) return; // fire only on ENTER; staying inside the zone does not re-fire
      wasNear = true;
      if (now() - lastReactAt < COOLDOWN_MS) return; // cooldown: a re-enter within the window is ignored
      if (model.internalModel.motionManager.state.currentPriority > MotionPriority.IDLE) return; // foreground busy
      if (react(model, vocabulary)) lastReactAt = now();
    },
  };
}

function react(model: ProximityModel, vocabulary: AvatarVocabulary): boolean {
  for (const tag of PROXIMITY_TAGS) {
    const expression = resolveByTag(tag, vocabulary.expressions);
    const motion = resolveByTag(tag, vocabulary.motions);
    if (expression === null && motion === null) continue;
    if (expression !== null) void model.expression(expression);
    // loop:false pins the one-shot — newer-game C3 motions ship Meta.Loop=true (the same gotcha click reactions hit).
    if (motion !== null) void model.motion(motion, undefined, MotionPriority.NORMAL, { loop: false });
    return true;
  }
  return false;
}
