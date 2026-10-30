import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineHistoryParams, TimelineHistoryResult } from "@taki/shared";
import { readChatHistory } from "./read-chat-history.ts";
import { completeTimelineBatch } from "./timeline-batch.ts";

function row(index: number): TimelineEntry {
  return { seq: index + 3, id: `00000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`, characterId: "taki",
    role: "assistant", content: `canonical ${index}`, createdAt: "2026-09-07T00:00:00.000Z",
    presentation: { schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: index, entryCount: 4,
      activitySeq: 12, references: [] } };
}

describe("complete live-batch history recovery", () => {
  it("recovers multiple pending batches absent from page one, bounded by their known anchors", async () => {
    const entries: TimelineEntry[] = Array.from({ length: 1_354 }, (_, index) => ({
      ...row(0), seq: index + 1, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, content: `history ${index + 1}`, presentation: undefined,
    }));
    for (const [messageId, anchor] of [["older", 1_000], ["later", 1_100]] as const) {
      for (let index = 0; index < 4; index += 1) {
        const value = row(index);
        entries[anchor + index] = { ...value, seq: anchor + index + 1, id: `00000000-0000-4000-8000-${String(anchor + index + 1).padStart(12, "0")}`,
          presentation: { ...value.presentation!, messageId } };
      }
    }
    const requests: TimelineHistoryParams[] = [];
    const result = await readChatHistory({ characterId: "taki", messageIds: new Set(["older", "later"]),
      messageAnchors: new Map([["older", 1_000], ["later", 1_100]]), isCurrent: () => true,
      client: { async timelineHistory(params) {
        requests.push(params);
        const available = entries.filter((entry) => params.before === undefined || entry.seq < params.before).reverse();
        const page = available.slice(0, params.limit);
        return { entries: page, nextBefore: available.length > page.length ? page.at(-1)!.seq : null };
      } } });
    expect(requests).toHaveLength(3);
    expect(completeTimelineBatch(result.entries, "older")?.entries).toHaveLength(4);
    expect(completeTimelineBatch(result.entries, "later")?.entries).toHaveLength(4);
    expect(result.nextBefore).toBe(905); // The last bounded page reaches the anchors; older unrelated history stays unread.
  });

  it("bridges a reconnect gap to the prior canonical tail even with no pending live turn", async () => {
    const requests: TimelineHistoryParams[] = [];
    const pages: TimelineHistoryResult[] = [
      { entries: [{ ...row(0), seq: 90, presentation: undefined }], nextBefore: 90 },
      { entries: [{ ...row(0), seq: 30, presentation: undefined }], nextBefore: 30 },
    ];
    const result = await readChatHistory({ characterId: "taki", messageIds: new Set(), afterSeq: 50, isCurrent: () => true,
      client: { async timelineHistory(params) { requests.push(params); return pages.shift()!; } } });
    expect(requests).toHaveLength(2);
    expect(result.entries.map((entry) => entry.seq)).toEqual([90, 30]);
  });

  it("stops at a known turn anchor when corrupt batch metadata leaves an unrecoverable prefix", async () => {
    const pages: TimelineHistoryResult[] = [
      { entries: [{ ...row(3), seq: 1_100 }], nextBefore: 1_100 },
      { entries: [{ ...row(0), seq: 900, presentation: undefined }], nextBefore: 900 },
    ];
    let reads = 0;
    const result = await readChatHistory({ characterId: "taki", messageIds: new Set(["message"]),
      messageAnchors: new Map([["message", 1_000]]), isCurrent: () => true,
      client: { async timelineHistory() { reads += 1; return pages.shift()!; } } });
    expect(reads).toBe(2);
    expect(completeTimelineBatch(result.entries, "message")).toBeNull();
    expect(result.nextBefore).toBe(900);
  });

  it("fetches the missing older batch prefix and stops when coverage is complete", async () => {
    const requests: TimelineHistoryParams[] = [];
    const pages: TimelineHistoryResult[] = [
      { entries: [row(3), row(2)], nextBefore: 5 }, { entries: [row(1), row(0)], nextBefore: 3 },
    ];
    const result = await readChatHistory({ characterId: "taki", messageIds: new Set(["message"]), isCurrent: () => true,
      client: { async timelineHistory(params) { requests.push(params); return pages.shift()!; } } });
    expect(requests).toEqual([{ characterId: "taki", limit: 50 }, { characterId: "taki", before: 5, limit: 200 }]);
    expect(result.entries.map((entry) => entry.seq)).toEqual([6, 5, 4, 3]);
    expect(result.nextBefore).toBe(3);
    expect(result.entries.map((entry) => entry.content)).toEqual(["canonical 3", "canonical 2", "canonical 1", "canonical 0"]);
  });

  it("does not scan unrelated history and bounds a non-progressing cursor", async () => {
    let calls = 0;
    const client = { async timelineHistory() { calls += 1;
      return calls === 1 ? { entries: [row(3)], nextBefore: 6 } : { entries: [], nextBefore: 6 }; } };
    await readChatHistory({ client, characterId: "taki", messageIds: new Set(["other"]), isCurrent: () => true });
    expect(calls).toBe(1);
    calls = 0;
    const result = await readChatHistory({ client, characterId: "taki", messageIds: new Set(["message"]), isCurrent: () => true });
    expect(calls).toBe(2);
    expect(result.entries).toHaveLength(1);
  });

  it("does not page after retirement and rejects a response for a different Character", async () => {
    let calls = 0;
    let current = true;
    await readChatHistory({ characterId: "taki", messageIds: new Set(["message"]), isCurrent: () => current,
      client: { async timelineHistory() { calls += 1; current = false; return { entries: [row(3)], nextBefore: 6 }; } } });
    expect(calls).toBe(1);
    await expect(readChatHistory({ characterId: "taki", messageIds: new Set(["message"]), isCurrent: () => true,
      client: { async timelineHistory() { return { entries: [{ ...row(3), characterId: "other" }], nextBefore: null }; } } }))
      .rejects.toThrow("Character mismatch");
  });
});
