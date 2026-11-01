import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolLoopAgent, isStepCount, type ToolSet, type ToolResultPart } from "ai";
import { SubagentSummarySchema, type SubagentControlResult, type SubagentEvent, type SubagentInputWait } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel, streamingMockModel, type ScriptStep } from "../testing/mock-language-model.ts";
import { createSubagentTools, subagentToolRefusal } from "./subagent-tools.ts";
import { createSubagentInboxTools } from "./subagent-inbox-tools.ts";
import { subagentControlModelOutput } from "./subagent-control-output.ts";
import { subagentCurrentModelState, subagentScopedModelState } from "./subagent-model-state.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createToolMaterialSink } from "../harness/subagent-tool-materials.ts";
import { toEntryInput } from "./turn-mapping.ts";
import { withToolSourceMaterials } from "./tool-source-materials.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const childId = "11111111-1111-4111-8111-111111111111";
const workId = "22222222-2222-4222-8222-222222222222";
const target = { subagentId: childId, workInputId: workId, expectedRunId: null, expectedControlVersion: 4 };
const question: SubagentInputWait = { eventId: "question", workInputId: workId, state: "open", answerInputId: null, reason: "question", checkIn: null };
function summary(overrides = {}) {
  return SubagentSummarySchema.parse({ subagentId: childId, characterId: "taki", label: "研究员", createdAt: "2026-11-01T00:00:00Z",
    activeRunId: null, activeWorkInputId: null, controlVersion: 4, stopOrigin: null, state: "needs_input", pendingRequest: question,
    latestWorkInputId: workId, latestCompletionId: "completion", ...overrides });
}
function event(body: string): SubagentEvent {
  return { eventId: question.eventId, seq: 1, characterId: "taki", subagentId: childId, workInputId: workId,
    kind: "needs_input", producerRunId: "producer", producerAttemptId: "attempt", producerKey: "question", body,
    bodyDigest: "a".repeat(64), sourceContext: { generatedBy: { runId: "producer", attemptId: "attempt", subagentId: childId },
      materials: [{ label: "文档", reference: "notes.txt", speaker: "作者", time: "2026-11-01T00:00:00Z" }] },
    throughWorkSeq: 1, acceptedAt: "2026-11-01T00:00:00Z", eligible: true, suppressionReason: null, state: "delivered", reconciliationNeeded: false };
}
async function fixture() {
  const f = await subagentFixture(streamingMockModel(["Unstructured useful analysis"])); fixtures.push(f);
  f.queue.tryAcquireBackground("taki");
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "seed",
    label: "研究员", direction: "Work", materials: [{ key: "selected:0", text: "原文😀", source: { label: "文档", reference: "notes.txt", speaker: "作者" } }],
    initialContext: { kind: "fresh" }, completionPolicy: "record_only" });
  const id = accepted.conversation.subagentId;
  await vi.waitFor(() => expect(f.service.summary(id).activeRunId).toBeNull());
  await vi.waitFor(() => expect(f.service.summary(id).latestCompletionId).not.toBeNull());
  const current = f.service.summary(id);
  const exact = { subagentId: id, workInputId: accepted.input!.workInputId, expectedRunId: null, expectedControlVersion: current.controlVersion };
  f.service.stop({ characterId: "taki", target: exact }, "user");
  return { ...f, accepted, id, exact: { ...exact, expectedControlVersion: f.service.summary(id).controlVersion } };
}
async function requestCapture(f: Awaited<ReturnType<typeof fixture>>, tools: ToolSet, steps: ScriptStep[]) {
  const model = scriptedModel([...steps, { kind: "text", deltas: ["Done"] }]);
  const sink = createToolMaterialSink();
  const raw: unknown[] = [];
  const governance = createCoreToolGovernanceAdapter(createGovernancePolicyService(createGovernancePolicyRepo(f.db)), randomUUID());
  const wrapped = governance.wrap(tools);
  const agent = new ToolLoopAgent({ model, tools: wrapped, instructions: "Review exact worker results and use supplied handles.", stopWhen: isStepCount(steps.length + 1),
    prepareStep: ({ messages, stepNumber }) => {
      sink.attach("parent-attempt", messages.filter((message) => message.role !== "user" && message.role !== "system")
        .map(toEntryInput).filter((entry) => entry !== null), Math.max(0, stepNumber - 1));
      return { messages: sink.render("parent-attempt", messages) };
    },
    onStepEnd(step) {
      raw.push(...step.toolResults.map((result) => result.output));
      sink.capture({ runId: "parent-run", attemptId: "parent-attempt", stepNumber: step.stepNumber, results: step.toolResults });
      sink.attach("parent-attempt", step.response.messages.map(toEntryInput).filter((entry) => entry !== null), step.stepNumber);
    } });
  const stream = await agent.stream({ messages: [{ role: "user", content: "Review the worker" }] });
  await stream.consumeStream();
  return { model, raw, sink, wrapped };
}
function toolOutput(model: ReturnType<typeof scriptedModel>, request: number): ToolResultPart["output"] {
  const part = model.doStreamCalls[request]!.prompt.flatMap((message) => message.role === "tool" ? message.content : []).find((part) => part.type === "tool-result");
  if (!part || part.type !== "tool-result") throw new Error("Missing tool output in actual provider prompt");
  return part.output;
}

