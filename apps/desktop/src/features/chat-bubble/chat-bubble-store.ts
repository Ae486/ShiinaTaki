/**
 * INPUT:  bubble reply lifecycle from use-chat-bubble (start on send; delta/complete/error from the WS chat stream).
 * OUTPUT: the streamed reply state (discriminated union) + reducers the hook drives; components read via the hook.
 * POS:    ui/stores (feature-local) — the chat bubble's reply content domain. The interaction store owns the
 *         click-through-affecting `bubbleOpen` flag; this store owns only what text is shown. Streaming appends here
 *         (never per-token component setState — re-render storm; hook-guidelines).
 */

import { create } from "zustand";

// Discriminated union (no boolean-flag combos, type-safety spec): the bubble is empty, streaming a reply, done, or failed.
export type BubbleReply =
  | { kind: "empty" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string };

type ChatBubbleStore = {
  reply: BubbleReply;
  startReply: () => void;
  appendDelta: (delta: string) => void;
  finishReply: () => void;
  failReply: (message: string) => void;
  reset: () => void;
};

export const useChatBubbleStore = create<ChatBubbleStore>()((set) => ({
  reply: { kind: "empty" },
  startReply: () => set({ reply: { kind: "streaming", text: "" } }),
  appendDelta: (delta) =>
    set((state) =>
      state.reply.kind === "streaming" ? { reply: { kind: "streaming", text: state.reply.text + delta } } : state,
    ),
  finishReply: () =>
    set((state) => (state.reply.kind === "streaming" ? { reply: { kind: "done", text: state.reply.text } } : state)),
  failReply: (message) => set({ reply: { kind: "error", message } }),
  reset: () => set({ reply: { kind: "empty" } }),
}));
