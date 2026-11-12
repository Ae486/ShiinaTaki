import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createConversationStore } from "../agents/conversation-store.ts";
import { MockLanguageModelV4 } from "ai/test";
import { scriptedModel } from "../testing/mock-language-model.ts";

const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
it("retains a committed shared-child plan before publishing from the accepted root", async () => {
  const f = await coWatchingFixture(); fixtures.push(f); f.start();
  await vi.waitFor(() => expect(f.session().status).not.toBe("starting"));
  await vi.waitFor(() => expect(["ready", "failed"]).toContain(f.session().status));
  expect(f.errors).toEqual([]);
  expect(f.session().status).toBe("ready");
  const view = f.session(); expect(view.subagentId).toBeDefined(); expect(view.workInputId).toBeDefined();
  const current = f.subagents.summary(view.subagentId!);
  const result = f.subagents.result({ characterId: "taki", completionId: current.latestCompletionId! }).result;
  expect(result.child).toMatchObject({ outcome: "completed", outputKind: "validated", workInputId: view.workInputId });
  expect(result.completionState).toBe("not_requested");
  expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  expect(f.messages.history({ subagentId: view.subagentId! }).length).toBeGreaterThan(0);
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged();
  await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
  const speech = f.timeline.latestAscending("taki", 10)[0]!;
  expect(speech.sourceContext).toMatchObject({ generatedBy: { runId: result.child.runId, attemptId: result.child.attemptId },
    materials: [{ label: "Fixture video", time: "10-20 seconds; moment first" }] });
  const root = f.db.prepare("SELECT run_id FROM runs WHERE trigger_request_id=:request").get({ request: f.input.requestId })!;
  const delivery = f.db.prepare("SELECT r.parent_run_id FROM run_deliveries d JOIN runs r ON r.run_id=d.run_id WHERE d.timeline_seq=:seq").get({ seq: speech.seq });
  expect(delivery?.parent_run_id).toBe(root.run_id); expect(root.run_id).not.toBe(result.child.runId);
  f.runtime.stop("taki", view.sessionId);
  // Stop revokes publication synchronously; drain runtime and child owner callbacks before retiring their files.
  await f.runtime.close();
  await f.subagents.close();
  await rename(join(f.workspaceRoot, "co-watching-inputs"), join(f.workspaceRoot, "retired-inputs"));
  await rename(join(f.workspaceRoot, "co-watching"), join(f.workspaceRoot, "retired-artifacts"));
  const replay = createConversationStore({ repo: f.timeline }).history("taki");
  expect(JSON.stringify(replay)).toContain("Fixture video"); expect(JSON.stringify(replay)).toContain("moment first");
  expect(replay[0]?.role).toBe("assistant");
});

it("keeps a user-stopped child paused through owner revisions until exact user continuation", async () => {
  const f = await coWatchingFixture(); fixtures.push(f); f.start();
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  const view = f.session(); const current = f.subagents.summary(view.subagentId!);
  f.subagents.stop({ characterId: "taki", target: { subagentId: view.subagentId!, workInputId: view.workInputId!,
    expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } }, "user");
  await vi.waitFor(() => expect(f.session().status).toBe("paused_child"));
  f.runtime.revise({ characterId: "taki", sessionId: view.sessionId, instruction: "Keep it brief" });
  f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged(); f.runtime.released();
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
  const stopped = f.subagents.summary(view.subagentId!); expect(stopped.stopOrigin).toBe("user");
  f.subagents.continue({ characterId: "taki", target: { subagentId: view.subagentId!, workInputId: view.workInputId!,
    expectedRunId: stopped.activeRunId, expectedControlVersion: stopped.controlVersion },
    operationKey: randomUUID(), direction: "Continue this accepted plan", materials: [] }, { kind: "user" });
  await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
  expect(f.generate).toHaveBeenCalledTimes(2);
  const artifacts = f.executions!.list({ subagentId: view.subagentId! }).map((execution) => execution.result?.artifact?.reference);
  expect(new Set(artifacts).size).toBe(2); expect(f.errors).toEqual([]);
});

it("yields shared child execution to foreground and resumes with a fresh Run artifact", async () => {
  const f = await coWatchingFixture(); fixtures.push(f);
  const original = f.generate.getMockImplementation()!; let finish!: () => void;
  f.generate.mockImplementationOnce(async (control, signal) => {
    await new Promise<void>((resolve) => { finish = resolve; }); await original(control, signal);
  });
  f.start(); await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
  const reservation = f.queue.reservePrimary("taki"); finish();
  const release = await reservation.acquire();
  const view = f.session(); const child = f.subagents.summary(view.subagentId!);
  expect(child.stopOrigin).toBeNull(); expect(f.generate).toHaveBeenCalledTimes(1);
  release(); f.runtime.released();
  await vi.waitFor(() => expect(f.session().status).toBe("ready"));
  expect(f.generate).toHaveBeenCalledTimes(2);
  const revisions = f.generate.mock.calls.map(([control]) => /with revision ([0-9a-f-]+)/.exec(control)?.[1]);
  expect(new Set(revisions).size).toBe(2);
  expect(f.executions!.list({ subagentId: view.subagentId! }).map((execution) => execution.result?.outcome).sort()).toEqual(["cancelled", "completed"]);
});

