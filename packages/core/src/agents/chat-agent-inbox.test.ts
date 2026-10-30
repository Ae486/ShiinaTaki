import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ChatActivity, SourceContext, TimelineEntry } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { failThenStreamModel, scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createChatTurnActivity } from "./chat-activity.ts";
import { createChatAgent } from "./chat-agent.ts";
import type { ForegroundInboxContext, ForegroundInboxInput } from "./foreground-inbox.ts";
import type { TurnMessage } from "./turn-mapping.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

async function fixture(model: MockLanguageModelV4) {
  const f = await subagentFixture(model); fixtures.push(f);
  const repo = createTimelineRepo(f.db);
  const store = createConversationStore({ repo });
  const events: ChatActivity[] = [];
  const activity = createChatTurnActivity({ identity: { characterId: "taki", messageId: "primary-message" },
    publish: (event) => events.push(event) });
  activity.start();
  const privateBatches: TurnMessage[][] = [];
  const witnesses: PrimaryConversationCommit[] = [];
  const publicCommits: TimelineEntry[][] = [];
  const source: SourceContext = { generatedBy: { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId },
    materials: [{ reference: "agent-event:accepted-event", label: "Supplied child event" }] };
  let delivered = false;
  let invocation: unknown;
  const dispose = vi.fn();
  const factory = vi.fn((input: ForegroundInboxInput) => {
    const inbox: ForegroundInboxContext = {
      instructions: "Core private inbox: PRIVATE_INBOX_BODY. Reply to the child with the private action.",
      sourceContext: source,
      tools: { handle_agent_event: tool({ inputSchema: z.object({ answer: z.string() }), execute: async () => {
        invocation = input.actualInvocation();
        return { note: "PRIVATE_ACTION_RESULT" };
      } }) },
      commitModelIntent: () => { delivered = true; }, hasIntent: () => delivered,
      recordCompletedStep: ({ messages }) => { privateBatches.push(messages); },
      onPublicCommitted: (entries) => { publicCommits.push([...entries]); }, dispose,
    };
    return inbox;
  });
  const overflow = vi.fn();
  const agent = createChatAgent({ model, store, memory: f.memory, effectLifecycle: f.effects,
    foregroundInbox: factory, onPrimaryCommitted: (commit) => witnesses.push(commit), onOverflow: overflow,
    extraTools: { echo: tool({ inputSchema: z.object({ private: z.boolean().optional() }),
      execute: async () => ({ value: "PUBLIC_TOOL_RESULT" }) }) } });
  const turn = { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, activity };
  return { ...f, agent, repo, store, turn, events, witnesses, privateBatches, publicCommits, source,
    factory, dispose, overflow, invocation: () => invocation };
}

describe("foreground private inbox projection through the actual SDK and primary writer", () => {
  it("keeps public text/tools and private action pairs separate while the next SDK request retains both", async () => {
    const tail = streamingMockModel(["Public answer"]);
    let count = 0;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (count++ > 0) return tail.doStream(options);
      return { stream: simulateReadableStream({ chunks: [
        { type: "text-start" as const, id: "text" },
        { type: "text-delta" as const, id: "text", delta: "Visible preface" },
        { type: "text-end" as const, id: "text" },
        { type: "tool-call" as const, toolCallId: "private-call", toolName: "handle_agent_event", input: '{"answer":"PRIVATE_CHILD_ANSWER"}' },
        { type: "tool-call" as const, toolCallId: "public-call", toolName: "echo", input: '{"private":true}' },
        { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 4, text: 4, reasoning: undefined } } },
      ] }) };
    } });
    const f = await fixture(model);
    expect(await drain(f.agent.stream({ characterId: "taki", message: "Original user request" }, f.turn)))
      .toBe("Visible prefacePublic answer");
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.invocation()).toMatchObject({ toolCallId: "private-call", toolName: "handle_agent_event",
      runId: f.turn.runId, attemptId: f.turn.attemptId, modelEffectId: expect.any(String) });
    const rows = f.repo.latestAscending("taki", 30);
    expect(rows[0]).toMatchObject({ role: "user", content: "Original user request" });
    expect(rows[0]?.sourceContext).toBeUndefined();
    const publicEvidence = JSON.stringify([rows, f.events, f.witnesses]);
    for (const secret of ["PRIVATE_INBOX_BODY", "PRIVATE_CHILD_ANSWER", "PRIVATE_ACTION_RESULT", "handle_agent_event", "private-call"]) {
      expect(publicEvidence).not.toContain(secret);
    }
    expect(publicEvidence).toContain("PUBLIC_TOOL_RESULT");
    for (const row of rows.filter((entry) => entry.role === "assistant")) expect(row.sourceContext).toEqual(f.source);
    expect(f.privateBatches).toHaveLength(1);
    expect(f.privateBatches[0]?.map((message) => message.role)).toEqual(["assistant", "tool"]);
    expect(JSON.stringify(f.privateBatches)).toContain("PRIVATE_ACTION_RESULT");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("PRIVATE_ACTION_RESULT");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("PUBLIC_TOOL_RESULT");
    expect(JSON.stringify(f.store.history("taki"))).not.toContain("PRIVATE_ACTION_RESULT");
    const liveItems = f.events.flatMap((event) => event.kind === "text.delta" || event.kind === "tool.received" ? [event.itemId] : []);
    const committedItems = rows.flatMap((row) => row.presentation?.references.map((ref) => ref.itemId) ?? []);
    expect(new Set(committedItems)).toEqual(new Set(liveItems));
    expect(f.witnesses[0]?.entries).toEqual(rows);
    expect(f.publicCommits[0]).toEqual(rows.slice(1));
  });

  it("keeps invalid calls to a bound private tool out of public activity and history", async () => {
    const model = scriptedModel([
      { kind: "tool", toolCallId: "invalid-private", toolName: "handle_agent_event", input: { answer: 17 } },
      { kind: "text", deltas: ["Public correction"] },
    ]);
    const f = await fixture(model);
    await drain(f.agent.stream({ characterId: "taki", message: "hello" }, f.turn));
    expect(f.invocation()).toBeUndefined();
    expect(JSON.stringify([f.repo.latestAscending("taki", 30), f.events, f.witnesses])).not.toContain("handle_agent_event");
    expect(JSON.stringify(f.privateBatches)).toContain("invalid-private");
    expect(f.privateBatches[0]?.map((message) => message.role)).toEqual(["assistant", "tool"]);
  });

  it("does not replay an inbox delivered at model intent on a clean context-overflow failure", async () => {
    const model = failThenStreamModel(new Error("context length exceeded"), ["must not retry"]);
    const f = await fixture(model);
    await expect(drain(f.agent.stream({ characterId: "taki", message: "keep this request" }, f.turn))).rejects.toThrow();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(f.overflow).not.toHaveBeenCalled();
    expect(f.repo.latestAscending("taki", 10).map((row) => row.content)).toEqual(["keep this request"]);
    expect(f.privateBatches).toEqual([]);
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
