/**
 * INPUT:  one generation's authoritative activity view, gated presentation and initiating-request fallback
 * OUTPUT: disposable Pet reply source/display snapshots plus a lifecycle token for visual cleanup
 * POS:    ui/chat-bubble — presentation only; the interaction store owns opening and Core owns execution/history
 */

import { create } from "zustand";
import { activityMessageId, type ChatActivityView } from "@/lib/chat-activity-state.js";
import type { CommittedBubble } from "./bubble-committed-timeline.ts";

// Discriminated union (no boolean-flag combos, type-safety spec): the bubble is empty, streaming a reply, done, or failed.
export type BubbleReply =
  | { kind: "empty" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string; text?: string };

type ChatBubbleStore = {
  reply: BubbleReply;
  replyMessageId: string | null;
  legacyEpoch: number;
  activitySource: ChatActivityView | null;
  activity: ChatActivityView | null;
  presentationVersion: number;
  committed: CommittedBubble | null;
  observeCommitted: (committed: CommittedBubble) => void;
  clearCommitted: () => void;
  observeActivity: (view: ChatActivityView) => void;
  presentActivity: (view: ChatActivityView) => void;
  retirePresentation: () => void;
  identifyReply: (messageId: string) => void;
  clearReply: () => void;
  startReply: () => void;
  appendDelta: (delta: string) => void;
  finishReply: () => void;
  failReply: (message: string) => void;
  reset: () => void;
};

export const useChatBubbleStore = create<ChatBubbleStore>()((set) => ({
  reply: { kind: "empty" },
  replyMessageId: null, legacyEpoch: 0, activitySource: null, activity: null, presentationVersion: 0,
  committed: null,
  observeCommitted: (committed) => set({ committed }),
  clearCommitted: () => set({ committed: null }),
  observeActivity: (view) => set((state) => {
    // An empty new runtime projection cannot establish the outcome of the previously visible turn.
    if (view.snapshot.status === "idle" && state.activitySource && state.activitySource.snapshot.status !== "idle") {
      return { activitySource: { ...state.activitySource, stale: true } };
    }
    const changed = activityMessageId(view.snapshot) !== (state.activitySource && activityMessageId(state.activitySource.snapshot));
    return { activitySource: view, ...(changed ? { activity: null, presentationVersion: state.presentationVersion + 1,
      ...(view.snapshot.status === "active" ? { committed: null } : {}) } : {}) };
  }),
  presentActivity: (view) => set((state) => {
    if (state.activitySource !== view) return state;
    // Capacity is a recovery limitation, not an instruction to erase text that this view already received.
    if (view.snapshot.status === "unavailable" && state.activity
      && activityMessageId(state.activity.snapshot) === view.snapshot.messageId) return state;
    return { activity: view };
  }),
  retirePresentation: () => set((state) => ({ presentationVersion: state.presentationVersion + 1 })),
  identifyReply: (replyMessageId) => set({ replyMessageId }),
  clearReply: () => set({ reply: { kind: "empty" }, replyMessageId: null }),
  startReply: () => set((state) => ({ reply: { kind: "streaming", text: "" }, replyMessageId: null, committed: null, legacyEpoch: state.legacyEpoch + 1 })),
  appendDelta: (delta) =>
    set((state) =>
      state.reply.kind === "streaming" ? { reply: { kind: "streaming", text: state.reply.text + delta } } : state,
    ),
  finishReply: () =>
    set((state) => (state.reply.kind === "streaming" ? { reply: { kind: "done", text: state.reply.text } } : state)),
  failReply: (message) => set((state) => {
    const text = "text" in state.reply ? state.reply.text : undefined;
    return { reply: { kind: "error", message, ...(text ? { text } : {}) } };
  }),
  reset: () => set((state) => ({ reply: { kind: "empty" }, replyMessageId: null, activitySource: null, activity: null,
    committed: null, legacyEpoch: state.legacyEpoch + 1, presentationVersion: state.presentationVersion + 1 })),
}));