describe("delegation model projections", () => {
  it("keeps exact null Run/version/work, distinct current work and full user-only check-in facts", () => {
    const checkIn = { completedSteps: 50, intervalStartSteps: 0, intervalSteps: 50, parentApprovalLimit: 3,
      consecutiveParentApprovals: 3, requiredActor: "user" as const, reportKind: "core_snapshot" as const };
    const pending = { ...question, reason: "check_in" as const, checkIn };
    const current = summary({ pendingRequest: pending });
    const projected = subagentScopedModelState({ ok: true, current, target, pendingRequest: pending });
    expect(projected).toMatchObject({ target, pendingRequest: { checkIn }, current: { worker: "研究员", state: "needs_input" } });
    expect(projected).not.toHaveProperty("current.pendingRequest");
    const newer = randomUUID();
    expect(subagentCurrentModelState(summary({ activeWorkInputId: newer, latestWorkInputId: newer, pendingRequest: { ...question, eventId: "newer", workInputId: newer } }),
      { target, pendingRequest: question })).toMatchObject({ activeWorkInputId: newer, latestWorkInputId: newer, pendingRequest: { eventId: "newer", workInputId: newer } });
  });

  it("projects controls/refusals without altering canonical results and preserves cancellation/unknown outcomes", async () => {
    const f = await fixture();
    const raw = structuredClone(f.accepted);
    const result = JSON.parse(subagentControlModelOutput({ output: f.accepted }).value);
    expect(result).toMatchObject({ ok: true, accepted: true, target: { workInputId: raw.input!.workInputId, expectedRunId: null } });
    expect(result).toMatchObject({ reporting: "record_only", nextAction: expect.stringContaining("silent") });
    expect(result).not.toHaveProperty("acceptedInputId"); expect(f.accepted).toEqual(raw);
    const notified = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "reporting",
      label: "Notified", direction: "Work", materials: [], initialContext: { kind: "fresh" }, completionPolicy: "request_parent" });
    expect(JSON.parse(subagentControlModelOutput({ output: notified }).value)).toMatchObject({ reporting: "request_parent",
      nextAction: expect.stringContaining("end this reply") });
    const refused = subagentToolRefusal(new Error("SUBAGENT_CONTROL_CONFLICT"), { service: f.service, subagentId: f.id, characterId: "taki" });
    expect(JSON.parse(subagentControlModelOutput({ output: refused }).value)).toMatchObject({ ok: false, code: "SUBAGENT_CONTROL_CONFLICT", currentTarget: f.exact,
      current: { stopOrigin: "user" }, nextAction: expect.stringContaining("user") });
    const scoped = subagentToolRefusal(new Error("SUBAGENT_WORK_MISMATCH"), { service: f.service, subagentId: f.id, characterId: "other" });
    expect(JSON.parse(subagentControlModelOutput({ output: scoped }).value)).not.toHaveProperty("current");
    expect(JSON.parse(subagentControlModelOutput({ output: { ok: false, code: "CANCELLED", message: "cancelled" } }).value)).toEqual({ ok: false, code: "CANCELLED", message: "cancelled" });
    expect(JSON.parse(subagentControlModelOutput({ output: { ...f.accepted, cancellationRequested: true } }).value)).toHaveProperty("cancellationRequested", true);
    expect(subagentScopedModelState({ status: "outcome_unknown", outputKind: "partial", body: "unchanged😀" })).toEqual({ status: "outcome_unknown", outputKind: "partial", body: "unchanged😀" });
  });

  it("installed SDK retains raw selected inputs, governed projections and consumable source/material handles", async () => {
    const f = await fixture();
    const tools = createSubagentTools({ service: f.service, characterId: "taki", turn: { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId } });
    const first = { target: { subagentId: f.id }, direction: "Guidance", continue: false,
      materials: [{ kind: "input", inputId: f.accepted.input!.inputId, key: "selected:0" }] };
    const source = { key: "result", source: { label: "工具证据", reference: "notes.txt", speaker: "作者" } };
    const original = tools.send_subagent_message!.execute!;
    tools.send_subagent_message!.execute = async (candidate, options) => withToolSourceMaterials(await original(candidate, options) as SubagentControlResult, [source]);
    const capture = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "message", toolName: "send_subagent_message", input: first }]);
    const raw = capture.raw[0] as SubagentControlResult;
    expect(f.inputs.get(raw.input!.inputId)).toEqual(raw.input);
    expect(raw.input?.materials[0]).toMatchObject({ text: "原文😀", source: { speaker: "作者", reference: "notes.txt" } });
    const outgoing = toolOutput(capture.model, 1);
    expect(JSON.stringify(outgoing)).toContain("acceptedInputId"); expect(JSON.stringify(outgoing)).not.toContain("requestDigest");
    expect(JSON.stringify(outgoing)).toContain("Core material references"); expect(JSON.stringify(outgoing)).toContain("工具证据");
    expect(capture.wrapped.send_subagent_message!.toModelOutput).toBe(tools.send_subagent_message!.toModelOutput);
    expect(f.service.selectMaterials("taki", [{ kind: "input", inputId: raw.input!.inputId, key: "selected:0" }])[0]?.text).toBe("原文😀");
    const selected = capture.sink.select({ kind: "tool_result", runId: "parent-run", attemptId: "parent-attempt", stepNumber: 0, toolCallId: "message", key: "result" });
    expect(JSON.parse(selected!.text)).toEqual(raw); expect(selected?.source?.speaker).toBe("作者");
  });

  it("workers and default lists are compact while explicit diagnostics keeps full state and navigation", async () => {
    const f = await fixture();
    const second = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "other-worker",
      label: "Other", direction: "Other work", materials: [], initialContext: { kind: "fresh" }, completionPolicy: "record_only" });
    await vi.waitFor(() => expect(f.service.summary(second.conversation.subagentId).latestCompletionId).not.toBeNull());
    const tools = createSubagentTools({ service: f.service, characterId: "taki", turn: { runId: f.parent.run.runId } });
    const step: ScriptStep = { kind: "tool", toolCallId: "workers", toolName: "inspect_subagent", input: { subagentId: null, completionId: null, category: null, cursor: null, limit: 1 } };
    const compact = await requestCapture(f, tools, [step]);
    const legacy = Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
      const original = { ...tool }; delete original.toModelOutput; return [name, original];
    }));
    const before = await requestCapture(f, legacy, [step]);
    const workers = await requestCapture(f, tools, [{ ...step, input: { ...step.input as object, category: "workers" } }]);
    const detailed = await requestCapture(f, tools, [{ ...step, input: { ...step.input as object, category: "diagnostics" } }]);
    const raw = compact.raw[0]; expect(raw).toEqual(before.raw[0]); expect(raw).toEqual(detailed.raw[0]);
    expect(JSON.stringify(toolOutput(compact.model, 1))).not.toContain("tokenUsage");
    expect(toolOutput(workers.model, 1)).toEqual(toolOutput(compact.model, 1));
    expect(JSON.stringify(toolOutput(detailed.model, 1))).toContain("tokenUsage");
    const firstPage = compact.raw[0] as { entries: Array<{ subagentId: string }>; nextCursor: string };
    expect(JSON.stringify(toolOutput(compact.model, 1))).toContain(firstPage.entries[0]!.subagentId);
    expect(JSON.stringify(toolOutput(compact.model, 1))).toContain(firstPage.nextCursor);
    const nextPage = await requestCapture(f, tools, [{ ...step, input: { ...step.input as object, cursor: firstPage.nextCursor } }]);
    const listed = [firstPage, nextPage.raw[0] as typeof firstPage].flatMap((page) => page.entries.map((entry) => entry.subagentId));
    expect(new Set(listed)).toEqual(new Set([f.id, second.conversation.subagentId]));
    const bytes = [before, compact].map(({ model }) => {
      const request = model.doStreamCalls[1]!;
      return Buffer.byteLength(JSON.stringify({ prompt: request.prompt, tools: request.tools }), "utf8");
    });
    expect(bytes[1]).toBeLessThan(bytes[0]!);
    console.info(`Delegation next-provider prompt UTF-8 bytes: raw-list=${bytes[0]}, compact-list=${bytes[1]}`);
    const completion = f.service.summary(f.id).latestCompletionId!;
    const follow = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "result", toolName: "inspect_subagent",
      input: { subagentId: null, completionId: completion, afterSeq: 0, cursor: null, limit: 1 } }]);
    expect(JSON.stringify(toolOutput(follow.model, 1))).toContain("Unstructured useful analysis");
    expect(toolOutput(follow.model, 1)).toMatchObject({ type: "json", value: { result: { result: { readStatus: "available", bodyComplete: true } } } });
    expect(follow.raw[0]).toMatchObject({ status: "available", complete: true });
  });

  it("distinguishes a fully read record with no terminal result from task completion at the SDK boundary", async () => {
    const f = await fixture();
    const missing = vi.spyOn(f.executions, "result").mockReturnValue(null);
    try {
      const tools = createSubagentTools({ service: f.service, characterId: "taki", turn: { runId: f.parent.run.runId } });
      const captured = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "pending", toolName: "inspect_subagent",
        input: { subagentId: f.id, completionId: null, category: "results", cursor: null } }]);
      expect(captured.raw[0]).toMatchObject({ status: "available", records: [{ complete: true }] });
      expect(toolOutput(captured.model, 1)).toMatchObject({ type: "json", value: { result: { result: { readStatus: "available", records: [
        { bodyComplete: true, resultStatus: "not_recorded", body: expect.stringContaining('"result":null') },
      ] } } } });
      expect(JSON.stringify(toolOutput(captured.model, 1))).not.toContain('"complete":true');
    } finally { missing.mockRestore(); }
  });

  it("uses exact returned targets/material IDs in SDK follow-ups and keeps stale/user-stop refusals scoped", async () => {
    const f = await fixture();
    const tools = createSubagentTools({ service: f.service, characterId: "taki", turn: { runId: f.parent.run.runId } });
    const guidance = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "guidance", toolName: "send_subagent_message", input: {
      target: f.exact, direction: "Correction", continue: false, materials: [{ kind: "input", inputId: f.accepted.input!.inputId, key: "selected:0" }] } }]);
    const accepted = guidance.raw[0] as SubagentControlResult;
    const projected = JSON.parse(subagentControlModelOutput({ output: accepted }).value);
    const follow = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "follow", toolName: "send_subagent_message", input: {
      target: projected.target, direction: "Selected accepted evidence", continue: false,
      materials: [{ kind: "input", inputId: projected.acceptedInputId, key: "selected:0" }] } }]);
    expect(follow.raw[0]).toHaveProperty("input.materials.0.text", "原文😀");
    const stopped = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "stale", toolName: "stop_subagent", input: { ...projected.target, expectedControlVersion: 0 } }]);
    expect(stopped.raw[0]).toHaveProperty("ok", false);
    expect(JSON.stringify(toolOutput(stopped.model, 1))).toContain("SUBAGENT_CONTROL_CONFLICT");
    expect(JSON.stringify(toolOutput(stopped.model, 1))).toContain(f.exact.workInputId);
    const blocked = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "continue", toolName: "send_subagent_message", input: {
      target: projected.target, direction: "Resume", continue: true, replyToEventId: null } }]);
    expect(JSON.stringify(toolOutput(blocked.model, 1))).toContain("SUBAGENT_USER_CONTINUE_REQUIRED");
    expect(JSON.stringify(toolOutput(blocked.model, 1))).not.toContain("characterId");
  });

  it("inbox next requests preserve Unicode pages, same-work dedup and recovered action truth", async () => {
    const f = await fixture(); const text = "问题😀结果漢字".repeat(500); const supplied = event(text);
    let current = summary();
    let pendingRequest = question;
    const accepted = { ok: true, eventId: supplied.eventId, disposition: "answered_child", inputId: randomUUID() };
    const action = JSON.stringify({ action: { kind: "answered_child", target, replyToEventId: question.eventId, direction: "答案😀" }, result: { ok: true } });
    const tools = createSubagentInboxTools({ read: () => ({ event: supplied, target, current, pendingRequest, action }),
      handle: () => accepted, actualInvocation: () => ({ invocationId: "invocation", toolCallId: "handle", toolName: "handle_agent_event", validationState: "accepted" }) });
    const capture = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "read", toolName: "read_agent_inbox", input: { eventId: question.eventId, offset: 0, limit: 3001 } }]);
    expect(capture.raw[0]).toHaveProperty("current.characterId", "taki");
    expect(JSON.stringify(toolOutput(capture.model, 1))).not.toContain("characterId");
    expect(JSON.stringify(toolOutput(capture.model, 1))).toContain("作者");
    let offset = 0; let rebuilt = "";
    do {
      const page = await tools.read_agent_inbox!.execute!({ eventId: question.eventId, offset, limit: 3001 }, { toolCallId: "page", messages: [], context: {} }) as { text: string; nextOffset: number | null };
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/u); rebuilt += page.text; offset = page.nextOffset ?? -1;
    } while (offset >= 0);
    expect(rebuilt).toBe(text);
    const handled = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "handle", toolName: "handle_agent_event", input: {
      eventId: question.eventId, operationKey: "stable", action: { kind: "answered_child", target, replyToEventId: question.eventId, direction: "答案😀" } } }]);
    expect(handled.raw[0]).toBe(accepted); expect(JSON.stringify(toolOutput(handled.model, 1))).not.toContain("inputId");
    expect(JSON.stringify(toolOutput(handled.model, 1))).toContain("answered_child");
    const page = await tools.read_agent_inbox!.execute!({ eventId: question.eventId, offset: 0, limit: 3001, detail: "action" }, { toolCallId: "page", messages: [], context: {} });
    expect(page).toHaveProperty("text", action);
    const newer = randomUUID();
    current = summary({ activeWorkInputId: newer, latestWorkInputId: newer, pendingRequest: { ...question, eventId: "newer", workInputId: newer } });
    const historical = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "history", toolName: "read_agent_inbox", input: { eventId: question.eventId, offset: 0, limit: 10 } }]);
    const historicalOutput = JSON.stringify(toolOutput(historical.model, 1));
    expect(historicalOutput).toContain(workId); expect(historicalOutput).toContain(newer); expect(historicalOutput).toContain("newer");
    const checkIn = { completedSteps: 200, intervalStartSteps: 150, intervalSteps: 50, parentApprovalLimit: 3,
      consecutiveParentApprovals: 3, requiredActor: "user" as const, reportKind: "core_snapshot" as const };
    pendingRequest = { ...question, reason: "check_in", checkIn }; current = summary({ pendingRequest });
    const checked = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "check-in", toolName: "read_agent_inbox", input: { eventId: question.eventId, offset: 0, limit: 10 } }]);
    expect(JSON.stringify(toolOutput(checked.model, 1))).toContain(JSON.stringify(checkIn));
  });

  it("installed SDK invalid-input errors bypass the model projection and never execute the control", async () => {
    const f = await fixture(); const stop = vi.spyOn(f.service, "stop");
    const tools = createSubagentTools({ service: f.service, characterId: "taki", turn: { runId: f.parent.run.runId } });
    const captured = await requestCapture(f, tools, [{ kind: "tool", toolCallId: "invalid", toolName: "stop_subagent", input: { ...f.exact, expectedControlVersion: "invalid" } }]);
    expect(stop).not.toHaveBeenCalled(); expect(toolOutput(captured.model, 1).type).toBe("error-text");
    expect(JSON.stringify(toolOutput(captured.model, 1))).toContain("expectedControlVersion");
  });

  it.each(["event", "action"] as const)("limit=1 reconstructs %s text and advances over complete surrogate pairs", async (detail) => {
    const body = "😀开头😀a😀结尾😀";
    const supplied = event(body);
    const tools = createSubagentInboxTools({ read: () => ({ event: supplied, target, action: body }),
      handle: () => ({ ok: true }), actualInvocation: () => undefined });
    let offset = 0;
    let reconstructed = "";
    do {
      const page = await tools.read_agent_inbox!.execute!({ eventId: supplied.eventId, offset, limit: 1, detail },
        { toolCallId: "one-code-point-page", messages: [], context: {} }) as { ok: boolean; text: string; nextOffset: number | null };
      expect(page.ok).toBe(true);
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.text.length).toBeLessThanOrEqual(2);
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(page.text).not.toMatch(/^[\uDC00-\uDFFF]/u);
      reconstructed += page.text;
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      expect(page.nextOffset).toBe(offset + page.text.length);
      offset = page.nextOffset;
    } while (offset < body.length);
    expect(reconstructed).toBe(body);
  });

  it("renders compact future teasers and keeps an already stored legacy claim projection/digest frozen", async () => {
    const f = await fixture();
    await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "notified",
      label: "Notified", direction: "Work", materials: [], initialContext: { kind: "fresh" }, completionPolicy: "request_parent" });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).some((entry) => entry.eligible)).toBe(true));
    const claim = f.service.inbox.claim({ characterId: "taki", runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, mode: "foreground" })!;
    const teaser = JSON.parse(claim.instructions.split("\n").find((line) => line.startsWith("{"))!);
    expect(teaser).toMatchObject({ eventId: expect.any(String), worker: expect.any(String), label: "Notified", kind: "interrupted", preview: "Unstructured useful analysis", detailRequired: false });
    expect(teaser).not.toHaveProperty("workInputId");
    expect(claim.instructions).toContain("For interrupted events only");
    const historical = await fixture(); const consumerId = randomUUID();
    const stored = "Legacy frozen teaser😀\n" + JSON.stringify({ ...teaser, workInputId: claim.events[0]!.workInputId });
    const digest = digestRunValue(stored);
    historical.db.prepare(`INSERT INTO subagent_inbox_consumers(consumer_id,character_id,run_id,attempt_id,mode,state,projection_json,projection_digest,created_at)
      VALUES(:id,'taki',:run,:attempt,'foreground','claimed',:projection,:digest,:at)`).run({ id: consumerId,
      run: historical.parent.run.runId, attempt: historical.parent.attempt.attemptId,
      projection: JSON.stringify({ instructions: stored }), digest, at: "2026-11-01T00:00:00Z" });
    expect(historical.service.inbox.get(consumerId)).toMatchObject({ instructions: stored, projectionDigest: digest });
    const context = historical.service.prepareInbox({ characterId: "taki", runId: historical.parent.run.runId, attemptId: historical.parent.attempt.attemptId, actualInvocation: () => undefined })!;
    expect(context.instructions).toContain("Foreground inbox: review"); expect(context.instructions.endsWith(stored)).toBe(true);
    expect(context.instructions).toContain("end the current reply with the task still pending");
    expect(context.instructions).toContain("without another user message");
    expect(historical.service.inbox.get(consumerId)).toMatchObject({ instructions: stored, projectionDigest: digest });
  });
});
