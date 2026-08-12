/**
 * INPUT:  reducer calls (mergeHistory/prependOlder/appendLive/growInflight/clearInflight) on the singleton.
 * OUTPUT: assertions that a history page renders chronologically, live rows append, deltas grow the in-flight row,
 *         and an appended assistant row (or clearInflight) finalizes it.
 * POS:    unit test for the chat timeline store (T10). Zustand in node (no DOM). Exempt from size caps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineRole } from "@taki/shared";
import { useChatTimelineStore } from "./chat-timeline-store.ts";

function entry(seq: number, role: TimelineRole, content: string): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role, content, createdAt: "2026-07-15T10:00:00.000Z" };
}

describe("chat timeline store", () => {
  beforeEach(() => useChatTimelineStore.getState().reset());

  it("renders a newest-first history page as chronological entries and sets the cursor", () => {
    useChatTimelineStore.getState().mergeHistory({
      entries: [entry(3, "assistant", "c"), entry(2, "user", "b"), entry(1, "assistant", "a")],
      nextBefore: 1,
    });
    const state = useChatTimelineStore.getState();
    expect(state.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(state.nextBefore).toBe(1);
    expect(state.loaded).toBe(true);
  });

  it("appends a live timeline.appended row and dedups a repeat", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [entry(1, "user", "a")], nextBefore: null });
    store.appendLive(entry(2, "user", "b"));
    store.appendLive(entry(2, "user", "b")); // duplicate seq
    expect(useChatTimelineStore.getState().entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("prepends an older page ahead of existing entries, moving the cursor back", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [entry(5, "user", "e")], nextBefore: 5 });
    store.prependOlder({ entries: [entry(4, "assistant", "d"), entry(3, "user", "c")], nextBefore: 3 });
    const state = useChatTimelineStore.getState();
    expect(state.entries.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(state.nextBefore).toBe(3);
  });

  it("grows the in-flight assistant row across deltas", () => {
    const store = useChatTimelineStore.getState();
    store.growInflight("m1", "Hel");
    store.growInflight("m1", "lo");
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: "Hello" });
  });

  it("replaces a stale in-flight row when a NEW turn's messageId starts streaming", () => {
    const store = useChatTimelineStore.getState();
    store.growInflight("m1", "old turn leftovers");
    store.growInflight("m2", "fresh");
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m2", text: "fresh" });
  });

  it("keeps entries ascending when live rows arrive out of seq order", () => {
    const store = useChatTimelineStore.getState();
    store.appendLive(entry(5, "assistant", "later"));
    store.appendLive(entry(3, "user", "earlier"));
    expect(useChatTimelineStore.getState().entries.map((e) => e.seq)).toEqual([3, 5]);
  });

  it("drops the in-flight row when the persisted assistant entry arrives (appended handoff)", () => {
    const store = useChatTimelineStore.getState();
    store.growInflight("m1", "hi there");
    store.appendLive(entry(1, "assistant", "hi there"));
    const state = useChatTimelineStore.getState();
    expect(state.inflight).toBeNull();
    expect(state.entries.map((e) => e.seq)).toEqual([1]);
  });

  it("keeps the in-flight row when a non-assistant (user) row appends", () => {
    const store = useChatTimelineStore.getState();
    store.growInflight("m1", "typing");
    store.appendLive(entry(1, "user", "my message"));
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: "typing" });
  });

  it("clears the in-flight row on the complete safety-net", () => {
    const store = useChatTimelineStore.getState();
    store.growInflight("m1", "done");
    store.clearInflight();
    expect(useChatTimelineStore.getState().inflight).toBeNull();
  });

  it("removes a retracted entry by seq and keeps the rest ascending (cancel-before-reply)", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({
      entries: [entry(1, "user", "a"), entry(2, "assistant", "b"), entry(3, "user", "c")],
      nextBefore: null,
    });
    store.removeEntry(2);
    expect(useChatTimelineStore.getState().entries.map((e) => e.seq)).toEqual([1, 3]);
  });

  it("treats removeEntry for an unknown seq as a no-op", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [entry(1, "user", "a")], nextBefore: null });
    store.removeEntry(999);
    expect(useChatTimelineStore.getState().entries.map((e) => e.seq)).toEqual([1]);
  });

  it("replaces only covered baseline rows while preserving older pages and post-subscribe live rows", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [entry(30, "user", "stale"), entry(20, "assistant", "kept"), entry(10, "user", "older")], nextBefore: 10 });
    const cached = useChatTimelineStore.getState();
    const baseline = {
      seqs: new Set(cached.entries.map((value) => value.seq)),
      nextBefore: cached.nextBefore,
      loaded: cached.loaded,
    };
    store.appendLive(entry(50, "assistant", "raced live"));

    store.reconcileLatest({
      page: { entries: [entry(40, "user", "new"), entry(20, "assistant", "refreshed")], nextBefore: 20 },
      baseline,
      removedDuringRestore: new Set(),
    });

    const state = useChatTimelineStore.getState();
    expect(state.entries.map((value) => value.seq)).toEqual([10, 20, 40, 50]);
    expect(state.nextBefore).toBe(10);
  });

  it("does not re-add a row removed while the replacement history request was in flight", () => {
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: [entry(1, "user", "older")], nextBefore: null });
    const baseline = { seqs: new Set([1]), nextBefore: null, loaded: true };

    store.reconcileLatest({
      page: { entries: [entry(4, "user", "already retracted"), entry(1, "user", "older")], nextBefore: null },
      baseline,
      removedDuringRestore: new Set([4]),
    });

    expect(useChatTimelineStore.getState().entries.map((value) => value.seq)).toEqual([1]);
  });

});
