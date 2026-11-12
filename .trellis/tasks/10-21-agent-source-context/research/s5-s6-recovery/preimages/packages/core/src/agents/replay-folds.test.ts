import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelinePart } from "@taki/shared";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { ARGS_FOLD_FLOOR_CHARS, foldUnderPressure, SNAPSHOT_KEEP_WINDOW } from "./replay-folds.ts";
import { toModelMessage } from "./turn-mapping.ts";

let nextSeq = 0;
function row(role: TimelineEntry["role"], content: string, parts?: TimelinePart[]): TimelineEntry {
  nextSeq += 1;
  return {
    seq: nextSeq,
    id: "00000000-0000-4000-8000-000000000000",
    characterId: "taki",
    role,
    content,
    parts,
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

/** A state-snapshot tool result: the payload carries the Q5 capturedAt marker. */
function snapshotRow(toolName: string, payload: string, capturedAt: string): TimelineEntry {
  return row("tool", `[tool-result: ${toolName}]`, [
    { type: "tool-result", toolCallId: `c${nextSeq + 1}`, toolName, output: { type: "json", value: { ok: true, payload, capturedAt } } },
  ]);
}

/** A fact-class tool result (no capturedAt — exec output, memory hits). */
function factRow(toolName: string, payload: string): TimelineEntry {
  return row("tool", `[tool-result: ${toolName}]`, [
    { type: "tool-result", toolCallId: `c${nextSeq + 1}`, toolName, output: { type: "json", value: { ok: true, payload } } },
  ]);
}

function callRow(toolName: string, input: unknown): TimelineEntry {
  return row("assistant", `[tool-call: ${toolName}]`, [
    { type: "tool-call", toolCallId: `c${nextSeq + 1}`, toolName, input },
  ]);
}

function costOf(entries: TimelineEntry[]): number {
  return entries.reduce((sum, entry) => {
    const message = toModelMessage(entry);
    return sum + (message === null ? 0 : estimateMessageTokens(message));
  }, 0);
}

function outputValue(entry: TimelineEntry): unknown {
  const part = entry.parts?.[0];
  return part?.type === "tool-result" ? part.output : undefined;
}

const BIG = "x".repeat(400);

describe("foldUnderPressure — pressure gating (T5-R4: only under pressure)", () => {
  it("under budget returns the entries UNTOUCHED (zero folds, same reference)", () => {
    const entries = [snapshotRow("screenshot", BIG, "2026-08-01T14:02:00.000Z"), row("user", "hi")];
    const result = foldUnderPressure(entries, costOf(entries));

    expect(result.entries).toBe(entries);
    expect(result.estimatedTokens).toBe(costOf(entries));
  });

  it("an infinite budget (legacy unmeasured mode) skips estimation entirely", () => {
    const entries = [factRow("exec", BIG)];
    const result = foldUnderPressure(entries, Number.POSITIVE_INFINITY);

    expect(result.entries).toBe(entries);
    expect(result.estimatedTokens).toBe(0);
  });

  it("stops as soon as the view fits — later candidates stay unfolded", () => {
    const first = snapshotRow("screenshot", BIG, "2026-08-01T10:00:00.000Z");
    const entries = [
      first,
      snapshotRow("screenshot", BIG, "2026-08-01T11:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T12:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T13:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T14:00:00.000Z"),
    ];
    // Budget admits everything minus one payload: folding the single beyond-window snapshot (the oldest) suffices.
    const result = foldUnderPressure(entries, costOf(entries) - 50);

    expect(JSON.stringify(outputValue(result.entries[0]!))).toContain("result folded");
    // The second snapshot is ALSO beyond the keep window (5 - 3 = 2 candidates) but the loop stopped after one.
    expect(JSON.stringify(outputValue(result.entries[1]!))).toContain(BIG);
  });
});

describe("foldUnderPressure — snapshot class (rb keep-window 3 per toolName)", () => {
  it("folds snapshot results beyond the newest 3 per toolName; the kept window survives byte-stable", () => {
    nextSeq = 0;
    const entries = [
      snapshotRow("screenshot", BIG, "2026-08-01T10:02:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T11:02:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T12:02:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T13:02:00.000Z"),
    ];
    const result = foldUnderPressure(entries, 0);

    const folded = JSON.stringify(outputValue(result.entries[0]!));
    expect(folded).toContain("[screenshot] result folded — captured 10:02,");
    expect(folded).not.toContain(BIG);
    for (const kept of result.entries.slice(1)) expect(JSON.stringify(outputValue(kept))).toContain(BIG);
  });

  it("counts the keep window PER toolName — a different snapshot tool keeps its own newest 3", () => {
    const entries = [
      snapshotRow("screenshot", BIG, "2026-08-01T10:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T11:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T12:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T13:00:00.000Z"),
      snapshotRow("process_list", BIG, "2026-08-01T13:30:00.000Z"),
    ];
    const result = foldUnderPressure(entries, 0);

    expect(JSON.stringify(outputValue(result.entries[0]!))).toContain("result folded");
    // process_list has one instance — well inside ITS window — so it survives even at budget 0.
    expect(JSON.stringify(outputValue(result.entries[4]!))).toContain(BIG);
    expect(SNAPSHOT_KEEP_WINDOW).toBe(3);
  });

  it("renders the trace time from the capturedAt stamp and the char count from the folded payload", () => {
    const payload = "y".repeat(300);
    const entries = [
      snapshotRow("screenshot", payload, "2026-08-01T14:02:31.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T15:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T16:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T17:00:00.000Z"),
    ];
    const before = JSON.stringify((outputValue(entries[0]!) as { value: unknown }).value);
    const result = foldUnderPressure(entries, 0);

    const part = result.entries[0]!.parts?.[0];
    expect(part?.type === "tool-result" && part.output).toEqual({
      type: "text",
      value: `[screenshot] result folded — captured 14:02, ${before.length} chars`,
    });
  });
});

describe("foldUnderPressure — fact class and args (stages b/c)", () => {
  it("folds fact-class results oldest-first only after the snapshot stage, trace without a time segment", () => {
    const entries = [
      factRow("exec", BIG),
      factRow("exec", "short"),
      row("user", "还在吗"),
    ];
    const result = foldUnderPressure(entries, 0);

    const folded = JSON.stringify(outputValue(result.entries[0]!));
    expect(folded).toContain("[exec] result folded — ");
    expect(folded).not.toContain("captured");
    expect(folded).not.toContain(BIG);
    // The tiny payload is SMALLER than its trace would be — folding it loses information for nothing, so it stays.
    expect(JSON.stringify(outputValue(result.entries[1]!))).toContain("short");
  });

  it("folds tool-call args only above the size floor", () => {
    const bigInput = { command: "z".repeat(ARGS_FOLD_FLOOR_CHARS * 2) };
    const chars = JSON.stringify(bigInput).length;
    const entries = [callRow("exec", bigInput), callRow("exec", { command: "dir" })];
    const result = foldUnderPressure(entries, 0);

    const foldedPart = result.entries[0]!.parts?.[0];
    expect(foldedPart?.type === "tool-call" && foldedPart.input).toBe(`[exec] called (args folded, ${chars} chars)`);
    const keptPart = result.entries[1]!.parts?.[0];
    expect(keptPart?.type === "tool-call" && keptPart.input).toEqual({ command: "dir" });
  });

  it("NEVER folds user rows or assistant prose (v1 gradient mapping)", () => {
    const entries = [
      row("user", "我".repeat(500)),
      row("assistant", "长".repeat(500)),
      factRow("exec", BIG),
    ];
    const result = foldUnderPressure(entries, 0);

    expect(result.entries[0]).toBe(entries[0]);
    expect(result.entries[1]).toBe(entries[1]);
  });
});

describe("foldUnderPressure — idempotence + storage isolation (ADR 0008)", () => {
  it("double application over the same input is byte-identical", () => {
    nextSeq = 0;
    const build = () => {
      nextSeq = 0;
      return [
        snapshotRow("screenshot", BIG, "2026-08-01T10:00:00.000Z"),
        snapshotRow("screenshot", BIG, "2026-08-01T11:00:00.000Z"),
        snapshotRow("screenshot", BIG, "2026-08-01T12:00:00.000Z"),
        snapshotRow("screenshot", BIG, "2026-08-01T13:00:00.000Z"),
        factRow("exec", BIG),
        callRow("exec", { command: "q".repeat(300) }),
      ];
    };
    const once = foldUnderPressure(build(), 10);
    const twice = foldUnderPressure(build(), 10);

    expect(JSON.stringify(once.entries)).toBe(JSON.stringify(twice.entries));
    expect(once.estimatedTokens).toBe(twice.estimatedTokens);
  });

  it("never mutates the input entries (copy-on-fold)", () => {
    const entries = [
      snapshotRow("screenshot", BIG, "2026-08-01T10:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T11:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T12:00:00.000Z"),
      snapshotRow("screenshot", BIG, "2026-08-01T13:02:00.000Z"),
      factRow("exec", BIG),
    ];
    const before = JSON.stringify(entries);
    foldUnderPressure(entries, 0);

    expect(JSON.stringify(entries)).toBe(before);
  });
});
