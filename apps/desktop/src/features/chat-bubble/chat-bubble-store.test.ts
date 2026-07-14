/**
 * INPUT:  reducer calls (start/append/finish/fail/reset) on the store singleton.
 * OUTPUT: assertions that streamed deltas accumulate, states transition correctly, and appends outside streaming no-op.
 * POS:    unit test for the chat bubble reply store (F2). Zustand runs in node (no DOM). Exempt from size caps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useChatBubbleStore } from "./chat-bubble-store.ts";

describe("chat bubble store", () => {
  beforeEach(() => useChatBubbleStore.getState().reset());

  it("accumulates streamed deltas into the reply text", () => {
    const store = useChatBubbleStore.getState();
    store.startReply();
    store.appendDelta("Hel");
    store.appendDelta("lo");
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "streaming", text: "Hello" });
  });

  it("moves streaming → done on finish", () => {
    const store = useChatBubbleStore.getState();
    store.startReply();
    store.appendDelta("hi");
    store.finishReply();
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "done", text: "hi" });
  });

  it("fails to an error regardless of prior state", () => {
    useChatBubbleStore.getState().failReply("boom");
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "error", message: "boom" });
  });

  it("ignores a delta when not streaming (no phantom bubble)", () => {
    useChatBubbleStore.getState().appendDelta("x");
    expect(useChatBubbleStore.getState().reply).toEqual({ kind: "empty" });
  });
});
