/**
 * INPUT:  recordDelta() calls on the module coalescer + the real timeline store; fake timers.
 * OUTPUT: assertions for the P1a coalescing contract: several deltas inside one ~40ms window produce ONE store
 *         update carrying the full accumulated text; flush boundaries never lose or duplicate text; and a flush
 *         pending when the row is dropped (persisted swap / chat.complete) is a no-op — no resurrection.
 * POS:    unit test for chat-delta-coalescer (zustand in node, no DOM). Exempt from size caps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry, TimelineRole } from "@taki/shared";
import { useChatTimelineStore } from "./chat-timeline-store.ts";
import { recordDelta, resetDeltaCoalescerForTests } from "./chat-delta-coalescer.ts";

function entry(seq: number, role: TimelineRole, content: string): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role, content, createdAt: "2026-07-15T10:00:00.000Z" };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetDeltaCoalescerForTests();
  useChatTimelineStore.getState().reset();
});

afterEach(() => vi.useRealTimers());

/** Counts store notifications where the in-flight row actually changed (a coalesced flush = one such update). */
function trackInflightUpdates(): { updates: string[]; stop(): void } {
  const updates: string[] = [];
  let previous = useChatTimelineStore.getState().inflight;
  const unsubscribe = useChatTimelineStore.subscribe((state) => {
    if (state.inflight !== previous) updates.push(state.inflight ? state.inflight.text : "<dropped>");
    previous = state.inflight;
  });
  return { updates, stop: unsubscribe };
}

describe("chat delta coalescer (P1a)", () => {
  it("collapses several deltas inside one window into ONE store update with the full accumulated text", () => {
    const tracked = trackInflightUpdates();
    recordDelta("m1", "Hel");
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: "Hel" }); // first delta immediate
    recordDelta("m1", "lo");
    recordDelta("m1", " ");
    recordDelta("m1", "world");
    expect(tracked.updates).toEqual(["Hel"]); // nothing published while the window is open
    vi.advanceTimersByTime(40);
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: "Hello world" });
    expect(tracked.updates).toEqual(["Hel", "Hello world"]); // exactly one flush for the batch
    tracked.stop();
  });

  it("keeps text integrity across several flush boundaries (no loss, no duplication)", () => {
    const pieces = ["a", "b", "c", "d", "e", "f"];
    recordDelta("m1", pieces[0]!);
    for (const piece of pieces.slice(1)) {
      recordDelta("m1", piece);
      vi.advanceTimersByTime(40);
    }
    vi.advanceTimersByTime(40);
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: pieces.join("") });
  });

  it("drops a pending flush when chat.complete cleared the row (no resurrection, no duplicate)", () => {
    const tracked = trackInflightUpdates();
    recordDelta("m1", "streaming text");
    vi.advanceTimersByTime(40); // settle the first window so only the SECOND batch is pending
    recordDelta("m1", " more");
    useChatTimelineStore.getState().clearInflight(); // chat.complete safety net
    vi.advanceTimersByTime(40);
    expect(useChatTimelineStore.getState().inflight).toBeNull();
    expect(tracked.updates).toEqual(["streaming text", "<dropped>"]); // the pending " more" never reappears
    tracked.stop();
  });

  it("drops a pending flush when the persisted assistant entry swapped the row out (one atomic handoff)", () => {
    recordDelta("m1", "streaming text");
    vi.advanceTimersByTime(40);
    recordDelta("m1", " tail");
    useChatTimelineStore.getState().appendLive(entry(1, "assistant", "full persisted text"));
    vi.advanceTimersByTime(40);
    const state = useChatTimelineStore.getState();
    expect(state.inflight).toBeNull();
    expect(state.entries.map((value) => value.seq)).toEqual([1]);
    expect(state.entries[0]!.content).toBe("full persisted text");
  });

  it("applies a NEW turn's first delta immediately and never flushes the previous turn's stale buffer", () => {
    const tracked = trackInflightUpdates();
    recordDelta("m1", "old turn");
    vi.advanceTimersByTime(40);
    recordDelta("m1", " buffered tail");
    recordDelta("m2", "fresh"); // new turn starts before m1's pending flush fires
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m2", text: "fresh" });
    vi.advanceTimersByTime(40);
    expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m2", text: "fresh" }); // m1 buffer dropped
    expect(tracked.updates).toEqual(["old turn", "fresh"]); // one atomic replace, no intermediate drop
    tracked.stop();
  });
});
