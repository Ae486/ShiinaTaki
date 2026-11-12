import { describe, expect, it, vi } from "vitest";
import { SubagentConversationPages } from "./subagent-conversation-pages.ts";
import type { SubagentClient } from "./subagent-state.ts";
import { conversation } from "../../../test/subagent-conversation-fixture.ts";
import { CHILD_A, CHILD_B } from "../../../test/s7-subagent-data.ts";

function fixture() {
  const all = conversation();
  const request = vi.fn(async () => all);
  const body = vi.fn<SubagentClient["subagentConversationBody"]>();
  const client = { subagentConversation: request, subagentConversationBody: body } as unknown as SubagentClient;
  return { all, request, body, pages: new SubagentConversationPages(), scope: { client, characterId: "taki", current: () => true } };
}

describe("continuous private conversation reads", () => {
  it("starts newest, prepends older, fills a forward gap without dropping the old reading window", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(5, 7), hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 6 } });
    expect((await f.pages.read(f.scope, CHILD_A)).entries.map((row) => row.seq)).toEqual([6, 7]);
    f.pages.requestOlder("taki", CHILD_A);
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(3, 5), hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 4 } });
    expect((await f.pages.read(f.scope, CHILD_A)).entries.map((row) => row.seq)).toEqual([4, 5, 6, 7]);
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(9), hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 10 } });
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(7, 9), hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 9 } });
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(9) });
    const recovered = await f.pages.read(f.scope, CHILD_A);
    expect(recovered.entries.map((row) => row.seq)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(recovered.nextCursor?.seq).toBe(4);
    expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({ direction: "newer", cursor: { subagentId: CHILD_A, seq: 9 } }));
  });

  it("retains the last good window after errors and rejects non-advancing cursors", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(5), hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 6 } });
    await f.pages.read(f.scope, CHILD_A); f.pages.requestOlder("taki", CHILD_A);
    f.request.mockResolvedValueOnce({ ...f.all, entries: [], hasMore: true, nextCursor: { subagentId: CHILD_A, seq: 6 } });
    await expect(f.pages.read(f.scope, CHILD_A)).rejects.toThrow("advance");
    f.request.mockRejectedValueOnce(new Error("offline"));
    await expect(f.pages.read(f.scope, CHILD_A)).rejects.toThrow("offline");
    f.request.mockResolvedValueOnce({ ...f.all, entries: f.all.entries.slice(5) });
    expect((await f.pages.read(f.scope, CHILD_A)).entries).toHaveLength(5);
  });

  it("retired reads cannot replace a retained window and different children never share pages", async () => {
    const f = fixture(); await f.pages.read(f.scope, CHILD_A);
    f.request.mockResolvedValueOnce(conversation(CHILD_B));
    expect((await f.pages.read(f.scope, CHILD_B)).conversation.subagentId).toBe(CHILD_B);
    await expect(f.pages.read({ ...f.scope, current: () => false }, CHILD_A)).rejects.toThrow("Retired");
  });

  it("loads all exact body pages, refuses changed digests, and retains full content after refresh", async () => {
    const f = fixture();
    const full = f.all.entries[0]!;
    const serialized = JSON.stringify(full);
    const digest = "b".repeat(64);
    const preview = { ...full, body: { digest, totalChars: serialized.length, nextOffset: 0 as const } };
    f.request.mockResolvedValue({ ...f.all, entries: [preview] });
    await f.pages.read(f.scope, CHILD_A);
    f.body.mockImplementation(async (params) => {
      const offset = params.offset ?? 0;
      const end = Math.min(offset + 50, serialized.length);
      return { seq: full.seq, digest, offset, body: serialized.slice(offset, end), complete: end === serialized.length,
        nextOffset: end < serialized.length ? end : null };
    });
    expect((await f.pages.expand(f.scope, preview)).entries[0]).toEqual(full);
    expect(f.body.mock.calls.length).toBeGreaterThan(2);
    expect((await f.pages.read(f.scope, CHILD_A)).entries[0]?.body).toBeUndefined();
    f.body.mockResolvedValueOnce({ seq: full.seq, digest: "c".repeat(64), offset: 0, body: "", nextOffset: null, complete: true });
    await expect(f.pages.expand(f.scope, preview)).rejects.toThrow("mismatch");
  });
});
