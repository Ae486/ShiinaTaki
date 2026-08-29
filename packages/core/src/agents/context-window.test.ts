import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { estimateMessageTokens, MESSAGE_OVERHEAD } from "../memory/token-estimator.ts";
import { selectWindow } from "./context-window.ts";
import { toModelMessage } from "./turn-mapping.ts";

// Each "mN"-style user row estimates MESSAGE_OVERHEAD + 1 (content under 4 ASCII chars) = 5 with the shipped constants.
const COST = MESSAGE_OVERHEAD + 1;

function user(seq: number, content = `m${seq}`): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role: "user", content, createdAt: "2026-08-01T00:00:00.000Z" };
}

function toolRow(seq: number): TimelineEntry {
  return {
    seq,
    id: `id-${seq}`,
    characterId: "taki",
    role: "tool",
    content: "[tool-result: exec -> text]",
    parts: [{ type: "tool-result", toolCallId: `c${seq}`, toolName: "exec", output: { type: "text", value: "x" } }],
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function callRow(seq: number, callId = `c${seq}`): TimelineEntry {
  return {
    seq,
    id: `id-${seq}`,
    characterId: "taki",
    role: "assistant",
    content: `[tool-call: exec]`,
    parts: [{ type: "tool-call", toolCallId: callId, toolName: "exec" }],
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function resultRow(seq: number, callId: string, value: string): TimelineEntry {
  return {
    ...toolRow(seq),
    parts: [{ type: "tool-result", toolCallId: callId, toolName: "exec", output: { type: "text", value } }],
  };
}

describe("selectWindow (batch 6 — the ONE window boundary)", () => {
  it("cuts by tokens newest-first: the newest rows fit, the oldest fall off", () => {
    const entries = [user(1), user(2), user(3), user(4), user(5)];
    // Budget for exactly 3 rows of 5: 15.
    const { entries: kept, windowStartSeq, estimatedTokens } = selectWindow(entries, COST * 3);
    expect(kept.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(windowStartSeq).toBe(3);
    expect(estimatedTokens).toBe(COST * 3);
  });

  it("does not apply a second silent row cap when the token budget admits the source", () => {
    const entries = Array.from({ length: 250 }, (_, index) => user(index + 1));
    const { entries: kept, windowStartSeq } = selectWindow(entries, 1_000_000);
    expect(kept).toHaveLength(250);
    expect(windowStartSeq).toBe(1);
  });

  it("drops a leading tool row stranded by the token cut (invalid replay input)", () => {
    // Budget admits the tool row + the newest user row, but NOT the assistant row carrying the tool-call.
    const entries = [user(1, "aaaa".repeat(30)), toolRow(2), user(3, "next")];
    const toolCost = 4 + Math.ceil('{"type":"text","value":"x"}'.length / 4);
    const { entries: kept, windowStartSeq, estimatedTokens } = selectWindow(entries, COST + toolCost);
    expect(kept.map((e) => e.seq)).toEqual([3]);
    expect(windowStartSeq).toBe(3);
    // The dropped tool row's cost does not count toward the kept estimate.
    expect(estimatedTokens).toBe(COST);
  });

  it("keeps a single oversized newest entry (window of one, never an empty replay)", () => {
    const entries = [user(1), user(2, "一".repeat(500))];
    const { entries: kept, windowStartSeq } = selectWindow(entries, 10);
    expect(kept.map((e) => e.seq)).toEqual([2]);
    expect(windowStartSeq).toBe(2);
  });

  it("empty input -> empty window, windowStartSeq 1 (nothing exists, nothing has left)", () => {
    expect(selectWindow([], 100)).toEqual({ entries: [], windowStartSeq: 1, estimatedTokens: 0 });
  });

  it("an all-tool window drops everything; windowStartSeq marks everything as left", () => {
    const { entries: kept, windowStartSeq } = selectWindow([toolRow(7), toolRow(8)], 1_000);
    expect(kept).toEqual([]);
    expect(windowStartSeq).toBe(9);
  });

  it("an infinite budget degrades to the legacy message-count window (backstop only, zero estimation)", () => {
    const entries = [toolRow(1), user(2), user(3)];
    const selection = selectWindow(entries, Number.POSITIVE_INFINITY);
    expect(selection.entries.map((e) => e.seq)).toEqual([2, 3]); // leading-tool-drop still applies
    expect(selection.windowStartSeq).toBe(2);
    expect(selection.estimatedTokens).toBe(0);
  });

  it("seq gaps (retracted rows) do not confuse the boundary — it is the kept head's real seq", () => {
    const entries = [user(10), user(40), user(90)];
    const { windowStartSeq } = selectWindow(entries, COST * 2);
    expect(windowStartSeq).toBe(40);
  });

  it("treats a tool call and its result as one selection unit", () => {
    const entries = [user(1, "x".repeat(200)), callRow(2, "pair"), resultRow(3, "pair", "x"), user(4, "next")];
    const selection = selectWindow(entries, COST + 11);
    expect(selection.entries.map((entry) => entry.seq)).toEqual([4]);
    expect(selection.windowStartSeq).toBe(4);
  });

  it("keeps an oversized newest tool pair whole rather than orphaning either side", () => {
    const entries = [user(1), callRow(2, "pair"), resultRow(3, "pair", "z".repeat(500))];
    const selection = selectWindow(entries, 1);
    expect(selection.entries.map((entry) => entry.seq)).toEqual([2, 3]);
  });

  it("keeps multiple calls and result rows as one atomic unit", () => {
    const entries = [
      user(1, "old"),
      {
        ...callRow(2, "c1"),
        parts: [
          { type: "tool-call" as const, toolCallId: "c1", toolName: "exec" },
          { type: "tool-call" as const, toolCallId: "c2", toolName: "exec" },
        ],
      },
      resultRow(3, "c1", "one"),
      resultRow(4, "c2", "two"),
      user(5, "new"),
    ];
    const pairCost = entries.slice(1, 4).reduce((sum, entry) => sum + estimate(entry), 0);
    const newestCost = estimate(entries[4]!);

    expect(selectWindow(entries, pairCost + newestCost - 1).entries.map((entry) => entry.seq)).toEqual([5]);
    expect(selectWindow(entries, pairCost + newestCost).entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5]);
  });

  it("merges overlapping call/result spans instead of cutting through either span", () => {
    const entries = [callRow(1, "c1"), callRow(2, "c2"), resultRow(3, "c1", "one"), resultRow(4, "c2", "two"), user(5, "new")];
    const pairCost = entries.slice(0, 4).reduce((sum, entry) => sum + estimate(entry), 0);
    const newestCost = estimate(entries[4]!);

    expect(selectWindow(entries, pairCost + newestCost - 1).entries.map((entry) => entry.seq)).toEqual([5]);
    expect(selectWindow(entries, pairCost + newestCost).entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops orphan and mixed corrupt tool rows rather than emitting invalid provider history", () => {
    const entries: TimelineEntry[] = [
      {
        ...toolRow(1),
        parts: [{ type: "tool-result", toolCallId: "missing", toolName: "exec", output: { type: "text", value: "x" } }],
      },
      {
        ...callRow(2, "missing-result"),
      },
      {
        ...toolRow(3),
        parts: [
          { type: "tool-result", toolCallId: "valid", toolName: "exec", output: { type: "text", value: "ok" } },
          { type: "tool-result", toolCallId: "also-missing", toolName: "exec", output: { type: "text", value: "bad" } },
        ],
      },
      user(4, "new"),
    ];

    expect(selectWindow(entries, Number.POSITIVE_INFINITY).entries.map((entry) => entry.seq)).toEqual([4]);
  });
});

function estimate(entry: TimelineEntry): number {
  const message = toModelMessage(entry);
  return message === null ? 0 : estimateMessageTokens(message);
}
