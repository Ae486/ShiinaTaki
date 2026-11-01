import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel, generatingModel } from "../testing/mock-language-model.ts";
import { createSubagentProgressRepo } from "../db/subagent-progress-repo.ts";
import { createSubagentService } from "./subagent-service.ts";
import * as workStores from "../agents/run-message-store.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
const job = { characterId: "taki", operationKey: "work", label: "Research", initialContext: { kind: "fresh" as const },
  direction: "Complete the research", materials: [], completionPolicy: "request_parent" as const };
const tools = { observe: tool({ inputSchema: z.object({}), execute: () => ({ observation: "Actual completed evidence" }) }) };
function loop(count: number, final = true) {
  return scriptedModel([...Array.from({ length: count }, (_, index) => ({ kind: "tool" as const, toolName: "observe", toolCallId: `observe-${index}`, input: {} })),
    ...(final ? [{ kind: "tool" as const, toolName: "complete_subagent", toolCallId: "final", input: { text: "Finished", materials: [] } }] : [])]);
}
async function start(model: MockLanguageModelV4, policy = { steps: 2, parentApprovals: 3 }) {
  const f = await subagentFixture(model, { tools }); fixtures.push(f);
  f.service.state.deps.checkInPolicy = () => policy;
  f.queue.tryAcquireBackground("taki");
  const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["observe"] }, job);
  const subagentId = accepted.conversation.subagentId;
  const workInputId = accepted.input!.inputId;
  const target = () => ({ subagentId, workInputId, expectedRunId: f.service.summary(subagentId).activeRunId,
    expectedControlVersion: f.service.summary(subagentId).controlVersion });
  const resume = (key: string, actor: "user" | "parent" = "parent") => f.service.continue({ characterId: "taki", target: target(),
    operationKey: key, direction: "", materials: [], replyToEventId: f.service.events.wait(workInputId)!.eventId },
  actor === "user" ? { kind: "user" } : { kind: "parent", runId: f.parent.run.runId });
  const paused = async () => vi.waitFor(() => {
    expect(f.service.summary(subagentId).activeRunId).toBeNull();
    expect(f.service.events.wait(workInputId)?.state).toBe("open");
  });
  return { ...f, model, accepted, subagentId, workInputId, target, resume, paused, policy };
}

