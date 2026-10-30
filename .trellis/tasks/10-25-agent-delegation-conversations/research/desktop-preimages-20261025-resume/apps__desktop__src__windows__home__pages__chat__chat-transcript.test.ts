import { beforeEach, describe, expect, it } from "vitest";
import { TimelineEntrySchema, type ChatActivityReadResult, type TimelineCommitted, type TimelineEntry, type TimelinePart, type TimelinePresentation } from "@taki/shared";
import { useChatTimelineStore } from "./chat-timeline-store.ts";
import { projectChatTranscript } from "./chat-transcript.ts";
import { completeTimelineBatch, needsEarlierBatchPage } from "./timeline-batch.ts";

function row(seq: number, role: TimelineEntry["role"], parts: TimelinePart[]): TimelineEntry {
  return { seq, id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, characterId: "taki", role,
    content: "canonical projection", parts, createdAt: "2026-09-07T00:00:00.000Z" };
}

const identity = { characterId: "taki", messageId: "message", runId: "run", attemptId: "attempt" };
const active: ChatActivityReadResult = { ...identity, seq: 8, status: "active", items: [
  { kind: "text", itemId: "a", order: 0, text: "A" },
  { kind: "tool", itemId: "one", order: 1, toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool",
    status: { phase: "settled", outcome: "failed" } },
  { kind: "text", itemId: "b", order: 2, text: "B" },
  { kind: "tool", itemId: "two", order: 3, toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool",
    status: { phase: "settled", outcome: "completed" } },
] };

