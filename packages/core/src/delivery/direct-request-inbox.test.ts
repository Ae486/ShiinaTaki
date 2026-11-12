import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitDirectChild, commitInboxSpeech, directRequestReportFixture } from "../testing/direct-request-report-fixture.ts";
import { readSubagentSpeechPublication } from "../db/subagent-speech-repo.ts";
import { createDirectRequestReports } from "./direct-request-report.ts";
import { randomUUID } from "node:crypto";
import type { ToolInvocationSnapshot } from "../agents/tool-invocation.ts";

const fixtures: Awaited<ReturnType<typeof directRequestReportFixture>>[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-25T12:00:00.000Z"); });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
async function fixture() { const f = await directRequestReportFixture(); fixtures.push(f); return f; }

describe("original-request publication from canonical private inbox actions", () => {
  it("reuses an arbitrary legacy action key and original consumer when a successor retries the same reply", async () => {
    const f = await fixture();
    await commitDirectChild(f);
    const { input, event, consumer } = await commitInboxSpeech(f);
    const original = f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: event.eventId })!;
    const oldClaim = f.service.inbox.get(String(original.consumer_id));
    f.runs.settle(consumer.run.runId, consumer.attempt.attemptId, "failed");
    const consumerId = randomUUID();
    const successor = await f.runs.admitLinked({ triggerRequestId: randomUUID(), idempotencyKey: randomUUID(), characterId: "taki",
      initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: "core.subagent-inbox" } },
    { linked: { kind: "agent-inbox", consumerId, resumesConsumerId: oldClaim.consumerId, operationKey: "resume", validateTx() {} } });
    f.runs.start(successor.run.runId, successor.attempt.attemptId);
    let invocation: ToolInvocationSnapshot | undefined;
    const context = f.service.prepareInbox({ characterId: "taki", runId: successor.run.runId,
      attemptId: successor.attempt.attemptId, mode: "idle", actualInvocation: () => invocation })!;
    const effect = f.effects.prepare({ runId: successor.run.runId, attemptId: successor.attempt.attemptId, kind: "model",
      sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "e".repeat(64), replayPosture: "never",
      onCommitIntent: (effect) => context.commitModelIntent(effect, 0) });
    f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "completed" });
    f.service.state.deps.reports = f.reports;
    const execute = (text: string, override: Partial<ToolInvocationSnapshot> = {}) => {
      const toolCallId = randomUUID();
      invocation = { invocationId: randomUUID(), runId: effect.runId, attemptId: effect.attemptId, modelEffectId: effect.effectId,
        toolName: "handle_agent_event", toolCallId, validationState: "accepted", ...override };
      return context.tools.handle_agent_event!.execute!({ eventId: event.eventId, intent: "reply", text, target: null },
        { toolCallId, messages: [], context: {} });
    };
    expect(await execute("The final inbox answer.", { modelEffectId: "not-delivered" })).toMatchObject({ ok: false, code: "SUBAGENT_EVENT_NOT_DELIVERED" });
    expect(await execute("Changed answer")).toMatchObject({ ok: false, code: "SUBAGENT_EVENT_ALREADY_HANDLED" });
    expect(await execute("The final inbox answer.")).toEqual({ accepted: true });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(await execute("The final inbox answer.")).toEqual({ accepted: true });
    await vi.waitFor(() => expect(f.service.state.work.size).toBe(0));
    expect(readSubagentSpeechPublication(f.db, input)).toMatchObject({ status: "recorded", state: "sent" });
    expect(f.timeline.latestAscending("taki", 10).filter((row) => row.role === "assistant")).toMatchObject([
      { content: "The final inbox answer.", sourceContext: { generatedBy: { runId: consumer.run.runId } } },
    ]);
    expect(f.db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: event.eventId })).toEqual(original);
    expect(f.service.inbox.get(oldClaim.consumerId)).toMatchObject({ instructions: oldClaim.instructions, projectionDigest: oldClaim.projectionDigest });
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.errors).toEqual([]);
  });

  it("publishes exactly once from delivered speech and records a distinct publication outcome", async () => {
    const f = await fixture(); const { input, event, consumer } = await commitInboxSpeech(f);
    expect(f.service.events.get(event.eventId).state).toBe("handled");
    expect(readSubagentSpeechPublication(f.db, input)).toBeNull();
    await f.reports.stageEventReply(input);
    expect(readSubagentSpeechPublication(f.db, input)).toMatchObject({ status: "recorded", state: "sent" });
    const rows = f.timeline.latestAscending("taki", 10);
    expect(rows.filter((row) => row.role === "assistant")).toMatchObject([{ content: "The final inbox answer.",
      sourceContext: { generatedBy: { runId: consumer.run.runId, attemptId: consumer.attempt.attemptId },
        materials: [{ reference: `agent-event:${event.eventId}#${event.bodyDigest}` }] } }]);
    await f.reports.stageEventReply(input);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    expect(f.errors).toEqual([]);
  });

  it.each([{ deliver: false }, { handle: false }, { decision: "no_action" as const }])(
    "refuses uncommitted or non-speech evidence %j without a publication record", async (options) => {
      const f = await fixture(); const { input } = await commitInboxSpeech(f, options);
      await expect(f.reports.stageEventReply(input)).rejects.toThrow("SUBAGENT_SPEECH_PROPOSAL_NOT_FOUND");
      expect(readSubagentSpeechPublication(f.db, input)).toBeNull();
      expect(f.reports.canReply(f.work.inputId)).toBe(true);
      expect(f.send).not.toHaveBeenCalled();
    });

  it.each(["consumerRunId", "actionId", "eventId"] as const)("rejects a mismatched %s", async (key) => {
    const f = await fixture(); const { input } = await commitInboxSpeech(f);
    await expect(f.reports.stageEventReply({ ...input, [key]: "not-the-accepted-identity" }))
      .rejects.toThrow("SUBAGENT_SPEECH_PROPOSAL_NOT_FOUND");
    expect(readSubagentSpeechPublication(f.db, input)).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not renew freshness when the first staging happens after the accepted proposal expires", async () => {
    const f = await fixture(); const { input } = await commitInboxSpeech(f);
    vi.setSystemTime("2026-10-25T12:05:00.000Z");
    await f.reports.stageEventReply(input);
    expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "refused", reason: "revision_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.inputs.get(f.work.inputId).workValidity).toEqual({ kind: "until_cancelled" });
  });

  it("retains the same original right after no_action and publishes later same-work results across days", async () => {
    const f = await fixture(); const silent = await commitInboxSpeech(f, { decision: "no_action" });
    expect(f.service.events.get(silent.event.eventId).state).toBe("handled");
    expect(f.reports.canReply(f.work.inputId)).toBe(true);
    f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "later-input", sender: { kind: "parent", runId: f.parent.run.runId },
      direction: "Finish the answer.", materials: [], input: { kind: "message", workInputId: f.work.inputId,
        expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } });
    vi.setSystemTime("2026-10-28T12:00:00.000Z");
    const final = await commitInboxSpeech(f);
    await f.reports.stageEventReply(final.input);
    expect(readSubagentSpeechPublication(f.db, final.input)).toMatchObject({ status: "recorded", state: "sent" });
    expect(readSubagentSpeechPublication(f.db, silent.input)).toBeNull();
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("revokes queued speech through the actual committed child Stop operation", async () => {
    const f = await fixture(); const { input } = await commitInboxSpeech(f);
    f.service.state.deps.reports = f.reports;
    const release = f.queue.tryAcquireBackground("taki")!;
    await f.reports.stageEventReply(input);
    expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "deferred", reason: "foreground_busy" });
    f.service.stop({ characterId: "taki", target: { subagentId: f.child.subagentId, workInputId: f.work.inputId,
      expectedRunId: null, expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } }, "user");
    expect(f.children.get(f.child.subagentId).stopOrigin).toBe("user");
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "refused", reason: "source_unavailable" });
    release(); await f.reports.stageEventReply(input);
    expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "refused", reason: "source_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("refuses a stale event after newly addressed work input", async () => {
    const f = await fixture(); const { input } = await commitInboxSpeech(f);
    f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "correction", sender: { kind: "parent", runId: f.parent.run.runId },
      direction: "Correct the result before answering.", materials: [], input: { kind: "message", workInputId: f.work.inputId,
        expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } });
    await f.reports.stageEventReply(input);
    expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "refused", reason: "source_unavailable" });
    expect(f.reports.canReply(f.work.inputId)).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("preserves the factual unsent outcome when Stop races final publication checks", async () => {
    const f = await fixture(); const { input } = await commitInboxSpeech(f);
    f.service.state.deps.reports = f.reports;
    f.hooks.beforeCommit = () => {
      f.hooks.beforeCommit = undefined;
      f.service.stop({ characterId: "taki", target: { subagentId: f.child.subagentId, workInputId: f.work.inputId,
        expectedRunId: null, expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } }, "user");
    };
    await f.reports.stageEventReply(input);
    // Stop retires an already staged row through DeliveryCoordinator.retireRun's existing expired transition.
    expect(readSubagentSpeechPublication(f.db, input)).toMatchObject({ status: "recorded", state: "expired" });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    expect(f.errors).toEqual([]);
  });

  it("records unavailable publication after lost process grants without undoing handled evidence", async () => {
    const f = await fixture(); const { input, event } = await commitInboxSpeech(f);
    const restored = createDirectRequestReports(f.deps);
    try {
      await restored.stageEventReply(input);
      expect(readSubagentSpeechPublication(f.db, input)).toEqual({ status: "refused", reason: "source_unavailable" });
      expect(f.service.events.get(event.eventId).state).toBe("handled");
      expect(f.send).not.toHaveBeenCalled();
    } finally { await restored.close(); }
  });
});
