import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { MESSAGE_OVERHEAD } from "../memory/token-estimator.ts";
import { selectWindow } from "./context-window.ts";

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

describe("selectWindow (batch 6 — the ONE window boundary)", () => {
  it("cuts by tokens newest-first: the newest rows fit, the oldest fall off", () => {
    const entries = [user(1), user(2), user(3), user(4), user(5)];
    // Budget for exactly 3 rows of 5: 15.
    const { entries: kept, windowStartSeq, estimatedTokens } = selectWindow(entries, COST * 3, 100);
    expect(kept.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(windowStartSeq).toBe(3);
    expect(estimatedTokens).toBe(COST * 3);
  });

  it("the maxMessages backstop wins when the estimator undercounts (huge budget)", () => {
    const entries = [user(1), user(2), user(3), user(4), user(5)];
    const { entries: kept, windowStartSeq } = selectWindow(entries, 1_000_000, 2);
    expect(kept.map((e) => e.seq)).toEqual([4, 5]);
    expect(windowStartSeq).toBe(4);
  });

  it("drops a leading tool row stranded by the token cut (invalid replay input)", () => {
    // Budget admits the tool row + the newest user row, but NOT the assistant row carrying the tool-call.
    const entries = [user(1, "aaaa".repeat(30)), toolRow(2), user(3, "next")];
    const toolCost = 4 + Math.ceil('{"type":"text","value":"x"}'.length / 4);
    const { entries: kept, windowStartSeq, estimatedTokens } = selectWindow(entries, COST + toolCost, 100);
    expect(kept.map((e) => e.seq)).toEqual([3]);
    expect(windowStartSeq).toBe(3);
    // The dropped tool row's cost does not count toward the kept estimate.
    expect(estimatedTokens).toBe(COST);
  });

  it("keeps a single oversized newest entry (window of one, never an empty replay)", () => {
    const entries = [user(1), user(2, "一".repeat(500))];
    const { entries: kept, windowStartSeq } = selectWindow(entries, 10, 100);
    expect(kept.map((e) => e.seq)).toEqual([2]);
    expect(windowStartSeq).toBe(2);
  });

  it("empty input -> empty window, windowStartSeq 1 (nothing exists, nothing has left)", () => {
    expect(selectWindow([], 100, 100)).toEqual({ entries: [], windowStartSeq: 1, estimatedTokens: 0 });
  });

  it("an all-tool window drops everything; windowStartSeq marks everything as left", () => {
    const { entries: kept, windowStartSeq } = selectWindow([toolRow(7), toolRow(8)], 1_000, 100);
    expect(kept).toEqual([]);
    expect(windowStartSeq).toBe(9);
  });

  it("an infinite budget degrades to the legacy message-count window (backstop only, zero estimation)", () => {
    const entries = [toolRow(1), user(2), user(3)];
    const selection = selectWindow(entries, Number.POSITIVE_INFINITY, 200);
    expect(selection.entries.map((e) => e.seq)).toEqual([2, 3]); // leading-tool-drop still applies
    expect(selection.windowStartSeq).toBe(2);
    expect(selection.estimatedTokens).toBe(0);
  });

  it("seq gaps (retracted rows) do not confuse the boundary — it is the kept head's real seq", () => {
    const entries = [user(10), user(40), user(90)];
    const { windowStartSeq } = selectWindow(entries, COST * 2, 100);
    expect(windowStartSeq).toBe(40);
  });
});
