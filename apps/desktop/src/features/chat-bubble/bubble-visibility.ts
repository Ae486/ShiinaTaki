/**
 * INPUT:  explicit bubble opening and the document's actual visibility
 * OUTPUT: one subscribable visibility boundary for gated text and finite motion cleanup
 * POS:    ui/chat-bubble — observes UI state only; never opens a bubble, starts a timer or cancels execution
 */
import { useInteractionStore } from "@/stores/interaction-store.js";

export interface BubbleVisibilitySource {
  visible(): boolean;
  subscribe(changed: () => void): () => void;
}

export const bubbleVisibility: BubbleVisibilitySource = {
  visible: () => useInteractionStore.getState().bubbleOpen && (typeof document === "undefined" || !document.hidden),
  subscribe(changed) {
    const unsubscribe = useInteractionStore.subscribe((state, previous) => {
      if (state.bubbleOpen !== previous.bubbleOpen) changed();
    });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", changed);
    return () => {
      unsubscribe();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", changed);
    };
  },
};
