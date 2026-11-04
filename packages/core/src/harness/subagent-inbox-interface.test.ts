import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { SubagentHandleEventToolInput } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import type { ToolInvocationSnapshot } from "../agents/tool-invocation.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function fixture(kind: "question" | "check_in" | "message" | "final" = "question", parentApprovals = 3) {
  const final = { kind: "tool" as const, toolCallId: "final", toolName: "complete_subagent", input: { text: "Completed answer", materials: [] } };
  const question = { kind: "tool" as const, toolCallId: "question", toolName: "interact_parent", input: { kind: "needs_input", text: "Which source?" } };
  const model = scriptedModel(kind === "final" ? [final] : kind === "message" ? [
    { kind: "tool", toolCallId: "progress", toolName: "interact_parent", input: { kind: "message", text: "I found two sources." } }, question, final,
  ] : [kind === "question" ? question
    : { kind: "tool", toolCallId: "observe", toolName: "observe", input: {} }, final]);
  const f = await subagentFixture(model, { tools: { observe: tool({ inputSchema: z.object({}), execute: () => ({ observed: true }) }) } });
  fixtures.push(f); f.queue.tryAcquireBackground("taki");
  f.service.state.deps.checkInPolicy = () => ({ steps: kind === "check_in" ? 1 : 50, parentApprovals });
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["observe"] }, {
    characterId: "taki", operationKey: "work", label: "Worker", initialContext: { kind: "fresh" },
    direction: "Finish the assignment", materials: [], completionPolicy: "request_parent",
  });
  const subagentId = accepted.conversation.subagentId;
  await vi.waitFor(() => {
    expect(f.service.events.list({ characterId: "taki" })).toHaveLength(kind === "message" ? 2 : 1);
    expect(f.children.get(subagentId).activeRunId).toBeNull();
  });
  const event = f.service.events.list({ characterId: "taki" })[0]!;
  let invocation: ToolInvocationSnapshot | undefined;
  const context = f.service.prepareInbox({ characterId: "taki", runId: f.parent.run.runId,
    attemptId: f.parent.attempt.attemptId, actualInvocation: () => invocation })!;
  const effect = f.effects.prepare({ runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, kind: "model",
    sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "e".repeat(64), replayPosture: "never",
    onCommitIntent: (intent) => context.commitModelIntent(intent, 0) });
  f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "completed" });
  const target = () => ({ subagentId, workInputId: event.workInputId, expectedRunId: f.children.get(subagentId).activeRunId,
    expectedControlVersion: f.children.get(subagentId).controlVersion });
  const handle = (value: SubagentHandleEventToolInput, override: Partial<ToolInvocationSnapshot> = {}) => {
    const toolCallId = randomUUID();
    invocation = { invocationId: randomUUID(), toolCallId, toolName: "handle_agent_event", validationState: "accepted",
      runId: effect.runId, attemptId: effect.attemptId, modelEffectId: effect.effectId, ...override };
    return context.tools.handle_agent_event!.execute!(value, { toolCallId, messages: [], context: {} });
  };
  return { ...f, model, event, subagentId, context, target, handle, effect };
}

