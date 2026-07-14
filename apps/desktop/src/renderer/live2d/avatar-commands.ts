/**
 * INPUT:  an AvatarCommand (core -> operator push) + a loaded model + its reported vocabulary.
 * OUTPUT: applyAvatarCommand(model, command, vocabulary) -> boolean; plays the expression/motion or no-ops gracefully.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/ws imports). Option A layer 3: an unknown name is logged and
 *         dropped (never throws), so a stale LLM name or a costume swap degrades instead of crashing a turn.
 */

import { MotionPriority, type Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarCommand } from "@taki/shared";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

const PRIORITY: Record<NonNullable<AvatarCommand["priority"]>, MotionPriority> = {
  idle: MotionPriority.IDLE,
  normal: MotionPriority.NORMAL,
  force: MotionPriority.FORCE,
};

export function applyAvatarCommand(model: Live2DModel, command: AvatarCommand, vocabulary: AvatarVocabulary): boolean {
  if (command.kind === "expression") {
    if (!vocabulary.expressions.includes(command.name)) return unknownName(command);
    void model.expression(command.name);
    return true;
  }
  if (!vocabulary.motions.includes(command.name)) return unknownName(command);
  const priority = PRIORITY[command.priority ?? "normal"];
  void model.motion(command.name, undefined, priority, { loop: command.loop ?? false });
  return true;
}

function unknownName(command: AvatarCommand): false {
  // Graceful degradation must leave a breadcrumb, not a crash (error-handling spec); the pet-stage bridge also console-logs.
  console.warn(`avatar: dropped ${command.kind} '${command.name}' (not in the loaded model's vocabulary)`);
  return false;
}
