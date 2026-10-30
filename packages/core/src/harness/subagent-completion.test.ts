import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createRecoveryCoordinator } from "./recovery-coordinator.ts";
import { createSubagentService } from "./subagent-service.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
const job = { characterId: "taki", operationKey: "a", label: "Research", initialContext: { kind: "fresh" as const },
  direction: "Check this", materials: [], completionPolicy: "request_parent" as const, lifetimeMinutes: 30 };
const child = { kind: "tool" as const, toolCallId: "child-result", toolName: "complete_subagent", input: { text: "Child answer", materials: [] } };
const decision = (value: "internal_result" | "no_action" = "internal_result") => ({ kind: "tool" as const,
  toolCallId: "parent-result", toolName: "handle_agent_event", input: { eventId: "delivered-event", operationKey: "retain-result",
    action: { kind: value === "internal_result" ? "retained" : "no_action", note: "Parent synthesis" } } });
function eventModel(steps: Parameters<typeof scriptedModel>[0]) {
  let index = 0;
  return new MockLanguageModelV4({ doStream: async (options) => {
    const step = steps[index++];
    if (!step) throw new Error("UNEXPECTED_MODEL_REQUEST");
    if (step.kind === "tool" && step.toolName === "handle_agent_event") {
      const prompt = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      const eventId = prompt.match(/"eventId":"([^"]+)"/)?.[1];
      if (!eventId) throw new Error("DELIVERED_EVENT_MISSING_FROM_MODEL_REQUEST");
      return scriptedModel([{ ...step, input: { ...(step.input as Record<string, unknown>), eventId } }]).doStream(options);
    }
    return scriptedModel([step]).doStream(options);
  } });
}