describe("flat private event interface on actual child SDK and SQLite owners", () => {
  it("handles equivalent and changed parent retries through the real governed SDK tool loop", async () => {
    const worker = scriptedModel([
      { kind: "tool", toolCallId: "ask", toolName: "interact_parent", input: { kind: "needs_input", text: "Which source?" } },
      { kind: "tool", toolCallId: "final", toolName: "complete_subagent", input: { text: "Used source B", materials: [] } },
    ]);
    let parentCalls = 0;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (options.tools?.some((entry) => entry.name === "complete_subagent")) return worker.doStream(options);
      parentCalls += 1;
      return scriptedModel(parentCalls <= 3 ? [{ kind: "tool", toolCallId: `parent-${parentCalls}`, toolName: "handle_agent_event",
        input: parentCalls === 3 ? { ...value, text: "Changed answer" } : value }]
        : [{ kind: "text", deltas: ["The child has its answer."] }]).doStream(options);
    } });
    const f: Awaited<ReturnType<typeof subagentFixture>> = await subagentFixture(model, { agent: { foregroundInbox: (input) => f.service.prepareInbox(input) } });
    fixtures.push(f); f.queue.tryAcquireBackground("taki");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki",
      operationKey: "worker", label: "Worker", initialContext: { kind: "fresh" }, direction: "Finish", materials: [], completionPolicy: "request_parent" });
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.summary(subagentId)).toMatchObject({ state: "needs_input", activeRunId: null }));
    const event = f.service.events.list({ characterId: "taki" })[0]!;
    const value: SubagentHandleEventToolInput = { eventId: event.eventId, intent: "answer_child", text: "Use source B", target: { subagentId, workInputId: event.workInputId,
      expectedRunId: null, expectedControlVersion: f.children.get(subagentId).controlVersion } };
    for await (const delta of f.agent.stream({ characterId: "taki", message: "Continue the task" }, {
      runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, runContext: f.runs.context(f.parent.run.runId),
    })) { void delta; }
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(parentCalls).toBe(4);
    expect(f.inputs.list({ subagentId })).toHaveLength(2);
    const actions = f.db.prepare("SELECT * FROM subagent_event_actions").all();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ tool_call_id: "parent-1" });
    const parentRequests = model.doStreamCalls.filter((options) => !options.tools?.some((entry) => entry.name === "complete_subagent"));
    expect(JSON.stringify(parentRequests[2]!.prompt)).toContain("answered_child");
    expect(JSON.stringify(parentRequests[3]!.prompt)).toContain("SUBAGENT_EVENT_ALREADY_HANDLED");
    expect(JSON.stringify(parentRequests[2]!.prompt)).not.toContain("operationKey");
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_deliveries").get()?.n).toBe(4);
    expect(f.errors).toEqual([]);
  });

  it("answers the selected question once across fresh call IDs and rejects changed actions after child state advances", async () => {
    const f = await fixture();
    const before = f.service.inbox.get(f.context.consumerId);
    const value = { eventId: f.event.eventId, intent: "answer_child" as const, text: "Use source B", target: f.target() };
    const receipt = await f.handle(value);
    expect(receipt).toMatchObject({ ok: true, disposition: "answered_child" });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(await f.handle(value)).toEqual(receipt);
    expect(await f.handle({ ...value, text: "Use source C" })).toMatchObject({ ok: false, code: "SUBAGENT_EVENT_ALREADY_HANDLED" });
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(2);
    expect(f.executions.list({ subagentId: f.subagentId })).toHaveLength(2);
    const row = f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: f.event.eventId })!;
    expect(JSON.parse(String(row.action_json))).toEqual({ kind: "answered_child", target: value.target, direction: value.text, replyToEventId: f.event.eventId });
    expect(String(row.operation_key)).toMatch(/^event:[a-f0-9]{64}$/);
    expect(f.service.events.wait(f.event.workInputId)).toMatchObject({ state: "answered" });
    expect(JSON.stringify(f.model.doStreamCalls[1]!.prompt)).toContain("Use source B");
    expect(f.service.inbox.get(f.context.consumerId)).toMatchObject({ instructions: before.instructions, projectionDigest: before.projectionDigest });
    expect(f.errors).toEqual([]);
  });

  it("rolls child answer and wait resolution back when the action receipt fails", async () => {
    const f = await fixture();
    const value = { eventId: f.event.eventId, intent: "answer_child" as const, text: "Use source B", target: f.target() };
    f.db.exec("CREATE TRIGGER fail_event_action BEFORE INSERT ON subagent_event_actions BEGIN SELECT RAISE(ABORT,'receipt failure'); END;");
    expect(await f.handle(value)).toMatchObject({ ok: false });
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(1);
    expect(f.service.events.wait(f.event.workInputId)?.state).toBe("open");
    expect(f.service.events.get(f.event.eventId).state).toBe("delivered");
    expect(f.model.doStreamCalls).toHaveLength(1);
    f.db.exec("DROP TRIGGER fail_event_action");
    expect(await f.handle(value)).toMatchObject({ ok: true });
  });

  it("replies privately to a nonblocking message without answering a later question on the same work", async () => {
    const f = await fixture("message");
    const question = f.service.events.wait(f.event.workInputId)!;
    expect(question).toMatchObject({ state: "open", reason: "question" });
    expect(question.eventId).not.toBe(f.event.eventId);
    const value = { eventId: f.event.eventId, intent: "answer_child" as const, text: "Keep both source references", target: f.target() };
    const receipt = await f.handle(value);
    expect(receipt).toMatchObject({ ok: true, disposition: "answered_child" });
    expect(await f.handle(value)).toEqual(receipt);
    expect(f.service.events.wait(f.event.workInputId)).toEqual(question);
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(2);
    const row = f.db.prepare("SELECT action_json FROM subagent_event_actions WHERE event_id=:event").get({ event: f.event.eventId })!;
    expect(JSON.parse(String(row.action_json))).toMatchObject({ kind: "answered_child", replyToEventId: null, direction: value.text });
    expect(f.model.doStreamCalls).toHaveLength(2);
    expect(await f.handle({ eventId: question.eventId, intent: "answer_child", text: "Use source B", target: f.target() })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(f.model.doStreamCalls).toHaveLength(3);
    expect(f.errors).toEqual([]);
  });

  it("increments a permitted check-in once and refuses an ordinary answer as approval", async () => {
    const f = await fixture("check_in");
    const value = { eventId: f.event.eventId, intent: "continue_child" as const, text: "", target: f.target() };
    expect(await f.handle({ ...value, intent: "answer_child", text: "Continue" })).toMatchObject({ ok: false, code: "SUBAGENT_CHECKIN_CONTINUE_REQUIRED" });
    const receipt = await f.handle(value);
    expect(receipt).toMatchObject({ ok: true, disposition: "continue_child" });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(await f.handle(value)).toEqual(receipt);
    expect(f.service.summary(f.subagentId).progress?.consecutiveParentApprovals).toBe(1);
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(2);
  });

  it.each(["user_stop", "user_required"] as const)("preserves %s authority for flat check-in continuation", async (barrier) => {
    const f = await fixture("check_in", barrier === "user_required" ? 0 : 3);
    if (barrier === "user_stop") f.service.stop({ characterId: "taki", target: f.target() }, "user");
    const result = await f.handle({ eventId: f.event.eventId, intent: "continue_child", text: "", target: f.target() });
    expect(result).toMatchObject({ ok: false, code: barrier === "user_stop" ? "SUBAGENT_USER_CONTINUE_REQUIRED" : "SUBAGENT_CHECKIN_USER_REQUIRED" });
    expect(f.service.events.wait(f.event.workInputId)?.state).toBe("open");
    expect(f.service.summary(f.subagentId).progress?.consecutiveParentApprovals).toBe(0);
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(1);
  });

  it("refuses undelivered identities, invalid invocation, cross-work and stale targets without acknowledging", async () => {
    const f = await fixture();
    const value = { eventId: f.event.eventId, intent: "answer_child" as const, text: "Use B", target: f.target() };
    expect(await f.handle({ ...value, eventId: randomUUID() })).toMatchObject({ ok: false, code: "SUBAGENT_EVENT_NOT_DELIVERED", current: undefined });
    expect(await f.handle(value, { runId: randomUUID() })).toMatchObject({ ok: false, code: "SUBAGENT_INBOX_INVOCATION_MISMATCH" });
    expect(await f.handle({ ...value, target: { ...value.target, subagentId: randomUUID() } })).toMatchObject({ ok: false, code: "SUBAGENT_INPUT_REQUEST_CONFLICT" });
    expect(await f.handle({ ...value, target: { ...value.target, workInputId: randomUUID() } })).toMatchObject({ ok: false, code: "SUBAGENT_INPUT_REQUEST_CONFLICT" });
    expect(await f.handle({ ...value, target: { ...value.target, expectedControlVersion: value.target.expectedControlVersion + 1 } })).toMatchObject({ ok: false, code: "SUBAGENT_CONTROL_CONFLICT" });
    expect(f.service.events.get(f.event.eventId).state).toBe("delivered");
    expect(f.inputs.list({ subagentId: f.subagentId })).toHaveLength(1);
  });

  it("requires an actual input event for continuation and records user attention once", async () => {
    const f = await fixture("final");
    expect(await f.handle({ eventId: f.event.eventId, intent: "continue_child", text: "Continue", target: f.target() })).toMatchObject({ ok: false, code: "SUBAGENT_INPUT_REQUEST_CONFLICT" });
    const value = { eventId: f.event.eventId, intent: "ask_user" as const, text: "Which source should we use?", target: null };
    const receipt = await f.handle(value);
    expect(receipt).toMatchObject({ ok: true, disposition: "needs_user_input" });
    expect(await f.handle(value)).toEqual(receipt);
    expect(f.service.attention({ characterId: "taki", limit: 20 }).entries).toContainEqual(expect.objectContaining({ kind: "needs_user_input" }));
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_user_attention").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_speech_publications").get()?.n).toBe(0);
  });

  it("keeps historical no_action readable and refuses to relabel it as record", async () => {
    const f = await fixture("final");
    const receipt = f.service.inbox.action({ consumerId: f.context.consumerId, eventId: f.event.eventId, operationKey: "legacy-arbitrary-key",
      action: { kind: "no_action", note: "Already considered" }, invocation: { invocationId: randomUUID(), toolCallId: "old-call",
        toolName: "handle_agent_event", runId: f.effect.runId, attemptId: f.effect.attemptId, modelEffectId: f.effect.effectId,
        validationState: "accepted" }, apply: () => ({ ok: true, disposition: "no_action" }) });
    expect(receipt).toHaveProperty("operationKey", "legacy-arbitrary-key");
    const before = f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: f.event.eventId });
    expect(await f.handle({ eventId: f.event.eventId, intent: "record", text: "Already considered", target: null }))
      .toMatchObject({ ok: false, code: "SUBAGENT_EVENT_ALREADY_HANDLED" });
    const read = await f.context.tools.read_agent_inbox!.execute!({ eventId: f.event.eventId, detail: "action", offset: 0, limit: 1000 },
      { toolCallId: "read", messages: [], context: {} });
    expect(read).toHaveProperty("text", JSON.stringify({ action: { kind: "no_action", note: "Already considered" }, result: { ok: true, disposition: "no_action" } }));
    expect(f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: f.event.eventId })).toEqual(before);
  });
});
