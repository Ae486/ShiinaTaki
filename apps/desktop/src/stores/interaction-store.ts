/**
 * INPUT:  drag lifecycle from use-pet-drag (dead-zone crossed → dragging true; pointer release / no-button → false);
 *         bubble open/close from use-chat-bubble.
 * OUTPUT: the shared `dragging` + `bubbleOpen` flags the click-through poll reads so a gesture or an open bubble
 *         keeps the window interactive (no drop-through mid-drag; the bubble input stays clickable).
 * POS:    ui/stores — the pet window's interaction store (click-through-affecting flags, one domain). The drag hook +
 *         the bubble hook write; the click-through hook reads. Separate from avatar-store per one-store-per-domain.
 */

import { create } from "zustand";

type InteractionStore = {
  dragging: boolean;
  bubbleOpen: boolean;
  setDragging: (dragging: boolean) => void;
  setBubbleOpen: (bubbleOpen: boolean) => void;
};

export const useInteractionStore = create<InteractionStore>()((set) => ({
  dragging: false,
  bubbleOpen: false,
  setDragging: (dragging) => set({ dragging }),
  setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
}));