describe("committed child completion through shared Runtime", () => {
  it.each(["expired", "retired_source"] as const)("refuses %s continuation before clearing the user latch or accepting input", async (reason) => {
    const model = scriptedModel([child]); const f = await subagentFixture(model); fixtures.push(f);
    let sourceCurrent = true;
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [],
      source: { ownerRef: "test-source", revision: "1" }, checkCurrent: () => sourceCurrent
        ? { state: "current" } : { state: "retired", reason: "source_retired" } }, { ...job, completionPolicy: "record_only" });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toBeTruthy());
    const finished = f.service.summary(accepted.conversation.subagentId);
    f.service.stop({ characterId: "taki", target: { subagentId: finished.subagentId, workInputId: accepted.input!.inputId,
      expectedRunId: null, expectedControlVersion: finished.controlVersion } }, "user");
    const stopped = f.service.summary(finished.subagentId);
    try {
      if (reason === "expired") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(accepted.input!.workExpiresAt!)); }
      else sourceCurrent = false;
      expect(() => f.service.continue({ characterId: "taki", target: { subagentId: stopped.subagentId,
        workInputId: accepted.input!.inputId, expectedRunId: null, expectedControlVersion: stopped.controlVersion },
      operationKey: "must-not-accept", direction: "Continue", materials: [] }, { kind: "user" }))
        .toThrow(reason === "expired" ? "SUBAGENT_WORK_EXPIRED" : "SUBAGENT_CONTINUE_RETIRED");
      expect(f.children.get(stopped.subagentId)).toMatchObject({ stopOrigin: "user", controlVersion: stopped.controlVersion });
      expect(f.inputs.list({ subagentId: stopped.subagentId })).toHaveLength(1);
      expect(f.executions.list({ subagentId: stopped.subagentId })).toHaveLength(1);
      expect(model.doStreamCalls).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(["internal_result", "no_action"] as const)("retains %s after original parent stops, admits once and never speaks", async (kind) => {
    const model = eventModel([child, decision(kind)]); const f = await subagentFixture(model); fixtures.push(f);
    const release = f.queue.tryAcquireBackground("taki")!;
    await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, job);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).filter((event) => event.eligible)).toHaveLength(1));
    expect(model.doStreamCalls).toHaveLength(1);
    f.runs.requestCancel(f.parent.run.runId); f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "cancelled");
    release(); f.service.released();
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
    const action = f.db.prepare("SELECT * FROM subagent_event_actions").get()!;
    expect(JSON.parse(String(action.action_json)).kind).toBe(kind === "internal_result" ? "retained" : "no_action");
    const consumer = f.db.prepare("SELECT run_id FROM subagent_inbox_consumers WHERE consumer_id=:id").get({ id: String(action.consumer_id) })!;
    const parentRunId = String(consumer.run_id);
    f.service.released(); f.service.released(); await Promise.resolve();
    expect(model.doStreamCalls).toHaveLength(2);
    expect(parentRunId).not.toBe(f.parent.run.runId);
    expect(f.runs.status(f.parent.run.runId).run.state).toBe("cancelled");
    expect(f.runs.status(parentRunId).run).toMatchObject({ initiator: "subagent", deliveryClass: "internal" });
    expect(f.conversation.history("taki")).toEqual([]);
    expect(f.messages.list({ runId: parentRunId }).length).toBeGreaterThan(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM runs WHERE provenance_json LIKE '%core.subagent-inbox%'").get()?.n).toBe(1);
    expect(f.errors).toEqual([]);
  });

  it("independent B cannot withhold the deferred result of work A on the same child", async () => {
    const model = eventModel([child, { ...child, toolCallId: "b-result" }, decision()]);
    const f = await subagentFixture(model); fixtures.push(f);
    const release = f.queue.tryAcquireBackground("taki")!;
    const a = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, job);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).filter((event) => event.eligible)).toHaveLength(1));
    await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { ...job,
      operationKey: "b", subagentId: a.conversation.subagentId, completionPolicy: "record_only" });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: a.conversation.subagentId }).filter((row) => row.result)).toHaveLength(2));
    release(); f.service.released();
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).find((row) => row.workInputId === a.input!.inputId)?.state).toBe("handled"));
    expect(model.doStreamCalls).toHaveLength(3);
  });

  it("child mutation is not executable, while the admitted main continuation retains the same Memory tool", async () => {
    const mutation = vi.fn(async () => ({ ok: true }));
    const model = eventModel([
      { kind: "tool", toolCallId: "illegal-child-write", toolName: "memory_write", input: {} }, child,
      { kind: "tool", toolCallId: "main-write", toolName: "memory_write", input: {} }, decision(),
    ]);
    const f = await subagentFixture(model, { memoryTools: { memory_write: tool({ inputSchema: z.object({}), execute: mutation }) } }); fixtures.push(f);
    await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["memory_write"] }, job);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
    expect(model.doStreamCalls[0]?.tools?.some((entry) => entry.type === "function" && entry.name === "memory_write")).toBe(false);
    expect(model.doStreamCalls[2]?.tools?.some((entry) => entry.type === "function" && entry.name === "memory_write")).toBe(true);
    expect(mutation).toHaveBeenCalledOnce();
  });

  it("lost binding remains deferred and explicit user continuation creates a new Run without reopening old terminal work", async () => {
    const model = scriptedModel([child, child]); const f = await subagentFixture(model); fixtures.push(f);
    const a = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { ...job, completionPolicy: "record_only" });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: a.conversation.subagentId })[0]?.result).toMatchObject({ outcome: "completed" }));
    const original = f.executions.list({ subagentId: a.conversation.subagentId })[0]!;
    await f.service.close();
    const recovered = createSubagentService(f.service.state.deps);
    try {
      await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
      const view = recovered.summary(a.conversation.subagentId);
      recovered.continue({ characterId: "taki", target: { subagentId: view.subagentId, workInputId: a.input!.inputId,
        expectedControlVersion: view.controlVersion, expectedRunId: null }, operationKey: "explicit-continue", direction: "Continue", materials: [] }, { kind: "user" });
      await vi.waitFor(() => expect(f.executions.list({ subagentId: view.subagentId }).filter((row) => row.result)).toHaveLength(2));
      expect(f.runs.status(original.runId).run.state).toBe("completed");
      expect(f.runs.status(original.runId).attempts).toHaveLength(1);
    } finally { await recovered.close(); }
  });
});