it.each([{ steps: 1, early: false }, { steps: 1, early: true }, { steps: 2, early: false }, { steps: 50, early: false }])(
  "preserves source-owned plan semantics at N=$steps with early answer=$early", async ({ steps, early }) => {
  let childCalls = 0;
  let answeredWhileActive = false;
  const instructions: string[] = [];
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    const prompt = options.prompt.flatMap((message) => typeof message.content === "string" ? [message.content]
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
    if (options.tools?.some((entry) => entry.name === "handle_agent_event")) {
      const event = f.subagents.events.list({ characterId: "taki" }).find((entry) => entry.state === "delivered")!;
      return scriptedModel([{ kind: "tool", toolCallId: "retain", toolName: "handle_agent_event",
        input: { eventId: event.eventId, operationKey: "retain-checkin", action: { kind: "retained", note: "Waiting for explicit continuation" } } }]).doStream(options);
    }
    instructions.push(prompt); childCalls += 1;
    const match = /to (co-watching\/[^\s]+\.json) with revision ([0-9a-f-]+)/.exec(prompt)!;
    return scriptedModel([childCalls === 1 ? { kind: "tool", toolCallId: "write-plan", toolName: "write_file",
      input: { path: match[1], content: JSON.stringify({ revision: match[2], candidates: [{ candidateRef: "one", momentId: "first", text: "Grounded reaction" }] }) } }
      : { kind: "text", deltas: ["The validated artifact is ready."] }]).doStream(options);
  } });
  const f = await coWatchingFixture({ preparation: { model, modelId: "scripted" } }); fixtures.push(f);
  f.subagents.state.deps.checkInPolicy = () => ({ steps, parentApprovals: 3 });
  if (early) {
    const changed = f.subagents.state.deps.changed;
    f.subagents.state.deps.changed = (characterId, subagentId) => {
      changed(characterId, subagentId);
      const current = f.subagents.summary(subagentId); const wait = current.pendingRequest;
      if (answeredWhileActive || wait?.reason !== "check_in" || wait.state !== "open") return;
      answeredWhileActive = current.activeRunId !== null;
      f.subagents.continue({ characterId, target: { subagentId, workInputId: wait.workInputId,
        expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion }, operationKey: "early-source-continue",
      direction: "", materials: [], replyToEventId: wait.eventId }, { kind: "user" });
    };
  }
  f.start();
  if (steps === 1 && !early) {
    await vi.waitFor(() => expect(f.session().status).toBe("paused_child"));
    expect(f.session().reason).toBeNull(); expect(f.session().preparedCount).toBeNull();
    const view = f.session(); const current = f.subagents.summary(view.subagentId!);
    const wait = current.pendingRequest!;
    expect(wait.reason).toBe("check_in"); expect(wait.state).toBe("open");
    f.runtime.released(); f.runtime.released(); await new Promise((resolve) => setImmediate(resolve));
    expect(childCalls).toBe(1);
    f.subagents.continue({ characterId: "taki", target: { subagentId: view.subagentId!, workInputId: view.workInputId!,
      expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion }, operationKey: "source-continue",
    direction: "", materials: [], replyToEventId: wait.eventId }, { kind: "user" });
  }
  await vi.waitFor(() => expect(f.session().status, JSON.stringify({ errors: f.errors, view: f.session() })).toBe("ready"));
  expect(childCalls).toBe(2); expect(f.errors).toEqual([]); expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  const view = f.session(); const result = f.subagents.result({ characterId: "taki", completionId: f.subagents.summary(view.subagentId!).latestCompletionId! }).result;
  expect(result.child.outputKind).toBe("validated"); expect(result.completionState).toBe("not_requested");
  const paths = instructions.map((prompt) => /to (co-watching\/[^\s]+\.json) with revision ([0-9a-f-]+)/.exec(prompt)![1]);
  expect(new Set(paths).size).toBe(1);
  expect(f.subagents.summary(view.subagentId!).progress?.completedSteps).toBe(2);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_checkins").get()?.n).toBe(steps === 1 ? 1 : 0);
  expect(answeredWhileActive).toBe(early);
});

it("keeps an invalid natural final on N as a source validation failure without accepting a checkpoint", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    calls += 1;
    const prompt = options.prompt.flatMap((message) => typeof message.content === "string" ? [message.content]
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
    const path = /to (co-watching\/[^\s]+\.json) with revision/.exec(prompt)![1];
    return scriptedModel([calls === 1 ? { kind: "tool", toolCallId: "invalid-plan", toolName: "write_file",
      input: { path, content: JSON.stringify({ revision: "invalid", candidates: "not a plan" }) } }
      : { kind: "text", deltas: ["The proposed artifact is ready."] }]).doStream(options);
  } });
  const f = await coWatchingFixture({ preparation: { model, modelId: "scripted" } }); fixtures.push(f);
  f.subagents.state.deps.checkInPolicy = () => ({ steps: 2, parentApprovals: 3 }); f.start();
  await vi.waitFor(() => expect(f.session().status).toBe("failed"));
  const view = f.session();
  expect(view.reason).toBe("plan_invalid"); expect(calls).toBe(2);
  expect(f.subagents.summary(view.subagentId!).progress?.completedSteps).toBe(2);
  expect(f.subagents.events.wait(view.workInputId!)).toBeNull();
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_checkins").get()?.n).toBe(0);
  const result = f.executions!.list({ subagentId: view.subagentId! })[0]!.result!;
  expect(result.outcome).toBe("failed"); expect(result.outputKind).not.toBe("validated");
  expect(f.timeline.latestAscending("taki", 10)).toEqual([]); expect(f.send).not.toHaveBeenCalled();
});
