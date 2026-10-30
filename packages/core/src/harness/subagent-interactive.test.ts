import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptedModel, slowStreamingModel } from "../testing/mock-language-model.ts";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import type { SubagentActivity } from "@taki/shared";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close(); });
async function fresh(model: Parameters<typeof subagentFixture>[0]) {
  const f = await subagentFixture(model); fixtures.push(f); return f;
}
const job = { characterId: "taki", operationKey: "interactive", label: "Research", initialContext: { kind: "fresh" as const },
  direction: "Research and ask if blocked", materials: [], completionPolicy: "request_parent" as const };

describe("continuing interactive worker runtime", () => {
  it("accepts an async message, waits, keeps a parent answer queued under user Stop and continues the same work days later", async () => {
    const model = scriptedModel([
      { kind: "tool", toolCallId: "progress", toolName: "interact_parent", input: { kind: "message", text: "Found a source" } },
      { kind: "tool", toolCallId: "question", toolName: "interact_parent", input: { kind: "needs_input", text: "Which variant?" } },
      { kind: "tool", toolCallId: "final", toolName: "complete_subagent", input: { text: "The selected result", materials: [] } },
    ]);
    const f = await fresh(model); const release = f.queue.tryAcquireBackground("taki")!;
    const activity: SubagentActivity[] = []; f.service.activity.subscribe((event) => activity.push(event));
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, job);
    const subagentId = accepted.conversation.subagentId; const workInputId = accepted.input!.inputId;
    await vi.waitFor(() => expect(f.service.summary(subagentId).state).toBe("needs_input"));
    const question = f.service.events.list({ characterId: "taki" }).find((event) => event.kind === "needs_input")!;
    expect(model.doStreamCalls).toHaveLength(2);
    expect(f.service.events.list({ characterId: "taki" }).map((event) => event.kind)).toEqual(["message", "needs_input"]);
    expect(f.executions.list({ subagentId })[0]?.result?.outputKind).not.toBe("validated");
    expect(accepted.input!.workValidity).toEqual({ kind: "until_cancelled" });
    expect(f.runs.status(question.producerRunId).run.deadlineAt).toBeUndefined();
    const target = () => ({ subagentId, workInputId, expectedRunId: f.service.summary(subagentId).activeRunId,
      expectedControlVersion: f.service.summary(subagentId).controlVersion });
    f.service.stop({ characterId: "taki", target: target() }, "user");
    f.service.send({ characterId: "taki", target: target(), operationKey: "answer", direction: "Use B", materials: [],
      replyToEventId: question.eventId }, { kind: "parent", runId: f.parent.run.runId });
    expect(f.children.get(subagentId).stopOrigin).toBe("user");
    expect(f.service.events.wait(workInputId)).toMatchObject({ state: "answered" });
    await Promise.resolve(); expect(model.doStreamCalls).toHaveLength(2);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 4 * 86_400_000);
    f.service.continue({ characterId: "taki", target: target(), operationKey: "resume", direction: "Continue", materials: [] }, { kind: "user" });
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).some((event) => event.kind === "final")).toBe(true));
    const final = f.service.events.list({ characterId: "taki" }).at(-1)!;
    expect(final).toMatchObject({ kind: "final", eligible: true, throughWorkSeq: 3, workInputId });
    expect(f.executions.list({ subagentId })).toHaveLength(2);
    expect(f.conversation.history("taki")).toEqual([]);
    expect(activity.some((event) => event.activity.kind === "tool.received")).toBe(true);
    const snapshot = f.service.activityRead({ characterId: "taki", subagentId });
    expect(snapshot.activity.status).toBe("terminal"); expect(snapshot.coveredThroughStep).toBe(0);
    const page = f.service.conversation({ characterId: "taki", subagentId, direction: "newest", limit: 100 });
    expect(page.entries.filter((entry) => entry.kind === "input")).toHaveLength(3);
    expect(page.entries.filter((entry) => entry.kind === "event")).toHaveLength(3);
    expect(page.entries.filter((entry) => entry.kind === "control")).toHaveLength(1);
    expect(page.entries.filter((entry) => entry.kind === "message")).toHaveLength(0);
    expect(f.errors).toEqual([]); release();
  });

  it("does not reopen a wait when an exact answer arrives after acceptance but before terminal pointer release", async () => {
    const f = await fresh(scriptedModel([
      { kind: "tool", toolCallId: "ask", toolName: "interact_parent", input: { kind: "needs_input", text: "Choose" } },
      { kind: "tool", toolCallId: "done", toolName: "complete_subagent", input: { text: "Done", materials: [] } },
    ]));
    const release = f.queue.tryAcquireBackground("taki")!; let answered = false; let sawActive = false;
    f.service.state.deps.changed = (_character, subagentId) => {
      if (answered) return;
      const question = f.service.events.list({ characterId: "taki" }).find((event) => event.kind === "needs_input");
      if (!question) return;
      answered = true; const current = f.service.summary(subagentId); sawActive = current.activeRunId !== null;
      f.service.send({ characterId: "taki", target: { subagentId, workInputId: question.workInputId,
        expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion },
      operationKey: "early-answer", direction: "Option A", materials: [], replyToEventId: question.eventId }, { kind: "user" });
    };
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, job);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).some((event) => event.kind === "final")).toBe(true));
    expect(sawActive).toBe(true); expect(f.service.events.wait(accepted.input!.inputId)?.state).toBe("answered");
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })).toHaveLength(2);
    expect(f.errors).toEqual([]); release();
  });

  it("suppresses an actual Stop-derived terminal event and retains its private partial evidence", async () => {
    const model = slowStreamingModel(["One", "Two", "Three"], 100);
    const f = await fresh(model); const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, job);
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.activityRead({ characterId: "taki", subagentId }).activity.status).toBe("active"));
    const current = f.service.summary(subagentId);
    f.service.stop({ characterId: "taki", target: { subagentId, workInputId: accepted.input!.inputId,
      expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } }, "user");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(1));
    expect(f.service.events.list({ characterId: "taki" })[0]).toMatchObject({ kind: "interrupted", eligible: false, suppressionReason: "user_stop" });
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_consumers").get()?.n).toBe(0);
    expect(f.executions.list({ subagentId })[0]?.result?.outcome).toBe("cancelled");
  });
});