describe("durable runtime check-in boundaries", () => {
  it("checks in generic record_only work without consuming a correction arriving on N or notifying its final result", async () => {
    let correctionId: string | undefined;
    const model = loop(1);
    const f = await subagentFixture(model, { tools: { observe: tool({ inputSchema: z.object({}), execute() {
      const child = f.children.list({ characterId: "taki" })[0]!;
      correctionId = f.service.sendCurrent({ characterId: "taki", subagentId: child.subagentId,
        operationKey: "arriving-on-N", direction: "Keep the pending correction intact", materials: [] },
      { kind: "parent", runId: f.parent.run.runId }).input!.inputId;
      return { observation: "Completed evidence" };
    } }) } });
    fixtures.push(f); f.queue.tryAcquireBackground("taki");
    f.service.state.deps.checkInPolicy = () => ({ steps: 1, parentApprovals: 3 });
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["observe"] },
      { ...job, completionPolicy: "record_only" });
    const child = accepted.conversation.subagentId; const work = accepted.input!.inputId;
    await vi.waitFor(() => expect(f.service.summary(child)).toMatchObject({ activeRunId: null, state: "needs_input" }));
    expect(model.doStreamCalls).toHaveLength(1);
    const wait = f.service.events.wait(work)!;
    expect(wait.reason).toBe("check_in");
    const event = f.service.events.get(wait.eventId);
    expect(event).toMatchObject({ eligible: true, suppressionReason: null });
    expect(JSON.parse(event.body!)).toMatchObject({ pendingInputs: 1 });
    expect(f.inputs.get(correctionId!).consumed).toBeNull();
    const current = f.service.summary(child);
    f.service.continue({ characterId: "taki", target: { subagentId: child, workInputId: work,
      expectedRunId: null, expectedControlVersion: current.controlVersion }, operationKey: "explicit-resume",
    direction: "", materials: [], replyToEventId: wait.eventId }, { kind: "user" });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("Keep the pending correction intact");
    expect(f.inputs.get(correctionId!).consumed).not.toBeNull();
    expect(f.service.events.list({ characterId: "taki" }).at(-1)).toMatchObject({ eligible: false, suppressionReason: "record_only" });
  });

  it.each([0, 1])("completion before/on N wins (preceding steps %s)", async (count) => {
    const f = await start(loop(count));
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(f.service.events.wait(f.workInputId)).toBeNull();
    expect(f.service.summary(f.subagentId).progress?.completedSteps).toBe(count + 1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL").get()?.n).toBe(count + 1);
  });

  it("counts across Runs, captures policy per interval, permits K approvals then requires the user", async () => {
    const f = await start(loop(10));
    for (let interval = 0; interval < 4; interval += 1) {
      await f.paused();
      const wait = f.service.events.wait(f.workInputId)!;
      expect(wait).toMatchObject({ reason: "check_in", checkIn: { completedSteps: (interval + 1) * 2,
        consecutiveParentApprovals: interval, requiredActor: interval === 3 ? "user" : "parent_or_user" } });
      if (interval < 3) {
        const request = { characterId: "taki", target: f.target(), operationKey: `approval-${interval}`, direction: "", materials: [], replyToEventId: wait.eventId };
        const a = f.service.continue(request, { kind: "parent", runId: f.parent.run.runId });
        const b = f.service.continue(request, { kind: "parent", runId: f.parent.run.runId });
        expect(a.input?.inputId).toBe(b.input?.inputId);
      }
    }
    expect(() => f.resume("fourth")).toThrow("SUBAGENT_CHECKIN_USER_REQUIRED");
    expect(f.service.attention({ characterId: "taki", limit: 20 }).entries).toContainEqual(expect.objectContaining({ kind: "check_in_user" }));
    f.service.sendCurrent({ characterId: "taki", subagentId: f.subagentId, workInputId: f.workInputId,
      operationKey: "trusted-guidance", direction: "Keep the result concise", materials: [] }, { kind: "user" });
    expect(f.service.summary(f.subagentId).progress?.consecutiveParentApprovals).toBe(0);
    expect(() => f.resume("still-user-only")).toThrow("SUBAGENT_CHECKIN_USER_REQUIRED");
    f.policy.steps = 4; f.policy.parentApprovals = 9;
    expect(f.service.events.wait(f.workInputId)?.checkIn?.requiredActor).toBe("user");
    f.resume("user", "user");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(f.service.summary(f.subagentId).progress).toMatchObject({ completedSteps: 11, intervalStartSteps: 8,
      intervalSteps: 4, parentApprovalLimit: 9, consecutiveParentApprovals: 0 });
    expect(f.service.summary(f.subagentId).tokenUsage).toMatchObject({ modelEffects: 11, totalTokens: 88, complete: true });
    expect(f.errors).toEqual([]);
  });

  it("counts an empty-message completed SDK step exactly once and produces a factual snapshot", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: {
        inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 0, text: undefined, reasoning: undefined } } },
    ] }) }) });
    const f = await start(model, { steps: 1, parentApprovals: 0 }); await f.paused();
    const step = f.db.prepare("SELECT * FROM subagent_task_steps").get()!;
    f.db.transaction(() => createSubagentProgressRepo(f.db).complete({ runId: String(step.run_id), attemptId: String(step.attempt_id), stepNumber: Number(step.step_number) }));
    expect(f.service.summary(f.subagentId).progress?.completedSteps).toBe(1);
    const events = f.service.events.list({ characterId: "taki" }); expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.body!)).toMatchObject({ reportKind: "Core progress snapshot", latestWorkerText: null });
    expect(f.db.prepare("SELECT count(*) AS n FROM run_messages WHERE entry_kind='output'").get()?.n).toBe(0);
    expect(f.service.summary(f.subagentId).tokenUsage?.totalTokens).toBe(0);
  });

  it("ordinary question at N stays a question and answering creates the due check-in before another dispatch", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "interact_parent", toolCallId: "question", input: { kind: "needs_input", text: "Which source?" } },
      { kind: "tool", toolName: "complete_subagent", toolCallId: "final", input: { text: "Done", materials: [] } }]);
    const f = await start(model, { steps: 1, parentApprovals: 3 }); await f.paused();
    const question = f.service.events.wait(f.workInputId)!; expect(question.reason).toBe("question");
    f.service.send({ characterId: "taki", target: f.target(), operationKey: "answer", direction: "Source A", materials: [], replyToEventId: question.eventId }, { kind: "parent", runId: f.parent.run.runId });
    await f.paused();
    expect(f.service.events.wait(f.workInputId)?.reason).toBe("check_in");
    expect(model.doStreamCalls).toHaveLength(1);
    f.resume("approved");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
  });

  it("accepts exact check-in continuation before producer release without reopening its wait or exceeding N", async () => {
    const create = workStores.createRunMessageStore;
    vi.spyOn(workStores, "createRunMessageStore").mockImplementation((input) => {
      const store = create(input);
      return { ...store, recordCompletedStep(step) { store.recordCompletedStep(step); store.recordCompletedStep(step); } };
    });
    const f = await start(loop(3)); let answered = false; let producerWasActive = false;
    f.service.state.deps.changed = () => {
      const wait = f.service.events.wait(f.workInputId);
      if (answered || wait?.reason !== "check_in" || wait.state !== "open") return;
      answered = true; producerWasActive = f.service.summary(f.subagentId).activeRunId !== null;
      const input = { characterId: "taki", target: f.target(), operationKey: "early-checkin-answer", direction: "", materials: [], replyToEventId: wait.eventId };
      expect(() => f.service.continue(input, { kind: "core", ownerRef: "automatic-owner" })).toThrow("SUBAGENT_CHECKIN_AUTHORITY_REQUIRED");
      f.service.continue(input, { kind: "user" });
    };
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
    expect(producerWasActive).toBe(true); expect(f.service.events.wait(f.workInputId)?.state).toBe("answered");
    expect(f.executions.list({ subagentId: f.subagentId })).toHaveLength(2);
    expect(f.service.summary(f.subagentId).progress?.completedSteps).toBe(4);
  });

  it("preserves the interval and approvals when the service is recreated and waits for explicit continuation", async () => {
    const f = await start(loop(5)); await f.paused(); f.resume("one"); await f.paused();
    const before = f.service.summary(f.subagentId).progress;
    await f.service.close();
    const service = createSubagentService(f.service.state.deps);
    try {
      service.released(); await new Promise((resolve) => setImmediate(resolve));
      expect(service.summary(f.subagentId).progress).toEqual(before);
      expect(f.model.doStreamCalls).toHaveLength(4);
      service.continue({ characterId: "taki", target: f.target(), operationKey: "after-restart", direction: "", materials: [],
        replyToEventId: service.events.wait(f.workInputId)!.eventId }, { kind: "parent", runId: f.parent.run.runId });
      await vi.waitFor(() => expect(service.events.list({ characterId: "taki" }).at(-1)?.kind).toBe("final"));
      expect(service.summary(f.subagentId).progress).toMatchObject({ completedSteps: 6, consecutiveParentApprovals: 2 });
    } finally { await service.close(); }
  });

  it("rolls back failed checkpoint persistence and fences the next actual model request", async () => {
    const f = await start(loop(5));
    f.db.exec("CREATE TRIGGER reject_checkin BEFORE INSERT ON subagent_checkins BEGIN SELECT RAISE(ABORT,'checkpoint refused'); END;");
    await vi.waitFor(() => expect(f.executions.list({ subagentId: f.subagentId })[0]?.result?.outcome).toBe("failed"));
    expect(f.model.doStreamCalls).toHaveLength(2);
    expect(f.service.summary(f.subagentId).progress?.completedSteps).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_checkins").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_input_waits").get()?.n).toBe(0);
  });

  it("reaches N=50 across pressure rollovers with Utility usage included and no replayed task step", async () => {
    const model = loop(51); const summary = generatingModel("Task: complete research. Earlier read actions are complete; retain observed evidence and continue the pending research. No final result yet.");
    const f = await subagentFixture(model, { tools: { observe: tool({ inputSchema: z.object({}),
      execute: () => ({ evidence: "Grounded completed evidence. ".repeat(400) }),
      toModelOutput: ({ output }) => ({ type: "text", value: output.evidence.slice(0, 1100) }) }) },
    historyBudget: () => 2400, agent: { contextWindowTokens: () => 6200 }, utility: { model: summary,
      run: async (_label, action) => action(), usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) } });
    fixtures.push(f); f.queue.tryAcquireBackground("taki");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["observe"] }, job);
    const child = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.summary(child).state).toBe("needs_input"), { timeout: 15_000 });
    expect(model.doStreamCalls).toHaveLength(50); expect(summary.doGenerateCalls.length).toBeGreaterThan(1);
    expect(f.service.summary(child).progress?.completedSteps).toBe(50);
    expect(f.service.summary(child).tokenUsage?.modelEffects).toBe(50 + summary.doGenerateCalls.length);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL").get()?.n).toBe(50);
    expect(f.executions.list({ subagentId: child })).toHaveLength(1);
  });
});
