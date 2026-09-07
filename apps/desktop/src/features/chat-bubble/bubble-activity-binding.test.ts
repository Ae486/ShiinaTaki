import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatActivity, ChatActivityReadResult } from "@taki/shared";
import type { ChatActivityClient } from "@/lib/chat-activity-recovery.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { createBubbleActivityBinding, type BubbleActivityBinding } from "./bubble-activity-binding.ts";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { projectBubbleTranscript } from "./bubble-transcript.ts";

const snapshot = (value = "A", messageId = "turn"): Extract<ChatActivityReadResult, { status: "active" }> => ({ status: "active", characterId: "taki", messageId, seq: 3,
  items: [{ kind: "text", itemId: "a", order: 0, text: value },
    { kind: "tool", itemId: "tool", order: 1, toolCallId: "call", toolName: "echo", status: { phase: "executing" } }] });
const bindings: BubbleActivityBinding[] = [];

function fixture(options: { visible?: boolean; value?: ChatActivityReadResult | Promise<ChatActivityReadResult> } = {}) {
  let visible = options.visible ?? true;
  let current = true;
  let value = options.value ?? snapshot();
  const gate: Array<() => void> = [];
  const watchers = new Set<() => void>();
  const handlers = new Set<(event: ChatActivity) => void>();
  const closeHandlers: Array<() => void> = [];
  const order: string[] = [];
  const client: ChatActivityClient = {
    onChatActivity(handler) { order.push("handler"); handlers.add(handler); return () => handlers.delete(handler); },
    onClose(handler) { closeHandlers.push(handler); },
    async subscribeTimeline() { order.push("subscribe"); },
    async chatActivityRead() { order.push("read"); return value; },
  };
  const binding = createBubbleActivityBinding({ client, context: { generation: 1, isCurrent: () => current },
    gate: { present: (surface) => gate.push(surface) },
    visibility: { visible: () => visible, subscribe: (changed) => { watchers.add(changed); return () => { watchers.delete(changed); }; } } });
  bindings.push(binding);
  return { binding, gate, order, handlers, watchers,
    ready: () => { for (const surface of gate.splice(0)) surface(); },
    emit: (event: ChatActivity) => { for (const handler of handlers) handler(event); },
    setValue: (next: ChatActivityReadResult) => { value = next; },
    setVisible: (next: boolean) => { visible = next; watchers.forEach((watch) => watch()); },
    retire: () => { current = false; closeHandlers.forEach((close) => close()); },
  };
}

beforeEach(() => { useChatBubbleStore.getState().reset(); useInteractionStore.getState().setBubbleOpen(false); });
afterEach(() => { for (const binding of bindings.splice(0)) binding.dispose(); });

describe("Pet generation and presentation activity binding", () => {
  it("observes a closed bubble without opening it and restores via subscribe then read", async () => {
    const f = fixture({ visible: false });
    await f.binding.restore();
    expect(f.order).toEqual(["handler", "subscribe", "read"]);
    expect(useInteractionStore.getState().bubbleOpen).toBe(false);
    expect(useChatBubbleStore.getState().activitySource?.snapshot).toMatchObject({ items: [{ text: "A" }, { kind: "tool" }] });
    expect(useChatBubbleStore.getState().activity).toBeNull();
    expect(f.gate).toHaveLength(0);
    f.setVisible(true); await f.binding.refresh(); f.ready();
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "A" }, { kind: "tool" }]);
    expect(useInteractionStore.getState().bubbleOpen).toBe(false);
  });

  it("publishes real terminal tool facts immediately while new language remains gated", async () => {
    const f = fixture(); await f.binding.restore(); f.ready();
    f.emit({ characterId: "taki", messageId: "turn", seq: 4, kind: "tool.terminal", itemId: "tool", outcome: "completed" });
    f.emit({ characterId: "taki", messageId: "turn", seq: 5, kind: "text.delta", itemId: "b", order: 2, delta: "B" });
    const before = projectBubbleTranscript(useChatBubbleStore.getState());
    expect(before.items).toMatchObject([{ text: "A" }, { kind: "tool", status: { phase: "settled", outcome: "completed" } }]);
    f.ready();
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "A" }, { text: "B" }]);
  });

  it("invalidates hidden/closed presentation callbacks and recovers current content on reopening", async () => {
    const f = fixture(); await f.binding.restore(); f.ready();
    f.emit({ characterId: "taki", messageId: "turn", seq: 4, kind: "text.delta", itemId: "b", order: 2, delta: "B" });
    f.setVisible(false); f.ready();
    expect(useChatBubbleStore.getState().activity?.snapshot).toMatchObject({ seq: 3 });
    f.setValue({ ...snapshot(), seq: 4, items: [...snapshot().items,
      { kind: "text", itemId: "b", order: 2, text: "B" }] });
    f.setVisible(true); await f.binding.refresh(); f.ready();
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "A" }, { text: "B" }]);
  });

  it("drops old-generation read, gate and push callbacks and releases its visibility subscription", async () => {
    let finish!: (value: ChatActivityReadResult) => void;
    const read = new Promise<ChatActivityReadResult>((resolve) => { finish = resolve; });
    const f = fixture({ value: read });
    const restoring = f.binding.restore();
    await Promise.resolve();
    f.retire();
    finish(snapshot("late")); await restoring; f.ready();
    expect(f.handlers.size).toBe(0); expect(f.watchers.size).toBe(0);
    expect(f.binding.ownsMessage("turn")).toBe(false);
    expect(useChatBubbleStore.getState().activity).toBeNull();
    const next = fixture({ value: snapshot("new", "next") });
    await next.binding.restore(); next.ready(); f.ready();
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items[0]).toMatchObject({ text: "new" });
  });

  it("ignores a delayed gate for an older accepted message after the next turn starts", async () => {
    const f = fixture(); await f.binding.restore();
    f.emit({ characterId: "taki", messageId: "next", seq: 1, kind: "turn.started" });
    f.emit({ characterId: "taki", messageId: "next", seq: 2, kind: "text.delta", itemId: "new", order: 0, delta: "next reply" });
    f.ready();
    expect(f.binding.ownsMessage("turn")).toBe(false);
    expect(f.binding.ownsMessage("next")).toBe(true);
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ kind: "text", text: "next reply" }]);
  });
});
