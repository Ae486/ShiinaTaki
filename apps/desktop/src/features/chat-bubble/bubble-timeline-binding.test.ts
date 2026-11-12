import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry, TimelineCommitted, TimelineRemoved, TimelineHistoryResult } from "@taki/shared";
import { bindBubbleTimeline } from "./bubble-timeline-binding.ts";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { projectBubbleTranscript } from "./bubble-transcript.ts";
import type { PresentationGate } from "@/lib/presentation-gate.js";

function entry(seq: number, content = `speech ${seq}`): TimelineEntry {
  return { seq, id: `row-${seq}`, characterId: "taki", role: "assistant", content, createdAt: "2026-09-27T00:00:00Z" };
}
function fixture(history: Promise<TimelineHistoryResult> = Promise.resolve({ entries: [], nextBefore: null }), gate?: PresentationGate) {
  let appended!: (entry: TimelineEntry) => void;
  let committed!: (batch: TimelineCommitted) => void;
  let removed!: (ref: TimelineRemoved) => void;
  let current = true;
  const unsubscribe = vi.fn();
  const binding = bindBubbleTimeline({ onTimelineAppended: (handler) => { appended = handler; },
    onTimelineCommitted: (handler) => { committed = handler; return unsubscribe; }, onTimelineRemoved: (handler) => { removed = handler; },
    timelineHistory: () => history, onClose: () => undefined,
  }, { generation: 1, isCurrent: () => current }, { gate });
  return { binding, append: (row: TimelineEntry) => appended(row), commit: (batch: TimelineCommitted) => committed(batch),
    remove: (seq: number) => removed({ characterId: "taki", seq }), retire: () => { current = false; binding.dispose(); }, unsubscribe };
}
beforeEach(() => { useChatBubbleStore.getState().reset(); useInteractionStore.getState().setBubbleOpen(false); });
describe("Pet committed Timeline binding", () => {
  it("renders ordinary autonomous speech, deduplicates push/history and never opens the bubble", async () => {
    const f = fixture(Promise.resolve({ entries: [entry(2), entry(1)], nextBefore: null }));
    f.append(entry(3)); f.append(entry(3)); await f.binding.restore();
    expect(useChatBubbleStore.getState().committed).toBeNull();
    expect(useInteractionStore.getState().bubbleOpen).toBe(false);
    useInteractionStore.getState().setBubbleOpen(true);
    const view = projectBubbleTranscript(useChatBubbleStore.getState());
    expect(view.items).toMatchObject([{ kind: "text", text: "speech 3", committed: [{ characterId: "taki", timelineSeq: 3 }] }]);
    f.retire();
  });
  it("retains segmented live activity until a complete batch commits and uses stable keys", () => {
    useInteractionStore.getState().setBubbleOpen(true);
    useChatBubbleStore.getState().observeActivity({ stale: false, snapshot: { status: "active", characterId: "taki", messageId: "turn", seq: 3,
      items: [{ kind: "text", itemId: "a", order: 0, text: "A" }, { kind: "text", itemId: "b", order: 1, text: "B" }] } });
    const f = fixture();
    const a = { ...entry(1, "A"), presentation: { schemaVersion: "timeline-presentation.v1" as const, messageId: "turn", activitySeq: 4, entryIndex: 0, entryCount: 2,
      references: [{ kind: "text" as const, itemId: "a", order: 0, start: 0, end: 1 }] } };
    const b = { ...entry(2, "B"), presentation: { ...a.presentation, entryIndex: 1,
      references: [{ kind: "text" as const, itemId: "b", order: 1, start: 0, end: 1 }] } };
    f.append(a); expect(useChatBubbleStore.getState().committed).toBeNull();
    f.commit({ characterId: "taki", messageId: "turn", activitySeq: 4, entries: [a, b] });
    expect(projectBubbleTranscript(useChatBubbleStore.getState()).items).toMatchObject([{ text: "A" }, { text: "B" }]);
    useChatBubbleStore.getState().observeActivity({ stale: false, snapshot: { status: "active", characterId: "taki", messageId: "next", seq: 1, items: [] } });
    expect(useChatBubbleStore.getState().committed).toBeNull(); f.retire();
  });
  it("rejects queued gate callbacks after hide, source replacement or a newer foreground turn", () => {
    const callbacks: Array<() => void> = [];
    const f = fixture(undefined, { present: (callback) => callbacks.push(callback) });
    useInteractionStore.getState().setBubbleOpen(true); f.append(entry(1));
    useInteractionStore.getState().setBubbleOpen(false); callbacks.shift()!();
    expect(useChatBubbleStore.getState().committed).toBeNull();
    useInteractionStore.getState().setBubbleOpen(true);
    useChatBubbleStore.getState().observeActivity({ stale: false, snapshot: { status: "active", characterId: "taki", messageId: "new", seq: 1, items: [] } });
    callbacks.shift()!(); expect(useChatBubbleStore.getState().committed).toBeNull();
    useChatBubbleStore.getState().reset(); f.append(entry(2)); f.retire(); callbacks.shift()!();
    expect(useChatBubbleStore.getState().committed).toBeNull();
  });
  it("keeps removal tombstones and rejects history or pushes from a retired connection", async () => {
    let finish!: (value: TimelineHistoryResult) => void;
    const f = fixture(new Promise((resolve) => { finish = resolve; })); const restoring = f.binding.restore();
    f.append(entry(3)); f.remove(3); f.retire(); finish({ entries: [entry(3)], nextBefore: null }); await restoring;
    f.append(entry(4)); expect(useChatBubbleStore.getState().committed).toBeNull(); expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
});
