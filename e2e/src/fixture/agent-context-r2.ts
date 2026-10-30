/**
 * INPUT: production Core/RPC scenario and an explicit transparent request timing controller
 * OUTPUT: independent cancel/stop/continue and original-request reply/internal-result acceptance evidence
 * POS: e2e/fixture — Shared-validated operator actions; model tool calls and Runtime decisions remain real
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { CHAT_METHODS, ChatCancelResultSchema, ChatSendResultSchema, PreparedPublicationResultSchema, SUBAGENT_METHODS,
  SubagentControlResultSchema, type SubagentSummary, type SubagentTarget } from "@taki/shared";
import type { AgentContextScenario } from "./agent-context-scenario.ts";
import { startAgentContextTimingRelay } from "./agent-context-timing-relay.ts";
import type { ScriptedReply } from "./scripted-provider.ts";
import { acknowledgedChildren, assertHandledEvent, deliveredInboxEvents, handledEvents, scriptedInboxReply } from "./agent-context-inbox.ts";

export const R2_A = "R2_PRIVATE_ORCHID_762";
export const R2_B = "R2_PUBLIC_COBALT_193";
export const R2_INTERNAL = "R2_INTERNAL_AMBER_584";
const A_LABEL = "R2 record worker";
const B_LABEL = "R2 report worker";
const BLOCKED = "R2_PARENT_CONTINUE_PROBE";
const OPTIONS = { timeout: 90_000, interval: 50 };

export function createR2Timing() {
  let originalParent = true;
  let relay: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
  return {
    async transport(baseUrl: string, evidenceDir: string) {
      relay = await startAgentContextTimingRelay({ baseUrl, evidenceDir, gate(request) {
        if (deliveredInboxEvents(request).length) return;
        const messages = JSON.stringify(request.messages);
        if (hasTool(request, "complete_subagent")) {
          if (messages.includes(R2_A)) return "child-a";
          if (messages.includes(R2_B)) return "child-b";
          throw new Error("unclassified R2 child request");
        }
        if (originalParent && acknowledgedChildren(request).length >= 2) return "original-parent";
        return undefined;
      } });
      return relay;
    },
    get requests() { return relay?.requests ?? []; },
    release(gate: string) {
      if (!relay) throw new Error("R2 timing relay unavailable");
      relay.release(gate);
    },
    parentCancelled() { originalParent = false; },
  };
}

export async function exerciseR2(scenario: AgentContextScenario, timing: ReturnType<typeof createR2Timing>): Promise<void> {
  const prompt = `这是隔离的并行委派验收。请真实调用 delegate_subagent，创建两个子代理，可在同一回复中调用两次。`
    + `第一个 label="${A_LABEL}"，context=snapshot 且 summary 只包含 ${R2_A}，completionPolicy=record_only。`
    + `它的 direction：用 complete_subagent 原样返回选定的英文标记。`
    + `第二个 label="${B_LABEL}"，context=snapshot 且 summary 只包含 ${R2_B}，completionPolicy=request_parent。`
    + `它的 direction：用 complete_subagent 原样返回 ${R2_B}，并说明主代理应读取真实收件事件，再以 handle_agent_event 的 speech_proposed 动作将此标记作为最终回答报告给用户。`
    + `两者 subagentId=null，toolSelection={"mode":"allow","names":["complete_subagent"]}，materials=[]。`
    + `我明确请求第二项工作完成后报告结果，即使当前父请求已停止。创建后只确认委派，不要等待、查看或停止子代理。`;
  const original = ChatSendResultSchema.parse(await scenario.rpc(CHAT_METHODS.send, { characterId: "taki", message: prompt }));
  await expect.poll(async () => (await scenario.list()).entries.length, OPTIONS).toBe(2);
  const entries = (await scenario.list()).entries;
  const a = entries.find((child) => child.label === A_LABEL);
  const b = entries.find((child) => child.label === B_LABEL);
  if (!a || !b) throw new Error("R2 exact delegated children missing");
  await expect.poll(() => ["original-parent", "child-a", "child-b"].every((gate) => timing.requests.some((request) =>
    request.gate === gate && request.heldAt && !request.forwardedAt)), OPTIONS).toBe(true);
  const before = { a: (await scenario.history(a.subagentId)).conversation, b: (await scenario.history(b.subagentId)).conversation };
  expect(before.a.state).toBe("running"); expect(before.b.state).toBe("running");
  scenario.checkpoint("three-independent-active-runs", { original, before, transport: timing.requests });

  const cancelled = ChatCancelResultSchema.parse(await scenario.rpc(CHAT_METHODS.cancel, { characterId: "taki", runId: original.runId }));
  expect(cancelled.cancelled).toBe(true);
  timing.parentCancelled();
  await expect.poll(() => runState(scenario, original.runId), OPTIONS).toBe("cancelled");
  const afterCancel = { a: (await scenario.history(a.subagentId)).conversation, b: (await scenario.history(b.subagentId)).conversation };
  expect(afterCancel).toEqual(before);
  await expect.poll(() => timing.requests.find((request) => request.gate === "original-parent")?.aborted, OPTIONS).toBe("client-closed");
  expect(timing.requests.filter((request) => request.gate?.startsWith("child-")).every((request) => !request.aborted)).toBe(true);
  scenario.checkpoint("actual-parent-cancel-preserves-both-children", { cancelled, afterCancel });

  const stopped = SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.stop, {
    characterId: "taki", target: targetFor(afterCancel.a),
  }));
  expect(stopped.cancellationRequested).toBe(true);
  await expect.poll(async () => (await scenario.history(a.subagentId)).conversation.state, OPTIONS).toBe("blocked_user");
  await expect.poll(() => timing.requests.find((request) => request.gate === "child-a")?.aborted, OPTIONS).toBe("client-closed");
  await expect.poll(async () => (await scenario.history(a.subagentId)).conversation.activeRunId, OPTIONS).toBeNull();
  const blocked = await scenario.history(a.subagentId);
  expect(blocked.results[0]?.result.child.outcome).toBe("cancelled");
  expect((await scenario.history(b.subagentId)).conversation).toEqual(before.b);
  const durableLatch = latchRows(scenario, a.subagentId);
  const target = targetFor(blocked.conversation);
  const requestStart = scenario.requests.length;
  await scenario.ask(`${BLOCKED}：这是隔离控制拒绝验收。请真实调用一次 send_subagent_message，使用下面的精确 target，`
    + `continue=true，direction="parent must not clear the user stop"，materials=[]。预期 Core 拒绝，不要自行跳过调用，不要重试，不要创建新工作。`
    + `target=${JSON.stringify(target)}。调用后只报告已被拒绝，不要操作另一个子代理。`);
  const refusalRequests = scenario.requests.slice(requestStart);
  expect(refusalRequests.some((request) => nativeToolResult(request.body, "SUBAGENT_USER_CONTINUE_REQUIRED"))).toBe(true);
  expect(latchRows(scenario, a.subagentId)).toEqual(durableLatch);
  expect((await scenario.history(a.subagentId)).executions).toEqual(blocked.executions);
  expect((await scenario.history(a.subagentId)).inputs).toEqual(blocked.inputs);
  expect((await scenario.history(b.subagentId)).conversation).toEqual(before.b);
  expect(timing.requests.filter((request) => request.gate === "child-a")).toHaveLength(1);
  expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_consumers")).toHaveLength(0);
  expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_deliveries")).toHaveLength(0);
  scenario.checkpoint("durable-user-latch-refuses-real-parent-tool", { durableLatch, target, blocked });

  timing.release("child-b");
  await expect.poll(() => publications(scenario).some((publication) => publication.status === "recorded" && publication.state === "sent"), OPTIONS).toBe(true);
  const replied = await scenario.history(b.subagentId);
  const reply = replied.results[0];
  const replyEvent = handledEvents(scenario).find((event) => event.subagent_id === b.subagentId);
  if (!reply || !replyEvent) throw new Error("R2 explicit reply event unavailable");
  assertHandledEvent(replyEvent, { kind: "speech_proposed", marker: R2_B });
  const publication = publications(scenario).find((item) => item.eventId === replyEvent.event_id);
  if (!publication || publication.status !== "recorded") throw new Error("R2 separate publication Run unavailable");
  expect(reply.result.child.body).toContain(R2_B);
  expect(replyEvent.producer_run_id).toBe(reply.result.child.runId);
  expect(replyEvent.consumer_run_id).not.toBe(original.runId);
  expect(replyEvent.mode).toBe("idle");
  expect(publication.runId).not.toBe(replyEvent.consumer_run_id);
  expect(runState(scenario, original.runId)).toBe("cancelled");
  expect(replied.inputs[0]?.replyAcceptance?.primaryRunId).toBe(original.runId);
  expect(replied.inputs[0]?.completionPolicy).toBe("request_parent");
  expect(publication).toMatchObject({ status: "recorded", state: "sent", actionId: replyEvent.operation_key });
  expect(scenario.rows(`SELECT effect_id FROM run_effects WHERE run_id='${publication.runId}' AND kind='model'`)).toHaveLength(0);
  expect(scenario.rows("SELECT content FROM timeline_messages WHERE role='assistant'").filter((row) => String(row.content).includes(R2_B))).toHaveLength(1);
  expect(scenario.rows("SELECT run_id FROM run_deliveries")).toHaveLength(1);
  scenario.checkpoint("new-parent-explicitly-publishes-original-stopped-request", { replied, replyEvent, publication });

  timing.release("child-a");
  const continued = SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.continue, {
    characterId: "taki", target, operationKey: randomUUID(), materials: [],
    direction: "The user explicitly continues this work. Recover the original selected marker from your retained context and return it with complete_subagent.",
  }));
  expect(continued.input?.kind).toBe("continue");
  await expect.poll(async () => (await scenario.history(a.subagentId)).results.length, OPTIONS).toBe(2);
  const resumed = await scenario.history(a.subagentId);
  expect(resumed.conversation.stopOrigin).toBeNull();
  expect(resumed.results.some((result) => result.result.child.outcome === "completed" && result.result.child.body?.includes(R2_A))).toBe(true);
  expect(resumed.results.every((result) => result.result.parentRunId === null && result.result.completionState === "not_requested")).toBe(true);
  expect(resumed.inputs.every((input) => input.completionPolicy === "record_only")).toBe(true);
  expect(resumed.inputs.find((input) => input.inputId === continued.input?.inputId)?.consumed)
    .toMatchObject({ runId: expect.any(String), effectId: expect.any(String) });
  expect(new Set(resumed.executions.map((execution) => execution.runId)).size).toBe(2);
  expect(runState(scenario, before.a.activeRunId!)).toBe("cancelled");
  expect(scenario.rows(`SELECT event_id FROM subagent_events WHERE subagent_id='${a.subagentId}' AND eligible=1`)).toHaveLength(0);
  expect(handledEvents(scenario)).toHaveLength(1);
  scenario.checkpoint("explicit-user-continue-new-run-record-only", resumed);

  await scenario.ask(`请真实调用 delegate_subagent 复用子代理 ${b.subagentId}，label="${B_LABEL}"。`
    + `这是新的独立工作，context=fresh，completionPolicy=request_parent，`
    + `toolSelection={"mode":"allow","names":["complete_subagent"]}，materials=[]。`
    + `direction：用 complete_subagent 返回 ${R2_INTERNAL}，说明这项新工作只作内部评估，主代理必须读取真实收件事件并调用 handle_agent_event，`
    + `action.kind=retained，note 包含 ${R2_INTERNAL}，不要回复用户或发布内容。创建后只说已委派，不要说英文标记，不要等待或查看结果。`);
  await expect.poll(() => handledEvents(scenario).length, OPTIONS).toBe(2);
  const internal = await scenario.history(b.subagentId);
  const internalWork = internal.inputs.find((input) => input.kind === "work" && input.direction.includes(R2_INTERNAL));
  const internalResult = internal.results.find((result) => result.result.child.workInputId === internalWork?.inputId);
  const internalEvent = handledEvents(scenario).find((event) => event.work_input_id === internalWork?.inputId);
  if (!internalEvent) throw new Error("R2 retained internal event unavailable");
  expect(internalWork?.inputId).not.toBe(replied.inputs[0]?.inputId);
  expect(internal.results).toHaveLength(2);
  expect(internalResult?.result.child.body).toContain(R2_INTERNAL);
  assertHandledEvent(internalEvent, { kind: "retained", marker: R2_INTERNAL });
  expect(internalEvent.producer_run_id).toBe(internalResult?.result.child.runId);
  expect(publications(scenario).some((item) => item.eventId === internalEvent.event_id)).toBe(false);
  expect(scenario.rows("SELECT run_id FROM run_deliveries")).toHaveLength(1);
  expect(scenario.rows("SELECT content FROM timeline_messages WHERE role='assistant'").some((row) => String(row.content).includes(R2_INTERNAL) || String(row.content).includes(R2_A))).toBe(false);
  expect(new Set(handledEvents(scenario).map((event) => event.consumer_run_id)).size).toBe(2);
  expect(new Set(scenario.requests.flatMap((request) => deliveredInboxEvents(JSON.parse(request.body) as Record<string, unknown>))
    .map((event) => event.eventId))).toEqual(new Set([replyEvent.event_id, internalEvent.event_id]));
  expect(timing.requests.filter((request) => request.forwardedAt).every((request) => request.status === 200 && !request.failure)).toBe(true);
  expect(timing.requests.filter((request) => request.aborted).map((request) => request.gate).sort()).toEqual(["child-a", "original-parent"]);
  scenario.checkpoint("internal-inference-no-auto-speech-and-final-distinct-runs", { internal, internalEvent, resumed, transport: timing.requests });
}

export function createR2ScriptedReply(): (request: Record<string, unknown>) => ScriptedReply {
  return (request) => {
    const messages = JSON.stringify(request.messages);
    if (hasTool(request, "complete_subagent")) return { calls: [{ name: "complete_subagent", arguments: {
      text: messages.includes(R2_INTERNAL) ? R2_INTERNAL : messages.includes(R2_A) ? R2_A : R2_B, materials: [],
    } }] };
    const inbox = scriptedInboxReply(request, (text) => ({ kind: text.includes(R2_INTERNAL) ? "retained" : "speech_proposed",
      note: text.includes(R2_INTERNAL) ? R2_INTERNAL : R2_B }));
    if (inbox) return inbox;
    const latest = latestUserMessage(request);
    const last = Array.isArray(request.messages) ? request.messages.at(-1) : undefined;
    if (record(last)?.role === "tool") return { text: "The operation was processed." };
    if (latest.includes(BLOCKED)) {
      const match = /target=(\{.*\})。/.exec(latest);
      if (!match) throw new Error("missing exact blocked target");
      return { calls: [{ name: "send_subagent_message", arguments: {
        target: JSON.parse(match[1]!), continue: true, direction: "parent must not clear the user stop", materials: [],
      } }] };
    }
    if (latest.includes(R2_INTERNAL)) {
      const id = /复用子代理 ([a-f0-9-]+)/.exec(latest)?.[1];
      if (!id) throw new Error("missing reused child identity");
      return { calls: [{ name: "delegate_subagent", arguments: delegation({ label: B_LABEL, marker: R2_INTERNAL, subagentId: id, policy: "request_parent" }) }] };
    }
    return { calls: [
      { name: "delegate_subagent", arguments: delegation({ label: A_LABEL, marker: R2_A, subagentId: null, policy: "record_only" }) },
      { name: "delegate_subagent", arguments: delegation({ label: B_LABEL, marker: R2_B, subagentId: null, policy: "request_parent" }) },
    ] };
  };
}

function delegation(input: { label: string; marker: string; subagentId: string | null; policy: "record_only" | "request_parent" }) {
  return { label: input.label, subagentId: input.subagentId, direction: `Return ${input.marker} with complete_subagent.`,
    context: input.subagentId ? { kind: "fresh" } : { kind: "snapshot", summary: input.marker }, completionPolicy: input.policy,
    toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [] };
}
function targetFor(child: SubagentSummary): SubagentTarget {
  if (!child.latestWorkInputId) throw new Error("missing child work");
  return { subagentId: child.subagentId, workInputId: child.latestWorkInputId,
    expectedRunId: child.activeRunId, expectedControlVersion: child.controlVersion };
}
function runState(scenario: AgentContextScenario, runId: string): unknown {
  return scenario.rows(`SELECT state FROM runs WHERE run_id='${runId}'`)[0]?.state;
}
function latchRows(scenario: AgentContextScenario, subagentId: string) {
  return scenario.rows(`SELECT stop_origin,control_version,next_input_seq,active_run_id FROM subagent_conversations WHERE subagent_id='${subagentId}'`);
}
function hasTool(request: Record<string, unknown>, name: string): boolean {
  return Array.isArray(request.tools) && request.tools.some((tool) => record(record(tool)?.function)?.name === name);
}
function nativeToolResult(body: string, marker: string): boolean {
  const request = record(JSON.parse(body));
  return Array.isArray(request?.messages) && request.messages.some((message) =>
    record(message)?.role === "tool" && String(record(message)?.content).includes(marker));
}
function publications(scenario: AgentContextScenario) {
  return scenario.rows("SELECT event_id,action_id,result_json FROM subagent_speech_publications").map((row) => ({
    ...PreparedPublicationResultSchema.parse(JSON.parse(String(row.result_json))), eventId: row.event_id, actionId: row.action_id,
  }));
}
function latestUserMessage(request: Record<string, unknown>): string {
  if (!Array.isArray(request.messages)) return "";
  const item = request.messages.findLast((message) => record(message)?.role === "user");
  return typeof record(item)?.content === "string" ? String(record(item)?.content) : JSON.stringify(record(item)?.content);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
