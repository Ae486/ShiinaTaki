/**
 * INPUT:  drag lifecycle from use-pet-drag (dead-zone crossed → dragging true; pointer release / no-button → false);
 *         bubble open/close from use-chat-bubble; character-panel open/close from pet-stage.
 * OUTPUT: the shared `dragging` + `bubbleOpen` + `panelOpen` flags the click-through poll reads so a gesture, an open
 *         bubble, or the open operator panel keeps the window interactive (no drop-through; inputs stay clickable).
 * POS:    ui/stores — the pet window's interaction store (click-through-affecting flags, one domain). The drag hook +
 *         the bubble hook write; the click-through hook reads. Separate from avatar-store per one-store-per-domain.
 */

import { create } from "zustand";

type InteractionStore = {
  dragging: boolean;
  bubbleOpen: boolean;
  panelOpen: boolean;
  setDragging: (dragging: boolean) => void;
  setBubbleOpen: (bubbleOpen: boolean) => void;
  setPanelOpen: (panelOpen: boolean) => void;
};

export const useInteractionStore = create<InteractionStore>()((set) => ({
  dragging: false,
  bubbleOpen: false,
  panelOpen: false,
  setDragging: (dragging) => set({ dragging }),
  setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));
