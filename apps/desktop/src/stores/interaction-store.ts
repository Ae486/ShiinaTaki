/**
 * INPUT:  drag lifecycle from use-pet-drag (dead-zone crossed → dragging true; pointer release / no-button → false).
 * OUTPUT: the shared `dragging` flag the click-through poll reads so a drag never drops through mid-gesture.
 * POS:    ui/stores — the pet window's interaction store (one flag, one domain). Separate from avatar-store per
 *         one-store-per-domain; both the drag hook (writer) and the click-through hook (reader) subscribe.
 */

import { create } from "zustand";

type InteractionStore = {
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
};

export const useInteractionStore = create<InteractionStore>()((set) => ({
  dragging: false,
  setDragging: (dragging) => set({ dragging }),
}));
