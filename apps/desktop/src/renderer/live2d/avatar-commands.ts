/**
 * INPUT:  an AvatarCommand (core -> operator push) + a loaded model + its reported vocabulary + an optional drift sink.
 * OUTPUT: applyAvatarCommand({model, command, vocabulary, onVocabularyDrift?}) -> boolean; plays the expression/motion,
 *         or on an unknown name logs + fires onVocabularyDrift (self-heal re-report) + returns false — never throws.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/ws imports). Option A layer 3: an unknown name is logged and
 *         dropped (never throws); the drift sink turns that miss into a corrective re-report of the live vocabulary (1b).
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarCommand } from "@taki/shared";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

const PRIORITY: Record<NonNullable<AvatarCommand["priority"]>, MotionPriority> = {
  idle: MotionPriority.IDLE,
  normal: MotionPriority.NORMAL,
  force: MotionPriority.FORCE,
};

export interface ApplyAvatarCommandInput {
  model: Live2DModel;
  command: AvatarCommand;
  vocabulary: AvatarVocabulary;
  // Fired when the command names something the worn costume lacks: the caller re-reports the live vocabulary so a
  // stale LLM name self-heals into a corrective report instead of being silently dropped every turn (1b).
  onVocabularyDrift?: () => void;
}

export function applyAvatarCommand(input: ApplyAvatarCommandInput): boolean {
  const { model, command, vocabulary, onVocabularyDrift } = input;
  if (command.kind === "expression") {
    if (!vocabulary.expressions.includes(command.name)) return unknownName(command, onVocabularyDrift);
    void model.expression(command.name);
    return true;
  }
  if (!vocabulary.motions.includes(command.name)) return unknownName(command, onVocabularyDrift);
  const priority = PRIORITY[command.priority ?? "normal"];
  void model.motion(command.name, undefined, priority, { loop: command.loop ?? false });
  return true;
}

function unknownName(command: AvatarCommand, onVocabularyDrift?: () => void): false {
  // Graceful degradation must leave a breadcrumb, not a crash (error-handling spec); the pet-stage bridge also console-logs.
  console.warn(`avatar: dropped ${command.kind} '${command.name}' (not in the loaded model's vocabulary)`);
  onVocabularyDrift?.();
  return false;
}
