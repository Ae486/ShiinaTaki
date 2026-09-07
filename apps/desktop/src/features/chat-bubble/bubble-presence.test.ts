import { describe, expect, it } from "vitest";
import { initialBubblePresence, reconcileBubblePresence, settleBubbleRow, settleEmptyBubbleGroup,
  type BubblePresenceState } from "./bubble-presence.ts";
import type { BubbleTranscriptItem } from "./bubble-transcript.ts";

const text = (key: string, order: number, value = key): BubbleTranscriptItem => ({ key, order, kind: "text", text: value });
const tool = (key: string, order: number): BubbleTranscriptItem => ({ key, order, kind: "tool", toolName: "echo", stale: false,
  status: { phase: "executing" } });
const initial = (items: BubbleTranscriptItem[]) => initialBubblePresence({ transcript: { key: "turn", items }, presentationVersion: 1, motion: true });
const next = (state: BubblePresenceState, items: BubbleTranscriptItem[]) =>
  reconcileBubblePresence(state, { transcript: { key: "turn", items }, presentationVersion: 1, motion: true });

describe("Pet finite CSS presence", () => {
  it("crossfades a concurrent tool set into B in one envelope while keeping A and all semantic row keys", () => {
    const a = text("a", 0);
    const before = initial([a, tool("one", 1), tool("two", 2)]);
    expect(before.groups).toHaveLength(2);
    const after = next(before, [a, text("b", 3)]);
    expect(after.groups.map((group) => group.key)).toEqual(before.groups.map((group) => group.key));
    expect(after.groups[0]?.rows).toMatchObject([{ item: a, phase: "present" }]);
    expect(after.groups[1]?.rows).toMatchObject([
      { item: { key: "b", text: "b" }, phase: "entering" },
      { item: { key: "one" }, phase: "exiting" },
      { item: { key: "two" }, phase: "exiting" },
    ]);
    const during = next(after, [a, text("b", 3, "all incoming text immediately")]);
    expect(during.groups[1]?.rows[0]).toMatchObject({ item: { text: "all incoming text immediately" }, token: after.groups[1]?.rows[0]?.token });
  });

  it("keeps an empty tail envelope until its exact height transition releases all occupied space", () => {
    const a = text("a", 0);
    const before = initial([a, tool("one", 1)]);
    const exiting = next(before, [a]);
    const group = exiting.groups[1]!;
    const row = group.rows[0]!;
    const faded = settleBubbleRow(exiting, { groupKey: group.key, itemKey: row.item.key, token: row.token });
    expect(faded.groups[1]?.rows).toEqual([]);
    const released = settleEmptyBubbleGroup(faded, { groupKey: group.key, revision: group.revision });
    expect(released.groups.map((entry) => entry.key)).toEqual([before.groups[0]?.key]);
  });

  it("ignores stale row/group completions when an interrupted exit receives new text", () => {
    const a = text("a", 0);
    const before = initial([a, tool("one", 1)]);
    const exiting = next(before, [a]);
    const oldGroup = exiting.groups[1]!;
    const replacement = next(exiting, [a, text("b", 2)]);
    expect(settleEmptyBubbleGroup(replacement, { groupKey: oldGroup.key, revision: oldGroup.revision })).toBe(replacement);
    const b = replacement.groups[1]!.rows[0]!;
    expect(settleBubbleRow(replacement, { groupKey: oldGroup.key, itemKey: b.item.key, token: oldGroup.rows[0]!.token })).toBe(replacement);
    const settled = settleBubbleRow(replacement, { groupKey: oldGroup.key, itemKey: b.item.key, token: b.token });
    expect(settled.groups[1]?.rows[0]?.phase).toBe("present");
  });

  it.each(["reduced motion", "presentation retirement", "new turn"])("settles %s immediately with no obsolete exit queue", (boundary) => {
    const a = text("a", 0);
    const during = next(initial([a, tool("one", 1)]), [a, text("b", 2)]);
    const settled = reconcileBubblePresence(during, {
      transcript: { key: boundary === "new turn" ? "next" : "turn", items: boundary === "new turn" ? [text("c", 0)] : [a, text("b", 2)] },
      presentationVersion: boundary === "presentation retirement" ? 2 : 1,
      motion: boundary !== "reduced motion",
    });
    expect(settled.groups.every((group) => group.instant && group.rows.every((row) => row.phase === "present"))).toBe(true);
    expect(settled.groups.flatMap((group) => group.rows).some((row) => row.item.key === "one")).toBe(false);
  });

  it("does not replay entrance or change occupied identity on a tool phase update", () => {
    const before = initial([text("a", 0), tool("one", 1)]);
    const after = next(before, [text("a", 0), { ...tool("one", 1), kind: "tool", toolName: "echo", stale: false,
      status: { phase: "settled", outcome: "completed" } }]);
    expect(after.groups[1]).toMatchObject({ key: before.groups[1]?.key, revision: before.groups[1]?.revision,
      rows: [{ phase: "present", token: before.groups[1]?.rows[0]?.token }] });
  });
});
