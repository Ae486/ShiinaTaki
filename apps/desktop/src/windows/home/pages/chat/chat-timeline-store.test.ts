/**
 * INPUT:  reducer calls (mergeHistory/prependOlder/appendLive/growInflight/growInflightIfCurrent/clearInflight/
 *         widenWindow/settleRestore) on the singleton.
 * OUTPUT: assertions that a history page renders chronologically, live rows append, deltas grow the in-flight row,
 *         an appended assistant row (or clearInflight) finalizes it, the mounted window trims oldest-first (P1b),
 *         and the coalesced-flush append cannot resurrect a dropped row (P1a).
 * POS:    unit test for the chat timeline store (T10). Zustand in node (no DOM). Exempt from size caps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineRole } from "@taki/shared";
import { TIMELINE_MOUNT_CAP, TIMELINE_RESTORE_STEP, useChatTimelineStore } from "./chat-timeline-store.ts";

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

  describe("P1a coalesced-flush append (growInflightIfCurrent)", () => {
    it("appends the accumulated text while the streamed row still exists", () => {
      const store = useChatTimelineStore.getState();
      store.growInflight("m1", "Hel");
      store.growInflightIfCurrent("m1", "lo ");
      store.growInflightIfCurrent("m1", "world");
      expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m1", text: "Hello world" });
    });

    it("is a no-op once the persisted assistant entry swapped the row out (atomic handoff stays clean)", () => {
      const store = useChatTimelineStore.getState();
      store.growInflight("m1", "streaming");
      store.appendLive(entry(1, "assistant", "full persisted text"));
      store.growInflightIfCurrent("m1", " late buffered delta");
      const state = useChatTimelineStore.getState();
      expect(state.inflight).toBeNull();
      expect(state.entries.map((e) => e.seq)).toEqual([1]);
    });

    it("is a no-op after the chat.complete safety net cleared the row", () => {
      const store = useChatTimelineStore.getState();
      store.growInflight("m1", "streaming");
      store.clearInflight();
      store.growInflightIfCurrent("m1", " late");
      expect(useChatTimelineStore.getState().inflight).toBeNull();
    });

    it("is a no-op for a stale turn's flush after a newer turn replaced the row", () => {
      const store = useChatTimelineStore.getState();
      store.growInflight("m1", "old");
      store.growInflight("m2", "new turn");
      store.growInflightIfCurrent("m1", " stale buffer");
      expect(useChatTimelineStore.getState().inflight).toEqual({ messageId: "m2", text: "new turn" });
    });
  });

  describe("P1b mounted-window cap", () => {
    const fullPage = (count: number) =>
      Array.from({ length: count }, (_, index) => entry(index + 1, "user", `m${index + 1}`));

    it("trims the OLDEST rows down to the cap, keeping the newest, and re-points the older-page cursor", () => {
      const store = useChatTimelineStore.getState();
      store.mergeHistory({ entries: fullPage(TIMELINE_MOUNT_CAP + 5), nextBefore: 1 });
      const state = useChatTimelineStore.getState();
      expect(state.entries).toHaveLength(TIMELINE_MOUNT_CAP);
      expect(state.entries[0]!.seq).toBe(6);
      expect(state.entries.at(-1)!.seq).toBe(TIMELINE_MOUNT_CAP + 5);
      // The trimmed rows (seqs 1..5) sit strictly below the new window edge, so before=edge refetches exactly them.
      expect(state.nextBefore).toBe(6);
      expect(state.truncated).toBe(true);
    });

    it("keeps the newest row and slides the window when a live append pushes past the cap", () => {
      const store = useChatTimelineStore.getState();
      store.mergeHistory({ entries: fullPage(TIMELINE_MOUNT_CAP), nextBefore: null });
      store.appendLive(entry(TIMELINE_MOUNT_CAP + 1, "assistant", "live"));
      const state = useChatTimelineStore.getState();
      expect(state.entries).toHaveLength(TIMELINE_MOUNT_CAP);
      expect(state.entries[0]!.seq).toBe(2);
      expect(state.entries.at(-1)!.seq).toBe(TIMELINE_MOUNT_CAP + 1);
      expect(state.truncated).toBe(true);
    });

    it("restores a larger window on demand: widening the window lets older pages remount without re-trim", () => {
      const store = useChatTimelineStore.getState();
      store.mergeHistory({ entries: fullPage(TIMELINE_MOUNT_CAP + 50), nextBefore: 1 });
      expect(useChatTimelineStore.getState().truncated).toBe(true);

      store.widenWindow();
      expect(useChatTimelineStore.getState().windowLimit).toBe(TIMELINE_MOUNT_CAP + TIMELINE_RESTORE_STEP);

      // The jump-restore refetches pages across the trim boundary (before = the window edge).
      store.prependOlder({ entries: fullPage(5).map((value) => ({ ...value, content: `refetched ${value.seq}` })), nextBefore: 1 });
      const state = useChatTimelineStore.getState();
      expect(state.entries).toHaveLength(TIMELINE_MOUNT_CAP + 5); // no re-trim inside the widened window
      expect(state.entries[0]!.seq).toBe(1);
    });

    it("keeps the jump control only while older rows are still missing after a restore settles", () => {
      const store = useChatTimelineStore.getState();
      store.mergeHistory({ entries: fullPage(TIMELINE_MOUNT_CAP + 5), nextBefore: 1 });
      expect(useChatTimelineStore.getState().truncated).toBe(true);

      store.settleRestore(true); // the widened window filled (or history exhausted): nothing missing
      expect(useChatTimelineStore.getState().truncated).toBe(false);

      store.settleRestore(false); // a failed restore: the control stays for a retry
      expect(useChatTimelineStore.getState().truncated).toBe(true);

      store.settleRestore(true);
      expect(useChatTimelineStore.getState().truncated).toBe(false);
      expect(useChatTimelineStore.getState().nextBefore).toBe(6);
    });

    it("resets the window with the rest of the store", () => {
      const store = useChatTimelineStore.getState();
      store.mergeHistory({ entries: fullPage(TIMELINE_MOUNT_CAP + 5), nextBefore: 1 });
      store.reset();
      const state = useChatTimelineStore.getState();
      expect(state.entries).toEqual([]);
      expect(state.windowLimit).toBe(TIMELINE_MOUNT_CAP);
      expect(state.truncated).toBe(false);
    });
  });

});
