/**
 * INPUT:  a loaded Live2DModel.
 * OUTPUT: starts the model's idle motion group on a loop (breath/body drift) so the pet visibly idles; degrades
 *         to a structured warning if the manifest defines no idle motions (never throws).
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). Blink runs via the engine's eyeBlink effect;
 *         this drives the looping idle body motion the spike found does not start on its own.
 */

import { Live2DModel, MotionPriority } from "untitled-pixi-live2d-engine";

export type IdleResult = { started: boolean; detail: string };

export async function startIdleAnimation(model: Live2DModel): Promise<IdleResult> {
  const group = model.internalModel.motionManager.groups.idle;
  const hasGroup = Boolean(group) && Boolean(model.internalModel.motionManager.definitions[group]?.length);
  if (!hasGroup) {
    return { started: false, detail: `no idle motion group in manifest (groups.idle="${group}")` };
  }
  try {
    const started = await model.motion(group, 0, MotionPriority.IDLE, { loop: true });
    return { started, detail: `idle motion '${group}' loop -> ${String(started)}` };
  } catch (error) {
    return { started: false, detail: `idle motion threw: ${String(error)}` };
  }
}
