import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ChatActivity } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { midStreamErrorModel, scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createCanonicalIngestionSourceRepo } from "../db/canonical-ingestion-source-repo.ts";
import { createHindsightIngestionSourceRepo } from "../db/hindsight-ingestion-source-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { sanitizeCommittedPrimarySpan, type PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createChatTurnActivity } from "./chat-activity.ts";
import { createConversationStore } from "./conversation-store.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

function memoryWitnesses(f: Fixture, provider: "local" | "hindsight") {
  const epochId = `inbox-${provider}`;
  const now = new Date().toISOString();
  f.db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES (:epoch,:provider,'inbox-fixture','active',NULL,:now,NULL,'planned-switch')`)
    .run({ epoch: epochId, provider, now });
  f.db.prepare(`INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at)
    VALUES (1,:epoch,:now) ON CONFLICT(singleton) DO UPDATE SET active_epoch_id=excluded.active_epoch_id,updated_at=excluded.updated_at`)
    .run({ epoch: epochId, now });
  const repo = provider === "local" ? createCanonicalIngestionSourceRepo(f.db) : createHindsightIngestionSourceRepo(f.db);
  const scope = { epochId, characterId: "taki" };
  repo.initializeBaseline({ ...scope, throughSeq: 0, now });
  return {
    record: (commit: PrimaryConversationCommit) => repo.recordPrimaryCommitted({ ...commit, ...scope, now }),
    read: (throughSeq: number) => sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq,
      entries: repo.pendingEntries({ ...scope, throughSeq }) }),
  };
}

async function integratedFixture(provider: "local" | "hindsight", partial: boolean) {
  let mainCalls = 0;
  const commits: PrimaryConversationCommit[] = [];
  const overflow = vi.fn();
  const child = scriptedModel([{ kind: "tool", toolName: "complete_subagent", toolCallId: "final-report",
    input: { text: "PRIVATE_WORKER_BODY", materials: [] } }]);
  const tail = partial ? midStreamErrorModel(["Public partial"], new Error("provider interrupted")) : streamingMockModel(["Public answer"]);
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    if (options.tools?.some((entry) => entry.type === "function" && entry.name === "complete_subagent")) return child.doStream(options);
    if (mainCalls++ > 0) return tail.doStream(options);
    return { stream: simulateReadableStream({ chunks: [
      { type: "text-start" as const, id: "preface" },
      { type: "text-delta" as const, id: "preface", delta: "Public preface" },
      { type: "text-end" as const, id: "preface" },
      { type: "tool-call" as const, toolCallId: "private-action", toolName: "handle_agent_event",
        input: JSON.stringify({ eventId: event.eventId, intent: "record", text: "PRIVATE_HANDLING_NOTE", target: null }) },
      { type: "tool-call" as const, toolCallId: "public-action", toolName: "echo", input: '{"private":true}' },
      { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 4, text: 4, reasoning: undefined } } },
    ] }) };
  } });
  const f: Fixture = await subagentFixture(model, { agent: {
    foregroundInbox: (input) => f.service.prepareInbox(input), onOverflow: overflow,
    onPrimaryCommitted: (commit) => { commits.push(commit); witness.record(commit); },
    extraTools: { echo: tool({ inputSchema: z.object({ private: z.boolean() }), execute: async () => ({ text: "PUBLIC_TOOL_OUTPUT" }) }) },
  } });
  fixtures.push(f);
  // Hold the real Character lane so the deterministic child event is consumed by the foreground request.
  f.queue.tryAcquireBackground("taki");
  await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "work",
    label: "Research worker", initialContext: { kind: "fresh" }, direction: "Inspect private material", materials: [], completionPolicy: "request_parent" });
  await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(1));
  const event = f.service.events.list({ characterId: "taki" })[0]!;
  const witness = memoryWitnesses(f, provider);
  const activityEvents: ChatActivity[] = [];
  const activity = createChatTurnActivity({ identity: { characterId: "taki", messageId: "foreground-inbox-memory" },
    publish: (value) => activityEvents.push(value) });
  activity.start();
  return { f, model, event, witness, commits, overflow, activityEvents,
    turn: { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, activity } };
}

describe("actual Runtime inbox and primary Memory source boundary", () => {
  it.each(["local", "hindsight"] as const)("keeps private receipts outside %s source witnesses and primary replay", async (provider) => {
    const { f, model, event, witness, commits, activityEvents, turn } = await integratedFixture(provider, false);
    expect(await drain(f.agent.stream({ characterId: "taki", message: "Original user request" }, turn))).toBe("Public prefacePublic answer");
    const accepted = f.service.events.get(event.eventId);
    expect(accepted).toMatchObject({ state: "handled", reconciliationNeeded: false });
    const actions = f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:id").all({ id: event.eventId });
    expect(actions).toHaveLength(1);
    expect(JSON.stringify(actions)).toContain("PRIVATE_HANDLING_NOTE");
    const privateRows = f.db.prepare("SELECT * FROM run_messages WHERE run_id=:id AND entry_kind='output' ORDER BY seq").all({ id: turn.runId });
    expect(privateRows.map((row) => row.role)).toEqual(["assistant", "tool"]);
    expect(JSON.stringify(privateRows)).toContain("handle_agent_event");
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).toContain("handle_agent_event");
    const timeline = createTimelineRepo(f.db);
    const rows = timeline.latestAscending("taki", 30);
    const source = witness.read(rows.at(-1)!.seq);
    const replay = createConversationStore({ repo: createTimelineRepo(f.db) }).history("taki");
    for (const secret of ["PRIVATE_WORKER_BODY", "PRIVATE_HANDLING_NOTE", "handle_agent_event", "private-action"]) {
      expect(JSON.stringify([rows, source, activityEvents, replay])).not.toContain(secret);
    }
    expect(rows[0]).toMatchObject({ role: "user", content: "Original user request" });
    expect(rows[0]?.sourceContext).toBeUndefined();
    expect(JSON.stringify(rows)).toContain("PUBLIC_TOOL_OUTPUT");
    expect(JSON.stringify(source.messages)).not.toContain("PUBLIC_TOOL_OUTPUT");
    expect(source.messages.map((message) => message.text).join("")).toContain("Public answer");
    expect(JSON.stringify(source.messages)).toContain(`agent-event:${event.eventId}`);
    expect(commits[0]?.entries).toEqual(rows);
    const live = activityEvents.flatMap((item) => item.kind === "text.delta" || item.kind === "tool.received" ? [item.itemId] : []);
    const durable = rows.flatMap((row) => row.presentation?.references.map((ref) => ref.itemId) ?? []);
    expect(new Set(durable)).toEqual(new Set(live));
  });

  it("keeps committed handling and true public partial text after a later provider failure without retry", async () => {
    const { f, event, witness, overflow, activityEvents, turn } = await integratedFixture("local", true);
    await expect(drain(f.agent.stream({ characterId: "taki", message: "Keep my request" }, turn))).rejects.toThrow("provider interrupted");
    expect(overflow).not.toHaveBeenCalled();
    expect(f.service.events.get(event.eventId).state).toBe("handled");
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM subagent_event_actions WHERE event_id=:id").get({ id: event.eventId })?.count).toBe(1);
    const rows = createTimelineRepo(f.db).latestAscending("taki", 30);
    expect(rows.filter((row) => row.content === "Public partial")).toHaveLength(1);
    const source = witness.read(rows.at(-1)!.seq);
    expect(source.messages.map((message) => message.text)).toContain("Public partial");
    expect(JSON.stringify([rows, source, activityEvents])).not.toContain("PRIVATE_HANDLING_NOTE");
  });
});
