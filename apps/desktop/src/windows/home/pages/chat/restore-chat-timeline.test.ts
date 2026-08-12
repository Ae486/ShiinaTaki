import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineHistoryResult, TimelineRemoved, TimelineRole } from "@taki/shared";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import { useChatTimelineStore } from "./chat-timeline-store.ts";
import { restoreChatTimeline, type ChatRestorationClient } from "./restore-chat-timeline.ts";

function entry(seq: number, role: TimelineRole, content: string): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role, content, createdAt: "2026-08-08T00:00:00.000Z" };
}

class FakeChatClient implements ChatRestorationClient {
  readonly order: string[] = [];
  history: TimelineHistoryResult = {
    entries: [entry(6, "assistant", "fresh"), entry(5, "user", "new"), entry(3, "user", "retained")],
    nextBefore: 3,
  };
  subscribeError: Error | null = null;
  onSubscribe: (() => void) | null = null;
  onHistory: (() => void) | null = null;
  private appended: ((value: TimelineEntry) => void) | null = null;
  private removed: ((value: TimelineRemoved) => void) | null = null;

  onTimelineAppended(handler: (value: TimelineEntry) => void): void {
    this.order.push("append-handler");
    this.appended = handler;
  }

  onTimelineRemoved(handler: (value: TimelineRemoved) => void): void {
    this.order.push("remove-handler");
    this.removed = handler;
  }

  async subscribeTimeline(): Promise<void> {
    this.order.push("subscribe");
    if (this.subscribeError) throw this.subscribeError;
    this.onSubscribe?.();
  }

  async timelineHistory() {
    this.order.push("history");
    this.onHistory?.();
    return this.history;
  }

  deliverAppend(value: TimelineEntry): void {
    this.appended?.(value);
  }

  deliverRemove(value: TimelineRemoved): void {
    this.removed?.(value);
  }
}

function context(current: () => boolean): ConnectionGenerationContext {
  return { generation: 1, isCurrent: current };
}

beforeEach(() => useChatTimelineStore.getState().reset());

describe("restoreChatTimeline", () => {
  it("reconciles the newest page without dropping older cache or a post-subscribe append absent from history", async () => {
    useChatTimelineStore.getState().mergeHistory({
      entries: [entry(4, "user", "retracted while offline"), entry(3, "user", "cached"), entry(1, "user", "older")],
      nextBefore: null,
    });
    const client = new FakeChatClient();
    client.onSubscribe = () => client.deliverAppend(entry(7, "assistant", "raced after subscribe"));
    await restoreChatTimeline(client, context(() => true));

    expect(client.order).toEqual(["append-handler", "remove-handler", "subscribe", "history"]);
    expect(useChatTimelineStore.getState().entries.map((value) => value.seq)).toEqual([1, 3, 5, 6, 7]);
    expect(useChatTimelineStore.getState().nextBefore).toBeNull();
    client.deliverRemove({ characterId: "taki", seq: 5 });
    expect(useChatTimelineStore.getState().entries.map((value) => value.seq)).toEqual([1, 3, 6, 7]);
  });

  it("guards late push callbacks from a retired generation", async () => {
    let current = true;
    const client = new FakeChatClient();
    await restoreChatTimeline(client, context(() => current));
    current = false;
    client.deliverAppend(entry(9, "assistant", "late"));
    client.deliverRemove({ characterId: "taki", seq: 5 });
    expect(useChatTimelineStore.getState().entries.map((value) => value.seq)).toEqual([3, 5, 6]);
  });

  it("tombstones a removal racing with history so the response cannot re-add that row", async () => {
    const client = new FakeChatClient();
    client.history = { entries: [entry(4, "user", "stale response"), entry(1, "user", "older")], nextBefore: null };
    client.onHistory = () => client.deliverRemove({ characterId: "taki", seq: 4 });

    await restoreChatTimeline(client, context(() => true));

    expect(useChatTimelineStore.getState().entries.map((value) => value.seq)).toEqual([1]);
  });

  it("propagates subscription failure so the candidate cannot be labelled connected", async () => {
    const client = new FakeChatClient();
    client.subscribeError = new Error("timeline subscribe failed");
    await expect(restoreChatTimeline(client, context(() => true))).rejects.toThrow("timeline subscribe failed");
    expect(client.order).toEqual(["append-handler", "remove-handler", "subscribe"]);
  });
});
