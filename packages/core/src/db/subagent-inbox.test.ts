import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createSubagentInboxRepo } from "./subagent-inbox-repo.ts";
import { createRecoveryCoordinator } from "../harness/recovery-coordinator.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function fixture(count = 1) {
  const model = scriptedModel(Array.from({ length: count }, (_, index) => ({ kind: "tool" as const, toolCallId: `final-${index}`,
    toolName: "complete_subagent", input: { text: "\u0001".repeat(5000), materials: [] } })));
  const f = await subagentFixture(model); fixtures.push(f);
  f.queue.tryAcquireBackground("taki");
  for (let index = 0; index < count; index++) {
    await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: `work-${index}`,
      label: `Worker ${index}`, initialContext: { kind: "fresh" }, direction: "Work", materials: [], completionPolicy: "request_parent" });
  }
  await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(count));
  return { ...f, inbox: createSubagentInboxRepo(f.db), claim: () => f.service.prepareInbox({ characterId: "taki",
    runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, actualInvocation: () => undefined })! };
}

describe("durable actual-intent inbox ownership", () => {
  it("keeps prepared events accepted, rolls failed model intent back and never recycles an actual delivered event", async () => {
    const f = await fixture(); const context = f.claim(); const event = f.service.events.list({ characterId: "taki" })[0]!;
    expect(event.state).toBe("accepted"); expect(f.inbox.backlog("taki").count).toBe(1);
    const intent = { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, kind: "model" as const,
      sourceRef: { type: "model" as const, provider: "test", modelId: "test" }, inputDigest: "d".repeat(64), replayPosture: "never" as const,
      onCommitIntent: (effect: Parameters<typeof context.commitModelIntent>[0]) => context.commitModelIntent(effect, 0) };
    f.db.exec("CREATE TRIGGER fail_inbox_intent BEFORE INSERT ON run_effects WHEN NEW.run_id='" + f.parent.run.runId + "' BEGIN SELECT RAISE(ABORT,'intent refused'); END;");
    expect(() => f.effects.prepare(intent)).toThrow("intent refused");
    expect(f.service.events.get(event.eventId).state).toBe("accepted"); expect(context.hasIntent()).toBe(false);
    f.db.exec("DROP TRIGGER fail_inbox_intent");
    const effect = f.effects.prepare(intent);
    expect(f.service.events.get(event.eventId).state).toBe("delivered"); expect(context.hasIntent()).toBe(true);
    context.dispose(); expect(f.inbox.readyCharacters()).toEqual([]);
    f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
      expectedVersion: effect.version, outcome: "completed" });
    f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "completed");
    expect(f.service.events.get(event.eventId)).toMatchObject({ state: "delivered", reconciliationNeeded: true });
    await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
    expect(f.inbox.readyCharacters()).toEqual([]);
  });

  it("atomically joins addressed input/action and returns the same receipt for an identical operation", async () => {
    const f = await fixture(); const context = f.claim(); const event = f.service.events.list({ characterId: "taki" })[0]!;
    const effect = f.effects.prepare({ runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, kind: "model",
      sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "e".repeat(64), replayPosture: "never",
      onCommitIntent: (value) => context.commitModelIntent(value, 0) });
    const child = f.children.get(event.subagentId);
    const action = { kind: "answered_child" as const, target: { subagentId: child.subagentId, workInputId: event.workInputId,
      expectedControlVersion: child.controlVersion, expectedRunId: null }, replyToEventId: null, direction: "An addressed correction" };
    let applied = 0;
    const operation = { consumerId: context.consumerId, eventId: event.eventId, operationKey: "same-operation", action,
      invocation: { invocationId: randomUUID(), runId: effect.runId, attemptId: effect.attemptId, toolCallId: "answer",
        toolName: "handle_agent_event", modelEffectId: effect.effectId, validationState: "accepted" as const },
      apply: () => { applied++; return f.inputs.accept({ subagentId: child.subagentId, operationKey: "accepted-answer",
        sender: { kind: "parent", runId: effect.runId }, direction: action.direction, materials: [],
        input: { kind: "message", workInputId: event.workInputId, expectedControlVersion: child.controlVersion, expectedRunId: null } }); } };
    f.db.exec("CREATE TRIGGER fail_action BEFORE INSERT ON subagent_event_actions BEGIN SELECT RAISE(ABORT,'action refused'); END;");
    expect(() => f.inbox.action(operation)).toThrow("action refused"); expect(f.inputs.list({ subagentId: child.subagentId })).toHaveLength(1);
    f.db.exec("DROP TRIGGER fail_action");
    const receipt = f.inbox.action(operation); expect(f.inbox.action(operation)).toEqual(receipt);
    expect(applied).toBe(2); expect(f.inputs.list({ subagentId: child.subagentId })).toHaveLength(2);
    expect(f.service.events.get(event.eventId).state).toBe("handled");
    expect(() => f.inbox.action({ ...operation, action: { ...action, direction: "Different" } })).toThrow("ALREADY_HANDLED");
    expect(() => f.db.exec("UPDATE subagent_event_actions SET operation_key='changed'")).toThrow("IMMUTABLE");
  });

  it("bounds escaped envelopes, exposes readable names and releases only claims without intent", async () => {
    const f = await fixture(3); const context = f.claim();
    expect(Buffer.byteLength(context.instructions, "utf8")).toBeLessThanOrEqual(16_384);
    expect(context.instructions).toContain("Worker 0");
    expect(f.inbox.get(context.consumerId).events).toHaveLength(1);
    expect(f.inbox.release(context.consumerId)).toBe(true);
    expect(f.service.events.list({ characterId: "taki" }).every((event) => event.state === "accepted")).toBe(true);
    expect(f.inbox.readyCharacters()).toEqual(["taki"]);
  });
});
