import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_ACTIVITY_MAX_ITEMS, type ChatActivity, type ChatActivityReadResult } from "@taki/shared";
import { createChatActivityRecovery, type ChatActivityClient } from "./chat-activity-recovery.ts";
import type { ChatActivityView } from "./chat-activity-state.ts";

const identity = { characterId: "taki", messageId: "turn", runId: "run", attemptId: "attempt" };
const start = { ...identity, kind: "turn.started", seq: 1 } satisfies ChatActivity;
const text = (seq: number, delta: string, messageId = "turn"): ChatActivity =>
  ({ ...identity, messageId, kind: "text.delta", seq, itemId: "a", order: 0, delta });
const snapshot = (seq: number, value: string, messageId = "turn"): ChatActivityReadResult => ({
  ...identity, messageId, seq, status: "active", items: [{ kind: "text", itemId: "a", order: 0, text: value }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(reads: Array<ChatActivityReadResult | Promise<ChatActivityReadResult>>) {
  const handlers = new Set<(event: ChatActivity) => void>();
  const closed: Array<() => void> = [];
  const order: string[] = [];
  const views: ChatActivityView[] = [];
  let current = true;
  const client: ChatActivityClient = {
    onChatActivity(handler) { order.push("handler"); handlers.add(handler); return () => handlers.delete(handler); },
    onClose(handler) { closed.push(handler); },
    async subscribeTimeline() { order.push("subscribe"); },
    async chatActivityRead() {
      order.push("read");
      const result = reads.shift();
      if (!result) throw new Error("unexpected activity read");
      return result;
    },
  };
  const recovery = createChatActivityRecovery({ client, context: { generation: 1, isCurrent: () => current },
    characterId: "taki", onChange: (view) => views.push(view) });
  return { recovery, order, views, emit: (event: ChatActivity) => { for (const handler of handlers) handler(event); },
    retire: () => { current = false; closed.forEach((close) => close()); } };
}

afterEach(() => vi.useRealTimers());

describe("shared activity subscribe/read recovery", () => {
  it("installs a snapshot atomically with only later buffered sequence numbers", async () => {
    const reading = deferred<ChatActivityReadResult>();
    const f = fixture([reading.promise]);
    const ready = f.recovery.restore();
    f.emit(start); f.emit(text(2, "A")); f.emit(text(3, "B")); f.emit(text(4, "C"));
    reading.resolve(snapshot(3, "AB"));
    await ready;
    expect(f.order).toEqual(["handler", "subscribe", "read"]);
    expect(f.views.at(-1)).toMatchObject({ stale: false, snapshot: { seq: 4, items: [{ text: "ABC" }] } });
    expect(f.views.filter((view) => !view.stale)).toHaveLength(1);
    f.recovery.dispose();
  });

  it("uses read-only gap recovery and ignores old-message and old-sequence callbacks", async () => {
    const f = fixture([snapshot(2, "A"), snapshot(4, "ABC")]);
    await f.recovery.restore();
    f.emit(text(4, "C"));
    await f.recovery.refresh();
    expect(f.order.filter((value) => value === "read")).toHaveLength(2);
    expect(f.views.at(-1)?.snapshot).toMatchObject({ seq: 4, items: [{ text: "ABC" }] });
    f.emit({ ...start, messageId: "next", runId: "next-run", attemptId: "next-attempt" });
    f.emit({ ...text(2, "new", "next"), attemptId: "next-attempt" });
    f.emit(text(5, "late old turn"));
    f.emit({ ...text(2, "duplicate", "next"), attemptId: "old-attempt" });
    f.recovery.flush();
    expect(f.views.at(-1)?.snapshot).toMatchObject({ messageId: "next", seq: 2, items: [{ text: "new" }] });
    expect(f.order.filter((value) => value === "read")).toHaveLength(2);
    f.recovery.dispose();
  });

  it("re-reads after buffer overflow and never publishes a suffix as a complete snapshot", async () => {
    const reading = deferred<ChatActivityReadResult>();
    const f = fixture([reading.promise, snapshot(CHAT_ACTIVITY_MAX_ITEMS + 3, "complete retained response")]);
    const ready = f.recovery.restore();
    f.emit(start);
    for (let seq = 2; seq < CHAT_ACTIVITY_MAX_ITEMS + 4; seq += 1) f.emit(text(seq, "suffix"));
    reading.resolve(snapshot(1, ""));
    await ready;
    expect(f.order.filter((value) => value === "read")).toHaveLength(2);
    expect(f.views.filter((view) => !view.stale).map((view) => view.snapshot))
      .toMatchObject([{ items: [{ text: "complete retained response" }] }]);
    f.recovery.dispose();
  });

  it("does not repeatedly query a known unavailable turn and resumes at the next actual start", async () => {
    const f = fixture([{ ...identity, status: "unavailable", seq: 600, reason: "capacity" }]);
    await f.recovery.restore();
    for (let seq = 601; seq < 650; seq += 1) f.emit(text(seq, "unrecoverable suffix"));
    await f.recovery.refresh();
    f.recovery.flush();
    expect(f.order.filter((value) => value === "read")).toHaveLength(1);
    expect(f.views.at(-1)?.snapshot.status).toBe("unavailable");
    expect(f.views.at(-1)?.snapshot).not.toHaveProperty("items");
    f.emit({ ...start, messageId: "next" }); f.emit(text(2, "new complete segment", "next"));
    f.recovery.flush();
    expect(f.views.at(-1)?.snapshot).toMatchObject({ status: "active", messageId: "next", items: [{ text: "new complete segment" }] });
    f.recovery.dispose();
  });

  it("flushes text before tool/terminal boundaries and cancels an old generation's pending publication", async () => {
    vi.useFakeTimers();
    const f = fixture([{ status: "idle", characterId: "taki" }]);
    await f.recovery.restore();
    f.emit(start); f.emit(text(2, "A")); f.emit(text(3, "B"));
    expect(f.views.at(-1)?.snapshot).toMatchObject({ items: [{ text: "A" }] });
    f.emit({ ...identity, seq: 4, kind: "tool.received", itemId: "tool", order: 1, toolCallId: "call", toolName: "echo" });
    expect(f.views.at(-1)?.snapshot).toMatchObject({ items: [{ text: "AB" }, { itemId: "tool", status: { phase: "received" } }] });
    f.emit({ ...identity, seq: 5, kind: "text.delta", itemId: "b", order: 2, delta: "C" });
    f.emit({ ...identity, seq: 6, kind: "text.delta", itemId: "b", order: 2, delta: "D" });
    const count = f.views.length;
    f.retire();
    await vi.advanceTimersByTimeAsync(80);
    expect(f.views).toHaveLength(count);
  });

  it("marks a failed recovery stale and drops a read that resolves after retirement", async () => {
    const reading = deferred<ChatActivityReadResult>();
    const f = fixture([snapshot(2, "A"), reading.promise]);
    await f.recovery.restore();
    const refreshing = f.recovery.refresh();
    reading.reject(new Error("offline"));
    await expect(refreshing).rejects.toThrow("offline");
    expect(f.views.at(-1)).toMatchObject({ stale: true, snapshot: { items: [{ text: "A" }] } });
    f.retire();
    const count = f.views.length;
    f.emit(text(3, "late"));
    expect(f.views).toHaveLength(count);

    const late = deferred<ChatActivityReadResult>();
    const g = fixture([late.promise]);
    const ready = g.recovery.restore();
    await Promise.resolve();
    g.retire(); late.resolve(snapshot(4, "retired data"));
    await ready;
    expect(g.views.some((view) => !view.stale)).toBe(false);
  });
});
