import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, tool } from "ai";
import { z } from "zod";
import { createChatAgent } from "./chat-agent.ts";
import { createPrimaryPersistence } from "./primary-persistence.ts";
import { createPrimaryMemoryCustody } from "../db/primary-memory-custody-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { errorPartThenStreamModel, failingMockModel, midStreamErrorModel, scriptedModel, slowStreamingModel } from "../testing/mock-language-model.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

function fresh() {
  const f = createCompanionFixture(); fixtures.push(f);
  const appended: number[] = []; const removed: number[] = [];
  const primaryPersistence = createPrimaryPersistence({ custody: createPrimaryMemoryCustody({ db: f.db, bootId: "boot-chat" }),
    repo: createTimelineRepo(f.db), onAppend: (entry) => appended.push(entry.seq), onRemove: (ref) => removed.push(ref.seq) });
  const groups = () => f.db.prepare("SELECT group_id,state,run_id,finalized_through_seq FROM primary_memory_groups ORDER BY created_at").all();
  const members = (groupId: unknown) => f.db.prepare("SELECT timeline_seq FROM primary_memory_members WHERE group_id=:id ORDER BY timeline_seq")
    .all({ id: String(groupId) }).map((row) => Number(row.timeline_seq));
  return { f, primaryPersistence, appended, removed, groups, members };
}

/** The canonical openai-compatible overflow body (see overflow-error.ts sources). */
function overflowError(): APICallError {
  return new APICallError({ message: "This model's maximum context length is 65536 tokens. However, you requested 70000 tokens (70000 in the messages, 0 in the completion). Please reduce the length of the messages or completion.",
    url: "https://gw.example.com/v1/chat/completions", requestBodyValues: {}, statusCode: 400,
    responseBody: '{"error":{"type":"invalid_request_error","code":"context_length_exceeded"}}', isRetryable: false });
}

describe("primary turn custody in the Chat persistence path", () => {
  it("enrolls exactly the turn's rows, notifies after commit and finalizes once after the primary callback", async () => {
    const t = fresh(); const order: string[] = []; const commits: PrimaryConversationCommit[] = [];
    const model = scriptedModel([{ kind: "tool", toolCallId: "c", toolName: "probe", input: {} }, { kind: "text", deltas: ["primary response"] }]);
    const agent = createChatAgent({ model, store: t.f.conversation, memory: t.f.memory, primaryPersistence: t.primaryPersistence,
      extraTools: { probe: tool({ inputSchema: z.object({}), execute: async () => {
        t.f.conversation.appendAssistant("taki", "interleaved autonomous speech"); return { safe: true };
      } }) },
      onPrimaryCommitted: (input) => { order.push(`committed:${t.groups()[0]?.state}`); commits.push(input); } });
    await drain(agent.stream({ characterId: "taki", message: "primary user" }, { runId: "primary-run" }));
    const [group] = t.groups();
    expect(t.groups()).toHaveLength(1);
    expect(group).toMatchObject({ state: "finalized", run_id: "primary-run", finalized_through_seq: 5 });
    expect(t.members(group!.group_id)).toEqual([1, 3, 4, 5]);
    expect(commits[0]?.entries.map((entry) => entry.seq)).toEqual([1, 3, 4, 5]);
    // The complete-group callback observed the group still open: finalization is the single terminal step afterwards.
    expect(order).toEqual(["committed:open"]);
    expect(t.appended).toEqual([1, 3, 4, 5]);
    expect(t.f.conversation.history("taki")).toHaveLength(5);
  });

  it("retracts a silent cancellation atomically: no row, no member, retracted group, removal notified", async () => {
    const t = fresh(); const callback = vi.fn(); const controller = new AbortController(); controller.abort();
    const agent = createChatAgent({ model: slowStreamingModel(["never"], 20), store: t.f.conversation, memory: t.f.memory,
      primaryPersistence: t.primaryPersistence, onPrimaryCommitted: callback });
    expect(await drain(agent.stream({ characterId: "taki", message: "cancel me" }, { signal: controller.signal }))).toBe("");
    expect(t.f.conversation.history("taki")).toEqual([]); expect(callback).not.toHaveBeenCalled();
    expect(t.groups()).toMatchObject([{ state: "retracted" }]);
    expect(t.members(t.groups()[0]!.group_id)).toEqual([]);
    expect(t.appended).toEqual([1]); expect(t.removed).toEqual([1]);
  });

  it("finalizes the exact retained rows when the primary callback itself crashes", async () => {
    const t = fresh(); const failure = new Error("witness sink crashed");
    const agent = createChatAgent({ model: scriptedModel([{ kind: "text", deltas: ["reply"] }]), store: t.f.conversation, memory: t.f.memory,
      primaryPersistence: t.primaryPersistence, onPrimaryCommitted: () => { throw failure; } });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).rejects.toBe(failure);
    expect(t.groups()).toMatchObject([{ state: "finalized", finalized_through_seq: 2 }]);
    expect(t.members(t.groups()[0]!.group_id)).toEqual([1, 2]);
  });

  it("reuses one group across the context-overflow retry", async () => {
    const t = fresh();
    const agent = createChatAgent({ model: errorPartThenStreamModel(overflowError(), ["ok"]), store: t.f.conversation, memory: t.f.memory,
      primaryPersistence: t.primaryPersistence, onOverflow: vi.fn() });
    expect(await drain(agent.stream({ characterId: "taki", message: "long" }))).toBe("ok");
    expect(t.groups()).toMatchObject([{ state: "finalized", finalized_through_seq: 2 }]);
    expect(t.members(t.groups()[0]!.group_id)).toEqual([1, 2]);
    expect(t.f.conversation.history("taki")).toHaveLength(2);
  });

  it.each([
    ["user-only terminal failure", () => failingMockModel(new Error("provider down")), [1]],
    ["retained partial reply", () => midStreamErrorModel(["visible partial"], new Error("stream failed")), [1, 2]],
  ] as const)("finalizes the %s instead of leaving an open group", async (_name, model, expected) => {
    const t = fresh();
    const agent = createChatAgent({ model: model(), store: t.f.conversation, memory: t.f.memory, primaryPersistence: t.primaryPersistence });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).rejects.toThrow();
    expect(t.groups()).toMatchObject([{ state: "finalized", finalized_through_seq: expected.at(-1) }]);
    expect(t.members(t.groups()[0]!.group_id)).toEqual([...expected]);
  });

  it("opens no group for non-primary turns", async () => {
    const t = fresh();
    const agent = createChatAgent({ model: scriptedModel([{ kind: "text", deltas: ["quiet"] }]), store: t.f.conversation, memory: t.f.memory,
      primaryPersistence: t.primaryPersistence });
    await drain(agent.stream({ characterId: "taki", message: "background" }, { turnKind: "non-primary" }));
    expect(t.groups()).toEqual([]);
    expect(t.f.conversation.history("taki")).toEqual([]);
  });
});
