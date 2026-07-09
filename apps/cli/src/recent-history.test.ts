import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineHistoryParams, TimelineHistoryResult } from "@taki/shared";
import { showRecentHistory, type TimelineReader } from "./recent-history.ts";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function entry(seq: number, role: "user" | "assistant", content: string): TimelineEntry {
  return { seq, id: UUID, characterId: "taki", role, content, createdAt: "2026-07-10T00:00:00.000Z" };
}

function stubReader(result: TimelineHistoryResult): { reader: TimelineReader; calls: TimelineHistoryParams[] } {
  const calls: TimelineHistoryParams[] = [];
  return {
    reader: {
      history: (params) => {
        calls.push(params);
        return Promise.resolve(result);
      },
    },
    calls,
  };
}

async function render(reader: TimelineReader): Promise<string> {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  await showRecentHistory({ reader, characterId: "taki", output });
  return text;
}

describe("showRecentHistory", () => {
  it("T8 requests the last 5 entries and prints them oldest-first", async () => {
    // history() returns newest-first (seq 3, 2, 1).
    const { reader, calls } = stubReader({
      entries: [entry(3, "assistant", "third"), entry(2, "user", "second"), entry(1, "user", "first")],
      nextBefore: null,
    });

    const text = await render(reader);

    expect(calls[0]).toEqual({ characterId: "taki", limit: 5 });
    expect(text).toContain("--- last 3 message(s) ---");
    expect(text.indexOf("first")).toBeLessThan(text.indexOf("second"));
    expect(text.indexOf("second")).toBeLessThan(text.indexOf("third"));
  });

  it("prints nothing when the timeline is empty", async () => {
    const { reader } = stubReader({ entries: [], nextBefore: null });
    expect(await render(reader)).toBe("");
  });
});
