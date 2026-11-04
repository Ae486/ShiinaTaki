import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { SubagentInboxRecoveryResultSchema, SubagentInboxResumeResultSchema } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { randomUUID } from "node:crypto";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function fixture(config: { unknownEffect?: boolean; priorAction?: boolean } = {}) {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    const call = calls++;
    if (config.priorAction && call === 0) return scriptedModel([{ kind: "tool", toolCallId: "progress",
      toolName: "interact_parent", input: { kind: "message", text: "Earlier progress" } }]).doStream(options);
    const first = call === (config.priorAction ? 1 : 0);
    const event = f.service.events.list({ characterId: "taki" }).find((entry) => entry.state === "delivered");
    return scriptedModel([{ kind: "tool", toolCallId: first ? "final" : "handling", toolName: first ? "complete_subagent" : "handle_agent_event",
      input: first ? { text: "Result", materials: [] } : { eventId: event!.eventId, intent: "record", text: "Reconciled result", target: null } }]).doStream(options);
  } });
  const f = await subagentFixture(model); fixtures.push(f);
  const release = f.queue.tryAcquireBackground("taki")!;
  await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
    characterId: "taki", operationKey: "work", label: "Worker", initialContext: { kind: "fresh" },
    direction: "Work", materials: [], completionPolicy: "request_parent" });
  await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(config.priorAction ? 2 : 1));
  const context = f.service.prepareInbox({ characterId: "taki", runId: f.parent.run.runId,
    attemptId: f.parent.attempt.attemptId, actualInvocation: () => undefined })!;
  const effect = f.effects.prepare({ runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, kind: "model",
    sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "b".repeat(64), replayPosture: "never",
    onCommitIntent: (intent) => context.commitModelIntent(intent, 0) });
  f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
    expectedVersion: effect.version, outcome: "completed" });
  if (config.priorAction) f.service.inbox.action({ consumerId: context.consumerId,
    eventId: f.service.events.list({ characterId: "taki" })[0]!.eventId, operationKey: "original-action",
    action: { kind: "retained", note: "Original accepted note" }, invocation: { invocationId: randomUUID(),
      runId: effect.runId, attemptId: effect.attemptId, toolCallId: "original-handling", toolName: "handle_agent_event",
      modelEffectId: effect.effectId, validationState: "accepted" }, apply: () => ({ ok: true, retained: "Original result witness" }) });
  if (config.unknownEffect) {
    const unknown = f.effects.prepare({ runId: effect.runId, attemptId: effect.attemptId, kind: "host",
      sourceRef: { type: "host", operationId: "uncertain-host-operation" }, replayPosture: "never" });
    f.effects.settle({ effectId: unknown.effectId, runId: unknown.runId, attemptId: unknown.attemptId,
      expectedVersion: unknown.version, outcome: "outcome_unknown" });
  }
  f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "failed");
  return { ...f, context, release, model, request: { characterId: "taki", consumerId: context.consumerId, operationKey: "explicit-resume" } };
}

describe("explicit inbox reconciliation", () => {
  it("exposes exact recovery, refuses a busy lane, preserves original intent and does not replay a repeated operation", async () => {
    const f = await fixture();
    const read = SubagentInboxRecoveryResultSchema.parse(f.service.inboxRecovery({ characterId: "taki", limit: 20 }));
    expect(read.entries).toHaveLength(1); expect(read.entries[0]).toMatchObject({ consumerId: f.context.consumerId, canResume: true });
    await expect(f.service.resumeInbox(f.request)).rejects.toThrow("INBOX_BUSY");
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
    f.release();
    const resumed = SubagentInboxResumeResultSchema.parse(await f.service.resumeInbox(f.request));
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
    const repeated = await f.service.resumeInbox(f.request);
    expect(repeated).toMatchObject({ runId: resumed.runId, consumerId: resumed.consumerId, reused: true });
    expect(f.model.doStreamCalls).toHaveLength(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_deliveries").get()?.n).toBe(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_event_actions").get()?.n).toBe(1);
    expect(f.service.inbox.readyCharacters()).toEqual([]);
  });

  it("rolls failed successor linkage back with Run admission and allows only a later explicit retry", async () => {
    const f = await fixture(); f.release();
    const before = f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n;
    f.db.exec("CREATE TRIGGER reject_resume BEFORE INSERT ON subagent_inbox_resumes BEGIN SELECT RAISE(ABORT,'resume refused'); END;");
    await expect(f.service.resumeInbox(f.request)).rejects.toThrow("resume refused");
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(before);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_consumers").get()?.n).toBe(1);
    expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("delivered");
    f.db.exec("DROP TRIGGER reject_resume");
    await f.service.resumeInbox(f.request);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
  });

  it("retains historical action outputs as context while handling only the missing disposition", async () => {
    const f = await fixture({ priorAction: true }); f.release();
    const original = f.db.prepare("SELECT * FROM subagent_event_actions").get();
    await f.service.resumeInbox(f.request);
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" }).every((event) => event.state === "handled")).toBe(true));
    expect(f.db.prepare("SELECT * FROM subagent_event_actions WHERE operation_key='original-action'").get()).toEqual(original);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_event_actions").get()?.n).toBe(2);
    expect(JSON.stringify(f.model.doStreamCalls.at(-1)?.prompt)).toContain("Original result witness");
    await expect(f.service.resumeInbox({ ...f.request, operationKey: "stale-other-operation" })).rejects.toThrow("ALREADY_RESUMING");
  });

  it("refuses unknown non-model effects without changing consumers or starting another model request", async () => {
    const f = await fixture({ unknownEffect: true }); f.release();
    expect(f.service.inboxRecovery({ characterId: "taki", limit: 20 }).entries[0]).toMatchObject({
      canResume: false, reason: "SUBAGENT_INBOX_UNCERTAIN_EFFECT" });
    await expect(f.service.resumeInbox(f.request)).rejects.toThrow("UNCERTAIN_EFFECT");
    expect(f.model.doStreamCalls).toHaveLength(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_resumes").get()?.n).toBe(0);
  });
});
