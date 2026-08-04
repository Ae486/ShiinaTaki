/**
 * INPUT:  drag lifecycle from use-pet-drag (dead-zone crossed → dragging true; pointer release / no-button → false);
 *         bubble open/close from use-chat-bubble; operation-wheel open/close from pet-stage.
 * OUTPUT: the shared `dragging` + `bubbleOpen` flags the click-through poll reads so a gesture or an open bubble keeps
 *         the window interactive (no drop-through; inputs stay clickable), plus `wheelOpen` + its summon point, which
 *         drive the operation wheel's placement.
 * POS:    ui/stores — the pet window's interaction store (click-through-affecting flags, one domain). The drag hook +
 *         the bubble hook write; the click-through hook reads. Separate from avatar-store per one-store-per-domain.
 */

import { create } from "zustand";
import type { WheelPoint } from "@/features/operation-wheel/wheel-placement.js";

type InteractionStore = {
  dragging: boolean;
  bubbleOpen: boolean;
  wheelOpen: boolean;
  wheelPoint: WheelPoint;
  setDragging: (dragging: boolean) => void;
  setBubbleOpen: (bubbleOpen: boolean) => void;
  openWheel: (point: WheelPoint) => void;
  closeWheel: () => void;
};

export const useInteractionStore = create<InteractionStore>()((set) => ({
  dragging: false,
  bubbleOpen: false,
  wheelOpen: false,
  wheelPoint: { x: 0, y: 0 },
  setDragging: (dragging) => set({ dragging }),
  setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
  // A second right-click re-summons at the new point (not a toggle) — openWheel always sets both fields.
  openWheel: (wheelPoint) => set({ wheelOpen: true, wheelPoint }),
  closeWheel: () => set({ wheelOpen: false }),
}));
