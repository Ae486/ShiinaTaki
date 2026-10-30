import { beforeEach, describe, expect, it } from "vitest";
import type { ChatActivity, ChatActivityReadResult, TimelineCommitted, TimelineEntry, TimelineHistoryParams, TimelineHistoryResult, TimelineRemoved, TimelineRole } from "@taki/shared";
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
  activity: ChatActivityReadResult = { status: "idle", characterId: "taki" };
  onActivityRead: (() => void) | null = null;
  private activityHandler: ((value: ChatActivity) => void) | null = null;
  private commitHandler: ((value: TimelineCommitted) => void) | null = null;
  private appended: ((value: TimelineEntry) => void) | null = null;
  private removed: ((value: TimelineRemoved) => void) | null = null;

  onClose(): void { /* The generation predicate is the teardown seam in this fixture. */ }

  onChatActivity(handler: (value: ChatActivity) => void): () => void {
    this.order.push("activity-handler"); this.activityHandler = handler;
    return () => { this.activityHandler = null; };
  }

  onTimelineCommitted(handler: (value: TimelineCommitted) => void): () => void {
    this.order.push("commit-handler"); this.commitHandler = handler;
    return () => { this.commitHandler = null; };
  }

  async chatActivityRead(): Promise<ChatActivityReadResult> {
    this.order.push("activity-read"); this.onActivityRead?.(); return this.activity;
  }

  deliverActivity(value: ChatActivity): void { this.activityHandler?.(value); }
  deliverCommit(value: TimelineCommitted): void { this.commitHandler?.(value); }

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
  it("recovers an older pending reply after more than one page of remote turns despite an exhausted old cursor", async () => {
    const committed = (seq: number, messageId: string, content: string): TimelineEntry => ({ ...entry(seq, "assistant", content),
      presentation: { schemaVersion: "timeline-presentation.v1", messageId, entryIndex: 0, entryCount: 1, activitySeq: 2,
        references: [{ kind: "text", itemId: `text-${messageId}`, order: 0, start: 0, end: content.length }] } });
    const rows = [entry(1, "user", "old question"), committed(2, "old", "old completed reply")];
    for (let index = 1; index <= 30; index += 1) {
      rows.push(entry(index * 2 + 1, "user", `question ${index}`), committed(index * 2 + 2, `later-${index}`, `reply ${index}`));
    }
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [rows[0]!], nextBefore: null });
    store.applyActivity({ stale: false, snapshot: { characterId: "taki", messageId: "old", status: "active", seq: 2,
      items: [{ kind: "text", itemId: "text-old", order: 0, text: "old completed reply" }] } });
    const client = new FakeChatClient();
    client.activity = { characterId: "taki", messageId: "later-30", status: "terminal", seq: 3, outcome: "completed",
      items: [{ kind: "text", itemId: "text-later-30", order: 0, text: "reply 30" }] };
    const requests: Array<TimelineHistoryParams | undefined> = [];
    client.timelineHistory = async (params?: TimelineHistoryParams) => {
      requests.push(params);
      const available = rows.filter((row) => params?.before === undefined || row.seq < params.before).reverse();
      const page = available.slice(0, params?.limit ?? 50);
      return { entries: page, nextBefore: available.length > page.length ? page.at(-1)!.seq : null };
    };
    await restoreChatTimeline(client, context(() => true));
    const state = useChatTimelineStore.getState();
    expect(requests).toHaveLength(2);
    expect(state.entries.map((row) => row.seq)).toEqual(rows.map((row) => row.seq));
    expect(state.live.turns).toEqual([]);
    expect(state.live.covered.has("old")).toBe(true);
    expect(state.nextBefore).toBeNull();
  });

  it("reconciles a commit racing the activity read/history fetch without losing text or replaying the terminal", async () => {
    const client = new FakeChatClient();
    const identity = { characterId: "taki", messageId: "message", runId: "run", attemptId: "attempt" };
    client.activity = { ...identity, status: "active", seq: 2,
      items: [{ kind: "text", itemId: "segment", order: 0, text: "A" }] };
    client.history = { entries: [], nextBefore: null };
    const committed: TimelineEntry = { ...entry(2, "assistant", "AB"),
      presentation: { schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: 0, entryCount: 1,
        activitySeq: 3, references: [{ kind: "text", itemId: "segment", order: 0, start: 0, end: 2 }] } };
    client.onSubscribe = () => client.deliverAppend(entry(1, "user", "question"));
    client.onActivityRead = () => client.deliverActivity({ ...identity, kind: "text.delta", seq: 3,
      itemId: "segment", order: 0, delta: "B" });
    client.onHistory = () => client.deliverCommit({ characterId: "taki", messageId: "message", activitySeq: 3, entries: [committed] });
    await restoreChatTimeline(client, context(() => true));
    expect(useChatTimelineStore.getState().entries.map((value) => value.content)).toEqual(["question", "AB"]);
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    client.deliverActivity({ ...identity, kind: "turn.terminal", seq: 4, outcome: "completed" });
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    expect(client.order.filter((value) => value === "history")).toHaveLength(1);
  });

  it("reconciles the newest page without dropping older cache or a post-subscribe append absent from history", async () => {
    useChatTimelineStore.getState().mergeHistory({
      entries: [entry(4, "user", "retracted while offline"), entry(3, "user", "cached"), entry(1, "user", "older")],
      nextBefore: null,
    });
    const client = new FakeChatClient();
    client.onSubscribe = () => client.deliverAppend(entry(7, "assistant", "raced after subscribe"));
    await restoreChatTimeline(client, context(() => true));

    expect(client.order).toEqual(["activity-handler", "append-handler", "remove-handler", "commit-handler", "subscribe", "activity-read", "history"]);
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
    expect(client.order).toEqual(["activity-handler", "append-handler", "remove-handler", "commit-handler", "subscribe"]);
  });
});
