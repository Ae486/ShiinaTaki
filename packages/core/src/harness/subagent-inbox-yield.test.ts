import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { RunSnapshotSchema } from "@taki/shared";
import { scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { createRunServiceStub } from "../testing/run-service-stub.ts";
import { createSubagentService } from "./subagent-service.ts";

const ANSWER = "The combined review is already answered in this foreground reply.";
const CHAT = "I am still here while the background review continues.";
const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.close();
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type Mode = "read" | "natural" | "cap" | "write" | "unknown" | "failed" | "action" | "cancel" | "recording" | "drain";
async function yielded(mode: Mode = "read", capture?: (runId: string) => Promise<void>) {
  const entered = gate();
  const releaseModel = gate();
  cleanups.push(() => releaseModel.resolve());
  let childCalls = 0; let idleCalls = 0; let foregroundCalls = 0;
  let stopCalls = 0;
  let foreground = ""; let drainedFailure = false;
  const publications: Array<{ eventId: string; consumerRunId: string; actionId: string }> = [];
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    const names = options.tools?.map((entry) => entry.name) ?? [];
    if (names.includes("complete_subagent")) {
      childCalls += 1;
      const progress = mode === "action" && childCalls === 1;
      return scriptedModel([{ kind: "tool", toolCallId: progress ? "progress" : "final",
        toolName: progress ? "interact_parent" : "complete_subagent",
        input: progress ? { kind: "message", text: "Earlier progress" } : { text: "Completed synthetic review", materials: [] } }]).doStream(options);
    }
    if (!names.includes("read_agent_inbox")) {
      foregroundCalls += 1;
      return streamingMockModel([foreground]).doStream(options);
    }
    idleCalls += 1;
    const events = f.service.events.list({ characterId: "taki" });
    const event = events.at(-1)!;
    if (idleCalls === 1) {
      const instructions = options.prompt.filter((entry) => entry.role === "system").map((entry) => entry.content).join("\n");
      expect(instructions).toContain("retain the available evidence and end this handler");
      expect(instructions).toContain("only newly delivered events");
      expect(instructions).toContain("inspect its retained results once before treating it as pending");
      expect(instructions).toContain("complete integrated user-facing final answer in note");
      expect(instructions).toContain("An accepted proposal is not proof of publication");
      entered.resolve(); await releaseModel.promise;
      if (mode === "natural") return streamingMockModel(["Private natural stop without a disposition"]).doStream(options);
      if (mode === "write" || mode === "unknown" || mode === "failed") {
        const consumer = f.db.prepare("SELECT run_id,attempt_id FROM subagent_inbox_consumers ORDER BY created_at DESC LIMIT 1").get()!;
        const effect = f.effects.prepare({ runId: String(consumer.run_id), attemptId: String(consumer.attempt_id), kind: "tool",
          sourceRef: { type: "tool", toolName: mode === "write" ? "workspace.file.write" : "core.subagent.read" }, replayPosture: "never" });
        f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
          expectedVersion: effect.version, outcome: mode === "unknown" ? "outcome_unknown" : mode === "failed" ? "failed" : "completed" });
      }
      const read = { toolCallId: "read", toolName: "read_agent_inbox", input: { eventId: event.eventId, offset: 0, limit: 16000 } };
      return mode === "action" ? scriptedModel([{ kind: "tools", calls: [{ toolCallId: "handled-first", toolName: "handle_agent_event",
        input: { eventId: events[0]!.eventId, operationKey: "prior-action", action: { kind: "retained", note: "Earlier progress retained" } } }, read] }]).doStream(options)
        : scriptedModel([{ kind: "tool", ...read }]).doStream(options);
    }
    expect(idleCalls).toBe(2);
    const prompt = JSON.stringify(options.prompt);
    expect(prompt).toContain("same event batch");
    if (foreground) expect(prompt).toContain(foreground);
    return scriptedModel([{ kind: "tool", toolCallId: "handle", toolName: "handle_agent_event", input: {
      eventId: event.eventId, operationKey: "one-successor-action",
      action: foreground === CHAT ? { kind: "speech_proposed", note: "The pending synthetic review is ready." }
        : { kind: "retained", note: "The foreground already answered, or this review requires no public reply." },
    } }]).doStream(options);
  } });
  const f = await subagentFixture(model, { agent: { maxSteps: mode === "cap" ? 1 : 10 },
    ...(capture ? { snapshot: { async capture(request, runId, options) {
      if (options?.workScope?.kind === "agent-inbox") await capture(runId);
      const stub = await createRunServiceStub().admit(request);
      return { snapshot: RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(stub.snapshot),
        context: { authorityCurrent: () => true, tools: {}, memoryTools: {} } };
    } } } : {}) }); fixtures.push(f);
  f.service.state.deps.reports = { canReply: () => true, stageReply: async () => undefined, closeWork() {},
    stageEventReply: async (input) => { publications.push(input); } };
  const stream = f.agent.stream;
  f.agent.stream = async function* (params, turn) {
    const work = turn?.workContext;
    const stop = work?.stop;
    if (turn && work?.scope.kind === "agent-inbox" && stop) {
      turn.workContext = { ...work, stop: (options) => { stopCalls += 1; return stop(options); } };
    }
    yield* stream(params, turn);
    if (mode === "drain" && !drainedFailure && work?.scope.kind === "agent-inbox") {
        drainedFailure = true; throw new Error("synthetic post-drain observer failure");
    }
  };
  const initial = f.queue.tryAcquireBackground("taki")!;
  cleanups.push(initial);
  await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
    characterId: "taki", operationKey: "work", label: "Worker", initialContext: { kind: "fresh" },
    direction: "Complete the synthetic review", materials: [], completionPolicy: "request_parent" });
  await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(mode === "action" ? 2 : 1));
  initial(); f.service.released();
  await entered.promise;
  const consumer = f.db.prepare("SELECT consumer_id,run_id,attempt_id FROM subagent_inbox_consumers ORDER BY created_at DESC LIMIT 1").get()!;
  const consumerId = String(consumer.consumer_id); const runId = String(consumer.run_id);
  const primary = f.queue.reservePrimary("taki"); f.service.yieldInbox("taki");
  cleanups.push(() => primary.cancel());
  const acquired = primary.acquire();
  if (mode === "cancel") expect(f.turns.cancel("taki", runId)).toBe(true);
  if (mode === "recording") {
    const record = f.messages.recordStep;
    vi.spyOn(f.messages, "recordStep").mockImplementation((input) => {
      if (input.runId === runId) throw new Error("synthetic private recording failure");
      return record(input);
    });
  }
  releaseModel.resolve();
  const releasePrimary = await acquired;
  cleanups.push(releasePrimary);
  await vi.waitFor(() => expect(f.db.prepare("SELECT state FROM subagent_inbox_consumers WHERE consumer_id=:id").get({ id: consumerId })?.state)
    .toBe("reconciliation_needed"));
  const eventId = f.service.events.list({ characterId: "taki" }).at(-1)!.eventId;
  const originalIntents = f.db.prepare("SELECT * FROM subagent_inbox_deliveries WHERE consumer_id=:id").all({ id: consumerId });
  return { ...f, model, consumerId, runId, eventId, originalIntents, publications,
    counts: () => ({ childCalls, idleCalls, foregroundCalls }),
    stopCalls: () => stopCalls,
    async foreground(text: string) {
      foreground = text;
      for await (const delta of f.agent.stream({ characterId: "taki", message: "Foreground request while the inbox yields" },
        { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, turnKind: "primary" })) { void delta; }
      f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "completed");
    },
    release() { releasePrimary(); f.service.released(); },
  };
}

