/**
 * INPUT:  a cursor point in canvas-local px (fed from the pet window's global-cursor poll) + the model's on-screen center.
 * OUTPUT: createGazeFocuser({model, center}) -> focusAt(x, y); interpolated head/eye follow, reach-clamped + delta-gated.
 * POS:    ui/renderer/live2d — framework-free (ZERO React/Tauri imports). UI-LOCAL, no LLM. model.focus() takes
 *         world-space coords; we clamp the offset from the model center (the reference's relative approach, §1).
 */

import type { Live2DModel } from "untitled-pixi-live2d-engine";

export interface GazeOptions {
  // Clamp the gaze offset so an off-screen cursor doesn't peg the head to the edge (BANDORI reference ~600px).
  maxReachPx?: number;
  // Skip sub-threshold moves so tiny cursor jitter doesn't churn the focus target (min-delta gate).
  minDeltaPx?: number;
}

export interface GazeFocuser {
  focusAt: (x: number, y: number) => void;
}

export function createGazeFocuser(deps: { model: Live2DModel; center: { x: number; y: number }; options?: GazeOptions }): GazeFocuser {
  const { model, center } = deps;
  const maxReach = deps.options?.maxReachPx ?? 600;
  const minDeltaSq = (deps.options?.minDeltaPx ?? 3) ** 2;
  let lastX = center.x;
  let lastY = center.y;

  return {
    focusAt(x, y) {
      let dx = x - center.x;
      let dy = y - center.y;
      const distance = Math.hypot(dx, dy);
      if (distance > maxReach) {
        const scale = maxReach / distance;
        dx *= scale;
        dy *= scale;
      }
      const targetX = center.x + dx;
      const targetY = center.y + dy;
      if ((targetX - lastX) ** 2 + (targetY - lastY) ** 2 < minDeltaSq) return;
      lastX = targetX;
      lastY = targetY;
      model.focus(targetX, targetY);
    },
  };
}
