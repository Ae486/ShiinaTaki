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

});
