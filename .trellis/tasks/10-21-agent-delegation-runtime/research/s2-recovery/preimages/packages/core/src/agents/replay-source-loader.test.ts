import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { loadReplaySource } from "./replay-source-loader.ts";

function user(seq: number, content = `m${seq}`): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role: "user", content, createdAt: "2026-08-29T00:00:00.000Z" };
}

function call(seq: number, callId: string): TimelineEntry {
  return { ...user(seq), role: "assistant", content: "[tool-call: exec]", parts: [{ type: "tool-call", toolCallId: callId, toolName: "exec" }] };
}

function result(seq: number, callId: string): TimelineEntry {
  return { ...user(seq), role: "tool", content: "[tool-result: exec -> text]", parts: [{ type: "tool-result", toolCallId: callId, toolName: "exec", output: { type: "text", value: "ok" } }] };
}

function pagingRepo(rows: TimelineEntry[], calls: { count: number }): TimelineRepo {
  const newestFirst = [...rows].sort((left, right) => right.seq - left.seq);
  return {
    pageBefore: ({ before, limit }) => {
      calls.count += 1;
      const eligible = newestFirst.filter((entry) => before === undefined || entry.seq < before);
      const entries = eligible.slice(0, limit);
      return { entries, nextBefore: eligible.length > limit ? entries.at(-1)?.seq ?? null : null };
    },
    append: () => { throw new Error("unused"); },
    appendBatch: () => { throw new Error("unused"); },
    deleteEntry: () => undefined,
    latestAscending: () => [],
    latestSeq: () => 0,
    rangeAscending: () => [],
  };
}

describe("loadReplaySource", () => {
  it("stops loading once the token candidate budget is satisfied", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => user(index + 1));
    const calls = { count: 0 };
    const source = loadReplaySource({ repo: pagingRepo(rows, calls), characterId: "taki", throughSeq: 0,
      candidateBudget: 15, pageSize: 200, maxRows: 10_000 });

    expect(source.entries.map((entry) => entry.seq)).toEqual([998, 999, 1_000]);
    expect(source.loadedRows).toBe(3);
    expect(source.backstopHit).toBe(false);
    expect(calls.count).toBe(1);
  });

  it("continues past a newest result until its older call is loaded", () => {
    const calls = { count: 0 };
    const source = loadReplaySource({ repo: pagingRepo([call(1, "c1"), result(2, "c1")], calls),
      characterId: "taki", throughSeq: 0, candidateBudget: 1, pageSize: 1, maxRows: 10 });

    expect(source.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(source.loadedRows).toBe(2);
    expect(source.backstopHit).toBe(false);
    expect(calls.count).toBe(2);
  });

  it("honors a minimum suffix and overscans one older row for a retirement boundary", () => {
    const calls = { count: 0 };
    const source = loadReplaySource({ repo: pagingRepo(Array.from({ length: 20 }, (_, index) => user(index + 1)), calls),
      characterId: "taki", throughSeq: 0, candidateBudget: 15, minimumRows: 3, pageSize: 200, maxRows: 10_000 });

    // Three short rows satisfy the token candidate; the fourth row is the older unit that makes a retirement edge
    // possible. Without this overscan, an exact token crossing could look like "retain everything" to the selector.
    expect(source.entries.map((entry) => entry.seq)).toEqual([17, 18, 19, 20]);
    expect(source.loadedRows).toBe(4);
    expect(source.backstopHit).toBe(false);
  });

  it("reports the explicit row ceiling only when neither token selection nor history end stopped the load", () => {
    const calls = { count: 0 };
    const source = loadReplaySource({ repo: pagingRepo(Array.from({ length: 20 }, (_, index) => user(index + 1)), calls),
      characterId: "taki", throughSeq: 0, candidateBudget: 1_000, pageSize: 2, maxRows: 3 });

    expect(source.loadedRows).toBe(3);
    expect(source.backstopHit).toBe(true);
    expect(source.summaryBridgeReached).toBe(false);
    expect(calls.count).toBe(2);
  });
});