it.each([ANSWER, CHAT])("continues the same batch after foreground priority with fresh public context: %s", async (foreground) => {
  const f = await yielded();
  for (let i = 0; i < 5; i++) f.service.released();
  await Promise.resolve(); await Promise.resolve();
  expect(f.counts().idleCalls).toBe(1);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
  await f.foreground(foreground);
  f.release();
  await vi.waitFor(() => expect(f.service.events.get(f.eventId).state).toBe("handled"));
  for (let i = 0; i < 5; i++) f.service.released();
  await Promise.resolve(); await Promise.resolve();
  expect(f.counts()).toEqual({ childCalls: 1, idleCalls: 2, foregroundCalls: 1 });
  const successors = f.db.prepare("SELECT * FROM subagent_inbox_resumes").all();
  expect(successors).toHaveLength(1);
  expect(successors[0]).toMatchObject({ previous_consumer_id: f.consumerId, operation_key: `cooperative-yield:${f.consumerId}` });
  expect(f.db.prepare("SELECT * FROM subagent_inbox_deliveries WHERE consumer_id=:id").all({ id: f.consumerId })).toEqual(f.originalIntents);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_event_actions").get()?.n).toBe(1);
  const action = JSON.parse(String(f.db.prepare("SELECT action_json FROM subagent_event_actions").get()?.action_json));
  expect(action.kind).toBe(foreground === ANSWER ? "retained" : "speech_proposed");
  await vi.waitFor(() => expect(f.publications).toHaveLength(foreground === ANSWER ? 0 : 1));
  expect(f.conversation.history("taki").filter((entry) => entry.role === "assistant").map((entry) => entry.content)).toEqual([foreground]);
  const oldSnapshot = f.runs.status(f.runId).run.snapshot.snapshotId;
  const successor = f.db.prepare("SELECT run_id FROM subagent_inbox_consumers WHERE consumer_id=:id").get({ id: String(successors[0]!.consumer_id) })!;
  expect(f.runs.status(String(successor.run_id)).run.snapshot.snapshotId).not.toBe(oldSnapshot);
  expect(f.errors).toEqual([]);
});

