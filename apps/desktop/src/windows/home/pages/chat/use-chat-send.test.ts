import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHandlers } from "@/lib/ws-client.js";
import { cancelChatSend, runChatSend, type ChatSendTicket } from "./use-chat-send.ts";
import { useChatTimelineStore } from "./chat-timeline-store.ts";
import { resetDeltaCoalescerForTests } from "./chat-delta-coalescer.ts";

function fixture() {
  let current = true;
  let handlers: ChatHandlers | undefined;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const ticket: ChatSendTicket = { client: {
    chat: vi.fn(async (_params, next) => { handlers = next; await done; }),
    chatCancel: vi.fn(async () => true),
  }, current: () => current, cancelRequested: false, cancelling: false };
  return { ticket, finish, retire: () => { current = false; }, handlers: () => {
    if (!handlers) throw new Error("send did not begin"); return handlers;
  } };
}

beforeEach(() => { useChatTimelineStore.getState().reset(); resetDeltaCoalescerForTests(); });

describe("Chat initiating request identity", () => {
  it("binds an early explicit cancel to the acknowledged Run instead of cancelling another sender's active turn", async () => {
    const f = fixture();
    const sending = runChatSend(f.ticket, { message: "queued message", attachments: [] }, () => undefined);
    cancelChatSend(f.ticket);
    expect(f.ticket.client.chatCancel).not.toHaveBeenCalled();
    f.handlers().onAccepted?.({ messageId: "queued-message", runId: "queued-run" });
    expect(f.ticket.client.chatCancel).toHaveBeenCalledExactlyOnceWith("taki", "queued-run");
    cancelChatSend(f.ticket);
    expect(f.ticket.client.chatCancel).toHaveBeenCalledTimes(1);
    f.finish(); await sending;
  });

  it("leaves ordered activity intact when redundant legacy deltas/complete arrive", async () => {
    const f = fixture();
    const sending = runChatSend(f.ticket, { message: "question", attachments: [] }, () => undefined);
    f.handlers().onAccepted?.({ messageId: "message", runId: "run" });
    useChatTimelineStore.getState().applyActivity({ stale: false, snapshot: { characterId: "taki", messageId: "message",
      status: "active", seq: 2, items: [{ kind: "text", itemId: "a", order: 0, text: "ordered A" }] } });
    f.handlers().onDelta("legacy A", "message");
    f.handlers().onComplete?.();
    expect(useChatTimelineStore.getState().inflight).toBeNull();
    expect(useChatTimelineStore.getState().live.turns).toMatchObject([{ view: { snapshot: { items: [{ text: "ordered A" }] } } }]);
    f.finish(); await sending;
  });

  it("does not restore a draft, clear a newer reply or send cancellation from retired callbacks", async () => {
    const f = fixture();
    const restored: string[] = [];
    const sending = runChatSend(f.ticket, { message: "old draft", attachments: [] }, (text) => restored.push(text));
    f.retire();
    useChatTimelineStore.getState().growInflight("new-message", "new reply");
    f.handlers().onAccepted?.({ messageId: "old-message", runId: "old-run" });
    f.handlers().onDelta("late old reply", "old-message");
    f.handlers().onError?.("PROVIDER_ERROR", "old cancelled", true);
    cancelChatSend(f.ticket);
    expect(restored).toEqual([]);
    expect(f.ticket.client.chatCancel).not.toHaveBeenCalled();
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "new-message", text: "new reply" });
    f.finish(); await sending;
  });
});
