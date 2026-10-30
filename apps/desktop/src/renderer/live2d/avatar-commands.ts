/**
 * INPUT:  an AvatarCommand (core -> operator push) + a loaded model + its reported vocabulary + an optional drift sink.
 * OUTPUT: applyAvatarCommand({model, command, vocabulary, onVocabularyDrift?}) -> Promise<AvatarOutcomeReport>: the engine
 *         promise decides applied; a false is classified best-effort from state read BEFORE the call (motion_busy /
 *         speaking / already_active / superseded / unavailable); an unknown name reports unknown_name + fires
 *         onVocabularyDrift (self-heal re-report). NEVER throws or rejects.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/ws imports). Option A layer 3 + the D80 Presentation Outcome
 *         source; the engine's reserve()/currentAudio rules are the classification facts (spec live2d-renderer.md).
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarCommand, AvatarOutcomeParams } from "@taki/shared";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

const PRIORITY: Record<NonNullable<AvatarCommand["priority"]>, MotionPriority> = {
  idle: MotionPriority.IDLE,
  normal: MotionPriority.NORMAL,
  force: MotionPriority.FORCE,
};

export type AvatarOutcomeReport = Pick<AvatarOutcomeParams, "outcome" | "reason">;

export interface ApplyAvatarCommandInput {
  model: Live2DModel;
  command: AvatarCommand;
  vocabulary: AvatarVocabulary;
  // Fired when the command names something the worn costume lacks: the caller re-reports the live vocabulary so a
  // stale LLM name self-heals into a corrective report instead of being silently dropped every turn (1b).
  onVocabularyDrift?: () => void;
}

// Per-model, per-kind sequence of the latest command issued: a false that lands after a newer same-kind command
// started is a same-channel replacement (the engine's reserve slot moved on), not a rejection.
const latest = new WeakMap<Live2DModel, Record<AvatarCommand["kind"], number>>();

function nextSequence(model: Live2DModel, kind: AvatarCommand["kind"]): { mine: number; isLatest: () => boolean } {
  const counters = latest.get(model) ?? { expression: 0, motion: 0 };
  latest.set(model, counters);
  const mine = ++counters[kind];
  return { mine, isLatest: () => counters[kind] === mine };
}

export async function applyAvatarCommand(input: ApplyAvatarCommandInput): Promise<AvatarOutcomeReport> {
  const { model, command, vocabulary, onVocabularyDrift } = input;
  const known = command.kind === "expression" ? vocabulary.expressions : vocabulary.motions;
  if (!known.includes(command.name)) return unknownName(command, onVocabularyDrift);
  try {
    return command.kind === "expression" ? await applyExpression(model, command) : await applyMotion(model, command);
  } catch (error) {
    console.warn(`avatar: ${command.kind} '${command.name}' threw`, error);
    return { outcome: "rejected", reason: "unavailable" };
  }
}

async function applyExpression(model: Live2DModel, command: AvatarCommand): Promise<AvatarOutcomeReport> {
  const manager = model.internalModel.motionManager.expressionManager;
  const current = manager ? manager.expressions.indexOf(manager.currentExpression) : -1;
  const target = manager?.getExpressionIndex(command.name) ?? -1;
  const sequence = nextSequence(model, "expression");
  if (await model.expression(command.name)) return { outcome: "applied" };
  // The engine refuses a re-select of the current expression before it touches the reserve slot, so that rule is
  // checked first; a false after a newer expression reserved is the same-channel replacement seen in the Lab.
  if (target >= 0 && target === current) return { outcome: "rejected", reason: "already_active" };
  if (!sequence.isLatest()) return { outcome: "superseded" };
  return { outcome: "rejected", reason: "unavailable" };
}

async function applyMotion(model: Live2DModel, command: AvatarCommand): Promise<AvatarOutcomeReport> {
  const priority = PRIORITY[command.priority ?? "normal"];
  const manager = model.internalModel.motionManager;
  const { currentPriority, reservePriority } = manager.state;
  // Mirrors the engine: reserve() refuses a non-FORCE priority at or below the playing/reserved one, and a playing
  // motion sound refuses everything but FORCE.
  const busy = priority !== MotionPriority.FORCE && (priority <= currentPriority || priority <= reservePriority);
  const speaking = priority !== MotionPriority.FORCE && manager.currentAudio?.isPlaying === true;
  const sequence = nextSequence(model, "motion");
  if (await model.motion(command.name, undefined, priority, { loop: command.loop ?? false })) return { outcome: "applied" };
  if (speaking) return { outcome: "rejected", reason: "speaking" };
  if (busy) return { outcome: "rejected", reason: "motion_busy" };
  if (!sequence.isLatest()) return { outcome: "superseded" };
  return { outcome: "rejected", reason: "unavailable" };
}

function unknownName(command: AvatarCommand, onVocabularyDrift?: () => void): AvatarOutcomeReport {
  // Graceful degradation must leave a breadcrumb, not a crash (error-handling spec); the pet-stage bridge also console-logs.
  console.warn(`avatar: dropped ${command.kind} '${command.name}' (not in the loaded model's vocabulary)`);
  onVocabularyDrift?.();
  return { outcome: "rejected", reason: "unknown_name" };
}
