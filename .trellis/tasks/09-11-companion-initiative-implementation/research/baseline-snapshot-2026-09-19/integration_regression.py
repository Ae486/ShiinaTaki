"""Add a behavioral regression across the combined Memory/Timeline seam."""
from guarded_edit import edit, replace_once

TEST = '''import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ChatActivity, TimelineCommitted } from "@taki/shared";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { midStreamErrorModel, scriptedModel, slowStreamingModel } from "../testing/mock-language-model.ts";
import { createChatTurnActivity } from "./chat-activity.ts";
import { createChatAgent } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

function fixture() {
  const f = createCompanionFixture(); fixtures.push(f);
  const repo = createTimelineRepo(f.db);
  const batches: TimelineCommitted[] = [];
  const witnesses: PrimaryConversationCommit[] = [];
  const events: ChatActivity[] = [];
  const store = createConversationStore({ repo, onCommit: (batch) => batches.push(batch) });
  const activity = createChatTurnActivity({ identity: { characterId: "taki", messageId: "accepted-primary" },
    publish: (event) => events.push(event) });
  activity.start();
  return { ...f, repo, store, batches, witnesses, events, activity };
}

async function drain(stream: AsyncIterable<string>) { for await (const delta of stream) void delta; }

describe("combined B6 Memory and T4 foreground source", () => {
  it.each([false, true])("preserves captured names, activity and exact ingestion rows after failure=%s", async (fails) => {
    const f = fixture();
    const first = scriptedModel([{ kind: "textTool", deltas: ["before tool"], toolCallId: "call", toolName: "probe", input: {} }]);
    const tail = fails ? midStreamErrorModel(["partial tail"], new Error("later provider failed"))
      : scriptedModel([{ kind: "text", deltas: ["complete tail"] }]);
    let calls = 0;
    const model = new MockLanguageModelV4({ doStream: (input) => ++calls === 1 ? first.doStream(input) : tail.doStream(input) });
    const recall = vi.fn(async () => "PRIVATE_RECALL");
    const names = { probe: "Captured operation" };
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      onPrimaryCommitted: (witness) => f.witnesses.push(witness) });
    const stream = agent.stream({ characterId: "taki", message: "user source" }, { runId: "primary-run", activity: f.activity,
      runContext: { memoryTools: {}, assembleMemory: () => "CAPTURED_MEMORY", automaticMemoryRecall: recall, toolDisplayNames: names,
        tools: { probe: tool({ inputSchema: z.object({}), execute: async () => {
          names.probe = "replacement label";
          f.store.appendAssistant("taki", "unrelated autonomous row");
          return { ok: true };
        } }) } } });
    if (fails) await expect(drain(stream)).rejects.toThrow("later provider failed");
    else await drain(stream);

    expect(f.batches).toHaveLength(1);
    expect(f.witnesses).toHaveLength(1);
    const witness = f.witnesses[0]!;
    expect(witness.entries.slice(1)).toEqual(f.batches[0]!.entries);
    expect(witness.entries.map((entry) => entry.seq)).toEqual([1, 3, 4, 5]);
    for (const entry of witness.entries) expect(f.repo.latestAscending("taki", 20).find((row) => row.id === entry.id)).toEqual(entry);
    expect(witness.entries.slice(1).every((entry) => entry.presentation?.messageId === "accepted-primary")).toBe(true);
    const parts = witness.entries.flatMap((entry) => entry.parts ?? []).filter((part) => part.type === "tool-call" || part.type === "tool-result");
    expect(parts.map((part) => part.displayName)).toEqual(["Captured operation", "Captured operation"]);
    expect(f.events.some((event) => event.kind === "tool.received" && event.displayName === "Captured operation")).toBe(true);
    expect(recall).toHaveBeenCalledOnce();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("PRIVATE_RECALL");
    expect(JSON.stringify(witness)).not.toMatch(/PRIVATE_RECALL|replacement label|unrelated autonomous row/);
    expect(JSON.stringify(f.store.history("taki"))).not.toContain("displayName");
  });

  it("witnesses an iterator-close partial exactly once", async () => {
    const f = fixture();
    const agent = createChatAgent({ model: slowStreamingModel(["first", "unread"], 10), store: f.store, memory: f.memory,
      onPrimaryCommitted: (witness) => f.witnesses.push(witness) });
    const iterator = agent.stream({ characterId: "taki", message: "source" }, { activity: f.activity })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe("first");
    await iterator.return?.();
    expect(f.witnesses).toHaveLength(1);
    expect(f.witnesses[0]?.entries.map((entry) => entry.content)).toEqual(["source", "first"]);
    expect(f.witnesses[0]?.entries.slice(1)).toEqual(f.batches[0]?.entries);
  });
});
'''
edit('packages/core/src/agents/chat-agent-baseline-integration.test.ts', lambda _: TEST)
edit('packages/core/src/agents/index.md', lambda source: replace_once(source,
    '- turn-recording.ts —', '- turn-recording.ts —'))


def provenance(source):
    # These entries arrived in two histories with different meanings. Preserve
    # original IDs within each named provenance rather than renumbering evidence.
    lines = source.splitlines()
    seen = {}
    for i, line in enumerate(lines):
        for number in range(77, 82):
            marker = f'| D{number} |'
            if line.startswith(marker):
                count = seen.get(number, 0)
                lines[i] = line.replace(marker, f'| {"main" if count == 0 else "T4"}-D{number} |', 1)
                seen[number] = count + 1
    note = ('\nSource provenance after the 2026-09-19 integration: `main-D77` through `main-D81` and '
            '`T4-D77` through `T4-D81` preserve distinct historical decisions with colliding numbers. '
            'Unqualified references inside each historical entry retain that entry\'s branch context; '
            'matching numbers never combine scope or acceptance.\n')
    return lines[0] + '\n' + note + '\n' + '\n'.join(lines[1:]) + '\n'


edit('docs/deferred-decisions.md', provenance)