it.each<Mode>(["natural", "cap", "write", "unknown", "failed", "action", "cancel", "recording", "drain"])(
  "does not certify %s as a resumable read-only yield", async (mode) => {
    const f = await yielded(mode);
    f.release();
    for (let i = 0; i < 5; i++) f.service.released();
    await Promise.resolve(); await Promise.resolve();
    expect(f.counts().idleCalls).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
    expect(f.service.events.get(f.eventId).state).toBe("delivered");
    if (mode === "cap") expect(f.stopCalls()).toBe(0);
  },
);

it("consumes the certificate once when fresh resume admission fails and leaves explicit recovery", async () => {
  const f = await yielded();
  const admission = vi.spyOn(f.runs, "admitLinked").mockRejectedValueOnce(new Error("synthetic fresh capture failure"));
  f.release();
  await vi.waitFor(() => expect(f.errors).toContain("SUBAGENT_INBOX_YIELD_CONTINUATION_UNAVAILABLE"));
  for (let i = 0; i < 5; i++) f.service.released();
  await Promise.resolve(); await Promise.resolve();
  expect(admission).toHaveBeenCalledTimes(1);
  expect(f.counts().idleCalls).toBe(1);
  expect(f.service.inboxRecovery({ characterId: "taki", limit: 20 }).entries[0]).toMatchObject({ consumerId: f.consumerId, canResume: true });
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
});

it("discards pending certificates on shutdown rather than reconstructing them from completed Runs", async () => {
  const f = await yielded();
  await f.service.close();
  f.release();
  const restored = createSubagentService(f.service.state.deps);
  try {
    restored.released(); await Promise.resolve(); await Promise.resolve();
    expect(f.counts().idleCalls).toBe(1);
    expect(restored.inboxRecovery({ characterId: "taki", limit: 20 }).entries[0]).toMatchObject({ canResume: true });
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
  } finally { await restored.close(); }
});

it("preserves explicit recovery idempotency when it wins before a pending automatic continuation", async () => {
  const f = await yielded();
  f.release();
  const input = { characterId: "taki", consumerId: f.consumerId, operationKey: randomUUID() };
  const resumed = await f.service.resumeInbox(input);
  await vi.waitFor(() => expect(f.service.events.get(f.eventId).state).toBe("handled"));
  const repeated = await f.service.resumeInbox(input);
  expect(repeated).toMatchObject({ runId: resumed.runId, reused: true });
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(1);
  expect(f.counts().idleCalls).toBe(2);
});

it("preserves a pending certificate when explicit recovery is refused by the busy foreground lane", async () => {
  const f = await yielded();
  await expect(f.service.resumeInbox({ characterId: "taki", consumerId: f.consumerId, operationKey: randomUUID() }))
    .rejects.toThrow("SUBAGENT_INBOX_BUSY");
  f.release();
  await vi.waitFor(() => expect(f.service.events.get(f.eventId).state).toBe("handled"));
  expect(f.db.prepare("SELECT operation_key FROM subagent_inbox_resumes").get()?.operation_key)
    .toBe(`cooperative-yield:${f.consumerId}`);
  expect(f.counts().idleCalls).toBe(2);
  expect(f.errors).toEqual([]);
});

it.each(["release", "cancel"])("defers a fully rolled-back capture when foreground %s races it", async (kind) => {
  const capturing = gate();
  const finishCapture = gate();
  const attempts: string[] = [];
  cleanups.push(() => finishCapture.resolve());
  const f = await yielded("read", async (runId) => {
    attempts.push(runId);
    if (attempts.length === 1) { capturing.resolve(); await finishCapture.promise; }
  });
  f.release(); await capturing.promise;
  const primary = f.queue.reservePrimary("taki"); f.service.yieldInbox("taki");
  cleanups.push(() => primary.cancel());
  if (kind === "cancel") {
    primary.cancel();
    // This hint occurs while capture still holds the lane, before the certificate is restored.
    f.service.released(); finishCapture.resolve();
  } else {
    const acquired = primary.acquire(); finishCapture.resolve();
    const release = await acquired; cleanups.push(release);
    await Promise.resolve(); await Promise.resolve();
    expect(attempts).toHaveLength(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
    release(); f.service.released();
  }
  await vi.waitFor(() => expect(f.service.events.get(f.eventId).state).toBe("handled"));
  expect(attempts).toHaveLength(2);
  expect(f.db.prepare("SELECT 1 FROM runs WHERE run_id=:id").get({ id: attempts[0]! })).toBeUndefined();
  expect(f.db.prepare("SELECT 1 FROM run_effects WHERE run_id=:id").get({ id: attempts[0]! })).toBeUndefined();
  expect(f.db.prepare("SELECT 1 FROM subagent_inbox_consumers WHERE run_id=:id").get({ id: attempts[0]! })).toBeUndefined();
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(1);
  expect(f.db.prepare("SELECT * FROM subagent_inbox_deliveries WHERE consumer_id=:id").all({ id: f.consumerId })).toEqual(f.originalIntents);
  expect(f.counts().idleCalls).toBe(2);
  expect(f.errors).toEqual([]);
});