function batch(): TimelineCommitted {
  const entries = [
    row(2, "assistant", [{ type: "text", text: "AB" },
      { type: "tool-call", toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool" }]),
    row(3, "tool", [{ type: "tool-result", toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool",
      output: { type: "content", value: [{ type: "text", text: "useful failure" }] } }]),
    row(4, "assistant", [{ type: "tool-call", toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool" }]),
    row(5, "tool", [{ type: "tool-result", toolCallId: "reused", toolName: "opaque", displayName: "Captured · tool",
      output: { type: "json", value: { ok: true, answer: "useful result" } } }]),
  ];
  const refs: TimelinePresentation["references"][] = [
    [{ kind: "text", itemId: "a", order: 0, partIndex: 0, start: 0, end: 1 },
      { kind: "text", itemId: "b", order: 2, partIndex: 0, start: 1, end: 2 },
      { kind: "tool", itemId: "one", order: 1, partIndex: 1, outcome: "failed" }],
    [{ kind: "tool", itemId: "one", order: 1, partIndex: 0, outcome: "failed" }],
    [{ kind: "tool", itemId: "two", order: 3, partIndex: 0, outcome: "completed" }],
    [{ kind: "tool", itemId: "two", order: 3, partIndex: 0, outcome: "completed" }],
  ];
  entries.forEach((entry, index) => { entry.presentation = { schemaVersion: "timeline-presentation.v1", messageId: "message",
    activitySeq: 8, entryIndex: index, entryCount: entries.length, references: refs[index]! }; });
  return { characterId: "taki", messageId: "message", activitySeq: 8, entries };
}

function visible() {
  const state = useChatTimelineStore.getState();
  return projectChatTranscript(state.entries, state.live.turns);
}

beforeEach(() => useChatTimelineStore.getState().reset());

describe("one canonical/live Chat transcript", () => {
  it("buffers ordinary appends and atomically keeps text/tool/text/tool keys and outcomes through a complete batch", () => {
    const store = useChatTimelineStore.getState();
    store.appendLive(row(1, "user", [{ type: "text", text: "question" }]));
    store.applyActivity({ snapshot: active, stale: false });
    const before = visible();
    const committed = batch();
    for (const entry of committed.entries) {
      store.appendLive(entry);
      expect(visible().map((item) => item.key)).toEqual(before.map((item) => item.key));
      expect(useChatTimelineStore.getState().entries).toHaveLength(1);
    }
    store.commitBatch(committed);
    const after = visible();
    expect(after.map((item) => item.key)).toEqual(before.map((item) => item.key));
    expect(after.map((item) => item.kind)).toEqual(["user", "text", "tool", "text", "tool"]);
    expect(after.filter((item) => item.kind === "tool").map((item) => item.status))
      .toMatchObject([{ phase: "settled", outcome: "failed" }, { phase: "settled", outcome: "completed" }]);
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    expect(useChatTimelineStore.getState().live.pendingEntries).toEqual([]);
    store.applyActivity({ snapshot: { ...active, status: "terminal", seq: 9, outcome: "completed" }, stale: false });
    store.commitBatch(committed);
    expect(visible().map((item) => item.key)).toEqual(before.map((item) => item.key));
  });

  it("keeps a terminal live turn until its entire batch has arrived across history pages", () => {
    const store = useChatTimelineStore.getState();
    store.appendLive(row(1, "user", [{ type: "text", text: "question" }]));
    store.applyActivity({ snapshot: { ...active, status: "terminal", seq: 9, outcome: "failed" }, stale: false });
    const committed = batch();
    store.mergeHistory({ entries: committed.entries.slice(2).reverse(), nextBefore: 4 });
    expect(useChatTimelineStore.getState().live.turns).toHaveLength(1);
    expect(visible()).toHaveLength(5);
    store.prependOlder({ entries: committed.entries.slice(0, 2).reverse(), nextBefore: 2 });
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    expect(visible().filter((item) => item.kind === "tool")).toHaveLength(2);
    expect(completeTimelineBatch(committed.entries.slice(2), "message")).toBeNull();
    expect(needsEarlierBatchPage(committed.entries.slice(2), new Set(["message"]))).toBe(true);
    expect(needsEarlierBatchPage([committed.entries[0]!, committed.entries[3]!], new Set(["message"]))).toBe(false);
  });

  it("recovers a lost batch push from all committed appends and accepts an empty commit without a blank row", () => {
    const store = useChatTimelineStore.getState();
    store.applyActivity({ snapshot: active, stale: false });
    const committed = batch();
    for (const entry of [...committed.entries].reverse()) store.appendLive(entry);
    store.applyActivity({ snapshot: { ...active, status: "terminal", seq: 9, outcome: "completed" }, stale: false });
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    expect(visible()).toHaveLength(4);
    store.applyActivity({ snapshot: { ...identity, messageId: "empty", seq: 1, status: "active", items: [] }, stale: false });
    store.commitBatch({ characterId: "taki", messageId: "empty", activitySeq: 1, entries: [] });
    expect(visible()).toHaveLength(4);
    expect(useChatTimelineStore.getState().live.covered.has("empty")).toBe(true);
  });

  it("pairs reused legacy IDs only inside their sequential call/result scope and never spins an orphan", () => {
    const call: TimelinePart = { type: "tool-call", toolCallId: "same", toolName: "echo" };
    const result: TimelinePart = { type: "tool-result", toolCallId: "same", toolName: "echo", output: { type: "json", value: { ok: true } } };
    const entries = [row(1, "assistant", [call]), row(2, "tool", [result]),
      row(3, "assistant", [{ type: "text", text: "B" }, call]), row(4, "tool", [{ ...result, output: { type: "json", value: { ok: false } } }]),
      row(5, "user", [{ type: "text", text: "new question" }]), row(6, "assistant", [call])];
    const tools = projectChatTranscript(entries, []).filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(3);
    expect(new Set(tools.map((item) => item.key)).size).toBe(3);
    expect(tools.map((item) => item.status)).toMatchObject([
      { phase: "settled", outcome: "completed" }, { phase: "settled", outcome: "failed" }, { phase: "settled", outcome: "outcome_unknown" },
    ]);
  });

  it("retains canonical text outside optional reference spans without copying it into metadata", () => {
    const entry = row(1, "assistant", [{ type: "text", text: "prefix A suffix" }]);
    entry.presentation = { schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: 0, entryCount: 1,
      activitySeq: 2, references: [{ kind: "text", itemId: "a", order: 0, partIndex: 0, start: 7, end: 8 }] };
    const items = projectChatTranscript([entry], []);
    expect(items.filter((item) => item.kind === "text").map((item) => item.text).join("")).toBe("prefix A suffix");
    expect(JSON.stringify(entry.presentation)).not.toContain("prefix");
  });

  it("degrades cross-page item collisions to readable canonical text and a single sequential tool pair", () => {
    const entries = [
      row(2, "assistant", [{ type: "text", text: "A" }]),
      row(3, "assistant", [{ type: "tool-call", toolCallId: "call", toolName: "echo" }]),
      row(4, "tool", [{ type: "tool-result", toolCallId: "call", toolName: "echo", output: { type: "json", value: "useful result" } }]),
    ];
    const references: TimelinePresentation["references"][] = [
      [{ kind: "text", itemId: "collision", order: 0, start: 0, end: 1, partIndex: 0 }],
      [{ kind: "tool", itemId: "collision", order: 0, partIndex: 0 }],
      [{ kind: "tool", itemId: "collision", order: 0, partIndex: 0, outcome: "completed" }],
    ];
    entries.forEach((entry, index) => { entry.presentation = { schemaVersion: "timeline-presentation.v1", messageId: "message",
      activitySeq: 8, entryIndex: index, entryCount: entries.length, references: references[index]! }; });
    const canonicalBefore = JSON.stringify(entries);
    const store = useChatTimelineStore.getState();
    store.mergeHistory({ entries: entries.slice(1).reverse(), nextBefore: 3 });
    store.prependOlder({ entries: entries.slice(0, 1), nextBefore: null });
    const items = visible();
    expect(items.map((item) => item.kind)).toEqual(["text", "tool"]);
    expect(items[0]).toMatchObject({ text: "A" });
    expect(items[1]).toMatchObject({ output: { value: "useful result" }, status: { phase: "settled", outcome: "completed" } });
    expect(JSON.stringify(entries)).toBe(canonicalBefore);
    expect(completeTimelineBatch(entries, "message")?.entries.every((entry) => entry.presentation?.references.length === 0)).toBe(true);
  });

  it("completes a lost-commit handoff when a row's invalid references were removed at the Shared boundary", () => {
    const entries = [
      row(2, "assistant", [{ type: "text", text: "A" }, { type: "tool-call", toolCallId: "call", toolName: "echo" }]),
      row(3, "tool", [{ type: "tool-result", toolCallId: "call", toolName: "echo", output: { type: "json", value: "canonical result" } }]),
    ];
    entries[0]!.presentation = { schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: 0, entryCount: 2,
      activitySeq: 8, references: [
        { kind: "text", itemId: "collision", order: 0, partIndex: 0, start: 0, end: 1 },
        { kind: "tool", itemId: "collision", order: 1, partIndex: 1 },
      ] };
    entries[1]!.presentation = { schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: 1, entryCount: 2,
      activitySeq: 8, references: [{ kind: "tool", itemId: "collision", order: 1, partIndex: 0, outcome: "completed" }] };
    const store = useChatTimelineStore.getState();
    store.applyActivity({ snapshot: active, stale: false });
    for (const entry of entries) store.appendLive(TimelineEntrySchema.parse(entry));
    expect(useChatTimelineStore.getState().live.turns).toHaveLength(1);
    store.applyActivity({ snapshot: { ...active, status: "terminal", seq: 9, outcome: "completed" }, stale: false });
    expect(useChatTimelineStore.getState().live.turns).toEqual([]);
    expect(useChatTimelineStore.getState().live.covered.has("message")).toBe(true);
    expect(visible().map((item) => item.kind)).toEqual(["text", "tool"]);
    expect(visible().find((item) => item.kind === "tool")).toMatchObject({ output: { value: "canonical result" } });
  });
});
