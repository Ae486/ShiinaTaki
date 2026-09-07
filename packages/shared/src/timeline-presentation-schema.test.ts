import { describe, expect, it } from "vitest";
import { TimelineCommittedSchema, TimelineEntrySchema, TimelineHistoryResultSchema } from "./timeline-schema.ts";
import { TimelinePresentationSchema, validTimelinePresentation } from "./timeline-presentation-schema.ts";

const row = { seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki", role: "assistant",
  content: "AB", createdAt: "2026-09-07T00:00:00.000Z" };
const presentation = { schemaVersion: "timeline-presentation.v1", messageId: "accepted-message", entryIndex: 0,
  entryCount: 1, activitySeq: 4, references: [{ kind: "text", itemId: "A", order: 0, start: 0, end: 2 }] };

describe("optional Timeline presentation", () => {
  it("references plain canonical text without manufacturing parts or another batch identity", () => {
    const value = TimelineEntrySchema.parse({ ...row, presentation });
    expect(value.presentation).toEqual(presentation);
    expect(value).not.toHaveProperty("parts");
    expect(value.content).toBe("AB");
    expect(TimelinePresentationSchema.safeParse({ ...presentation, commitId: "second-identity" }).success).toBe(false);
  });

  it("preserves distinct language spans on either side of a tool inside one canonical text part", () => {
    const parts = [{ type: "text", text: "AB" }, { type: "tool-call", toolCallId: "call", toolName: "route" }];
    const metadata = { ...presentation, references: [
      { kind: "text", itemId: "A", order: 0, partIndex: 0, start: 0, end: 1 },
      { kind: "tool", itemId: "tool", order: 1, partIndex: 1, outcome: "outcome_unknown" },
      { kind: "text", itemId: "B", order: 2, partIndex: 0, start: 1, end: 2 },
    ] };
    expect(TimelineEntrySchema.parse({ ...row, parts, presentation: metadata })).toEqual({ ...row, parts, presentation: metadata });
  });

  it("omits invalid batch headers but retains valid coverage when optional references are unusable", () => {
    const malformed = [null, "bad", { ...presentation, input: {} }, { ...presentation, entryIndex: 1 }];
    for (const value of malformed) expect(TimelineEntrySchema.parse({ ...row, presentation: value })).toEqual(row);
    const invalidReferences = [
      { ...presentation, references: [{ ...presentation.references[0], end: 3 }] },
      { ...presentation, references: [presentation.references[0], presentation.references[0]] },
      { ...presentation, references: [{ kind: "tool", itemId: "tool", order: 0, partIndex: 0 }] }];
    for (const value of invalidReferences) {
      expect(validTimelinePresentation(value, row)).toBeUndefined();
      expect(TimelineEntrySchema.parse({ ...row, presentation: value })).toEqual({ ...row, presentation: { ...presentation, references: [] } });
    }
    expect(TimelineEntrySchema.safeParse({ ...row, content: null, presentation }).success).toBe(false);
  });

  it("rejects item kind, order and canonical tool collisions inside a row without losing its content", () => {
    const parts = [{ type: "text", text: "AB" },
      { type: "tool-call", toolCallId: "one", toolName: "echo" },
      { type: "tool-call", toolCallId: "two", toolName: "echo" }];
    const text = { kind: "text", itemId: "text", order: 0, partIndex: 0, start: 0, end: 2 };
    const call = { kind: "tool", itemId: "tool", order: 1, partIndex: 1 };
    for (const references of [
      [text, { ...call, itemId: "text" }],
      [text, { ...call, order: 0 }],
      [text, call, { ...call, partIndex: 2 }],
    ]) {
      const metadata = { ...presentation, references };
      expect(validTimelinePresentation(metadata, { ...row, parts })).toBeUndefined();
      const parsed = TimelineEntrySchema.parse({ ...row, parts, presentation: metadata });
      expect(parsed.parts).toEqual(parts);
      expect(parsed.presentation).toEqual({ ...presentation, references: [] });
    }
  });

  it("keeps multiple non-overlapping spans for the same stable text item", () => {
    const metadata = { ...presentation, references: [
      { kind: "text", itemId: "text", order: 0, start: 0, end: 1 },
      { kind: "text", itemId: "text", order: 0, start: 1, end: 2 },
    ] };
    expect(validTimelinePresentation(metadata, row)).toEqual(metadata);
    expect(TimelineEntrySchema.parse({ ...row, presentation: metadata }).presentation).toEqual(metadata);
  });

  it("discards conflicting cross-row references while preserving complete batch identity and canonical tools", () => {
    const call = { type: "tool-call", toolCallId: "one", toolName: "echo" };
    const result = { type: "tool-result", toolCallId: "one", toolName: "echo", output: { type: "json", value: "useful result" } };
    const references = [{ kind: "tool", itemId: "invocation", order: 0, partIndex: 0, outcome: "completed" }];
    const first = { ...row, parts: [call], presentation: { ...presentation, entryCount: 2, references } };
    const second = { ...row, seq: 2, id: "550e8400-e29b-41d4-a716-446655440001", role: "tool", parts: [result],
      presentation: { ...presentation, entryIndex: 1, entryCount: 2, references } };
    const batch = { characterId: "taki", messageId: "accepted-message", activitySeq: 4, entries: [first, second] };
    expect(TimelineCommittedSchema.parse(batch)).toEqual(batch);
    for (const mismatch of [
      { ...second, parts: [{ ...result, toolCallId: "different-call" }] },
      { ...second, parts: [{ ...result, toolName: "different-tool" }] },
      { ...second, presentation: { ...second.presentation, references: [{ ...references[0], order: 1 }] } },
      { ...second, role: "assistant", parts: [{ type: "text", text: "AB" }],
        presentation: { ...second.presentation, references: [{ kind: "text", itemId: "invocation", order: 0, partIndex: 0, start: 0, end: 2 }] } },
    ]) {
      const values = [first, mismatch];
      const parsed = TimelineCommittedSchema.parse({ ...batch, entries: values });
      expect(parsed.entries.map((entry) => entry.parts)).toEqual(values.map((entry) => entry.parts));
      expect(parsed.entries.every((entry) => entry.presentation?.references.length === 0)).toBe(true);
      const history = TimelineHistoryResultSchema.parse({ entries: [...values].reverse(), nextBefore: null });
      expect(history.entries.every((entry) => entry.presentation?.references.length === 0)).toBe(true);
      expect(history.entries.map((entry) => entry.presentation?.messageId)).toEqual(["accepted-message", "accepted-message"]);
    }
  });

  it("accepts only complete Character/message/sequence-consistent commit batches, including an empty batch", () => {
    const batch = { characterId: "taki", messageId: "accepted-message", activitySeq: 4, entries: [{ ...row, presentation }] };
    expect(TimelineCommittedSchema.parse(batch)).toEqual(batch);
    expect(TimelineCommittedSchema.parse({ ...batch, entries: [] }).entries).toEqual([]);
    for (const bad of [
      { ...batch, characterId: "other" }, { ...batch, messageId: "other" }, { ...batch, activitySeq: 3 },
      { ...batch, entries: [{ ...row, presentation: { ...presentation, entryCount: 2 } }] },
      { ...batch, entries: [row] },
    ]) expect(TimelineCommittedSchema.safeParse(bad).success).toBe(false);
  });
});
