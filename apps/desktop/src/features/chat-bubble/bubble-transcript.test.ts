import { beforeEach, describe, expect, it } from "vitest";
import type { ChatActivityItem, ChatActivityReadResult, ChatActivityToolStatus } from "@taki/shared";
import { activityItemKey, type ChatActivityView } from "@/lib/chat-activity-state.js";
import { activityToolStatus } from "@/lib/tool-activity-display.js";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { projectBubbleTranscript } from "./bubble-transcript.ts";

const text = (itemId: string, order: number, value = itemId): ChatActivityItem => ({ kind: "text", itemId, order, text: value });
const tool = (itemId: string, order: number, status: ChatActivityToolStatus = { phase: "executing" }): ChatActivityItem =>
  ({ kind: "tool", itemId, order, toolCallId: itemId, toolName: "echo", displayName: `Tool ${itemId}`, status });
const active = (items: ChatActivityItem[], messageId = "turn"): ChatActivityView =>
  ({ stale: false, snapshot: { characterId: "taki", messageId, status: "active", seq: 12, items } });
const terminal = (items: ChatActivityItem[], outcome: "completed" | "failed" | "cancelled" | "outcome_unknown", message?: string): ChatActivityView =>
  ({ stale: false, snapshot: { characterId: "taki", messageId: "turn", status: "terminal", seq: 20, items, outcome, message } });

function render(view: ChatActivityView, presented = view) {
  return projectBubbleTranscript({ activitySource: view, activity: presented, reply: { kind: "empty" }, replyMessageId: null, legacyEpoch: 0 });
}

beforeEach(() => useChatBubbleStore.getState().reset());

describe("Pet ordered semantic transcript", () => {
  it("retains separate A/B language and retires exact tool rows at next language or turn end", () => {
    const first = [text("A", 0), tool("one", 1)];
    expect(render(active(first)).items.map((item) => item.kind)).toEqual(["text", "tool"]);
    const second = [...first, text("B", 2), tool("two", 3)];
    expect(render(active(second)).items.map((item) => item.key))
      .toEqual([activityItemKey("turn", "A"), activityItemKey("turn", "B"), activityItemKey("turn", "two")]);
    const settled = render(terminal(second, "completed"));
    expect(settled.items).toMatchObject([{ kind: "text", text: "A" }, { kind: "text", text: "B" }]);
  });

  it("stops busy from raw completion while later language is still waiting at the presentation gate", () => {
    const presented = active([text("A", 0), tool("one", 1)]);
    const source = active([text("A", 0), tool("one", 1, { phase: "settled", outcome: "completed" }), text("B", 2)]);
    const beforeLanguage = render(source, presented).items;
    const row = beforeLanguage.find((item) => item.kind === "tool");
    expect(row?.kind === "tool" && activityToolStatus(row.status, row.stale).busy).toBe(false);
    expect(beforeLanguage.map((item) => item.kind)).toEqual(["text", "tool"]);
    expect(render(source).items.map((item) => item.kind)).toEqual(["text", "text"]);
  });

  it("keeps concurrent tools distinct and cannot redisplay an earlier tool after its late result", () => {
    const items = [text("A", 0), tool("one", 1), tool("two", 2)];
    expect(render(active(items)).items.filter((item) => item.kind === "tool")).toHaveLength(2);
    const later = [items[0]!, tool("one", 1, { phase: "settled", outcome: "failed", message: "first failed" }),
      items[2]!, text("B", 3), tool("three", 4)];
    expect(render(active(later)).items.filter((item) => item.kind === "tool").map((item) => item.key))
      .toEqual([activityItemKey("turn", "three")]);
  });

  it("emits one message-only error at terminal failure and suppresses handled tool errors and cancellations", () => {
    const failed = tool("one", 1, { phase: "settled", outcome: "failed", message: "tool failed" });
    expect(render(terminal([text("A", 0), failed], "failed", "provider failed")).items)
      .toMatchObject([{ kind: "text" }, { kind: "error", text: "provider failed" }]);
    expect(render(terminal([text("A", 0), failed], "completed")).items.at(-1))
      .toMatchObject({ kind: "error", text: "tool failed" });
    expect(render(terminal([text("A", 0), failed, text("B", 2)], "completed")).items.map((item) => item.kind))
      .toEqual(["text", "text"]);
    expect(render(terminal([text("A", 0), failed], "cancelled")).items.map((item) => item.kind)).toEqual(["text"]);
  });

  it("retains received language during unavailable recovery with no false running indicator or suffix", () => {
    const store = useChatBubbleStore.getState();
    const before = active([text("A", 0), tool("one", 1)]);
    store.observeActivity(before); store.presentActivity(before);
    const unavailable: ChatActivityView = { stale: false, snapshot: { characterId: "taki", messageId: "turn", seq: 100,
      status: "unavailable", reason: "capacity" } };
    store.observeActivity(unavailable); store.presentActivity(unavailable);
    const view = projectBubbleTranscript(useChatBubbleStore.getState());
    expect(view.items).toMatchObject([{ kind: "text", text: "A" }, { kind: "tool", stale: true }, { kind: "notice" }]);
    const row = view.items[1];
    expect(row?.kind === "tool" && activityToolStatus(row.status, row.stale).busy).toBe(false);
    expect(render(unavailable).items.map((item) => item.kind)).toEqual(["notice"]);
  });

  it("does not clear a retained reply on an idle replacement runtime or let old gated content replace a new turn", () => {
    const store = useChatBubbleStore.getState();
    const old = active([text("A", 0)]);
    store.observeActivity(old); store.presentActivity(old);
    const idle: ChatActivityView = { stale: false, snapshot: { status: "idle", characterId: "taki" } };
    store.observeActivity(idle); store.presentActivity(idle);
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "A" }, { kind: "notice" }]);
    const next = active([text("B", 0)], "next");
    store.observeActivity(next); store.presentActivity(old);
    expect(useChatBubbleStore.getState().activity).toBeNull();
    store.presentActivity(next);
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "B" }]);
  });

  it("keeps useful partial legacy language with one error and never splits it into guessed modern segments", () => {
    const view = projectBubbleTranscript({ activitySource: null, activity: null, reply: { kind: "error", message: "offline", text: "partial" },
      replyMessageId: null, legacyEpoch: 3 });
    expect(view.items).toMatchObject([{ kind: "text", text: "partial" }, { kind: "error", text: "offline" }]);
  });

  it("hides all remaining tools when an unavailable turn receives its truthful terminal summary", () => {
    const previous = active([text("A", 0), tool("one", 1)]);
    const snapshot: ChatActivityReadResult = { status: "unavailable", characterId: "taki", messageId: "turn", seq: 101,
      reason: "capacity", terminal: { outcome: "failed", message: "incomplete reply" } };
    expect(render({ stale: false, snapshot }, previous).items).toMatchObject([
      { kind: "text", text: "A" }, { kind: "notice" }, { kind: "error", text: "incomplete reply" },
    ]);
  });
});
