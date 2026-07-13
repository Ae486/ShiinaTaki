/**
 * INPUT:  avatar lifecycle events dispatched from the UI (real WS-driven events arrive in #16).
 * OUTPUT: the current AvatarState mirrored for React display + a dispatch action running the pure FSM.
 * POS:    ui/stores — the pet window's own Zustand store (windows do not share JS memory). The renderer FSM is
 *         the source of truth for transitions; this store is the React-facing mirror.
 */

import { create } from "zustand";
import { nextAvatarState, type AvatarEvent, type AvatarState } from "@/renderer/state-machine.js";

type AvatarStore = {
  state: AvatarState;
  dispatch: (event: AvatarEvent) => void;
};

export const useAvatarStore = create<AvatarStore>()((set, get) => ({
  state: "idle",
  dispatch: (event) => set({ state: nextAvatarState(get().state, event) }),
}));
