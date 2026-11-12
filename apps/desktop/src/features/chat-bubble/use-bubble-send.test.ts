import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHandlers } from "@/lib/ws-client.js";
import { setSharedPresentationReady } from "@/lib/presentation-gate.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { runBubbleSend, type BubbleSendTicket } from "./use-bubble-send.ts";

const ownership = vi.hoisted(() => ({ messages: new Set<string>() }));
vi.mock("./bubble-activity-binding.ts", () => ({ bubbleActivityOwnsMessage: (messageId: string) => ownership.messages.has(messageId) }));

function fixture() {
  let current = true;
  let handlers: ChatHandlers | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const ticket: BubbleSendTicket = { client: { chat: vi.fn(async (_params, next) => { handlers = next; await finished; }) },
    current: () => current };
  return { ticket, finish, retire: () => { current = false; }, handlers: () => {
    if (!handlers) throw new Error("send not started"); return handlers;
  } };
}

beforeEach(() => {
  ownership.messages.clear(); useChatBubbleStore.getState().reset(); useInteractionStore.getState().setBubbleOpen(true);
});
afterEach(() => { setSharedPresentationReady({ whenReady: (surface) => surface() }); useInteractionStore.getState().setBubbleOpen(false); });

describe("Pet initiating send and draft recovery", () => {
  it("keeps modern activity authoritative when compatible legacy deltas and completion also arrive", async () => {
    const f = fixture();
    const sending = runBubbleSend(f.ticket, "question", () => undefined);
    f.handlers().onAccepted?.({ messageId: "accepted", runId: "run" });
    ownership.messages.add("accepted");
    f.handlers().onDelta("duplicate legacy text", "accepted");
    f.handlers().onComplete?.();
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "done", text: "" });
    f.finish(); await sending;
  });

  it("restores a retracted draft once and leaves shared activity untouched", async () => {
    const f = fixture();
    const restored: string[] = [];
    const sending = runBubbleSend(f.ticket, "keep this question", (draft) => restored.push(draft));
    f.handlers().onAccepted?.({ messageId: "accepted", runId: "run" });
    const view = { stale: false, snapshot: { status: "active" as const, characterId: "taki", messageId: "other", seq: 1, items: [] } };
    useChatBubbleStore.getState().observeActivity(view);
    f.handlers().onError?.("PROVIDER_ERROR", "cancelled before reply", true);
    expect(restored).toEqual(["keep this question"]);
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "empty" });
    expect(useChatBubbleStore.getState().activitySource).toBe(view);
    f.finish(); await sending;
  });

  it("drops delayed presentation and completion from a retired generation without clearing a newer reply", async () => {
    const queued: Array<() => void> = [];
    setSharedPresentationReady({ whenReady: (surface) => queued.push(surface) });
    const f = fixture();
    const restored: string[] = [];
    const sending = runBubbleSend(f.ticket, "old draft", (draft) => restored.push(draft));
    f.handlers().onAccepted?.({ messageId: "old", runId: "old-run" });
    f.handlers().onDelta("old text", "old");
    f.retire();
    useChatBubbleStore.getState().startReply();
    useChatBubbleStore.getState().identifyReply("new");
    useChatBubbleStore.getState().appendDelta("new text");
    queued.forEach((surface) => surface());
    f.handlers().onComplete?.();
    f.handlers().onError?.("PROVIDER_ERROR", "late retraction", true);
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "streaming", text: "new text" });
    expect(restored).toEqual([]);
    f.finish(); await sending;
  });

  it("does not surface a delayed legacy delta after the user closes the bubble", async () => {
    const queued: Array<() => void> = [];
    setSharedPresentationReady({ whenReady: (surface) => queued.push(surface) });
    const f = fixture(); const sending = runBubbleSend(f.ticket, "question", () => undefined);
    f.handlers().onAccepted?.({ messageId: "accepted", runId: "run" });
    f.handlers().onDelta("hidden text", "accepted");
    useInteractionStore.getState().setBubbleOpen(false); queued.forEach((surface) => surface());
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "streaming", text: "" });
    f.finish(); await sending;
  });
});
