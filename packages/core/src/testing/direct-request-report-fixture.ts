/**
 * INPUT: finite or until-cancelled synthetic original primary request
 * OUTPUT: real SQLite request witness, accepted report root and controlled canonical child/parent proposals
 * POS: core/testing — no real user data, provider dispatch or fabricated publication handles
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { RunSnapshotSchema } from "@taki/shared";
import type { SubagentToolBinding } from "../agents/subagent-tools.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { createDeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import { createDirectRequestReports } from "../delivery/direct-request-report.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import { scriptedModel } from "./mock-language-model.ts";
import { subagentFixture } from "./subagent-fixture.ts";
import { createRunServiceStub } from "./run-service-stub.ts";
import { createSubagentInboxRepo } from "../db/subagent-inbox-repo.ts";

export async function directRequestReportFixture(options: { lifetimeMinutes?: number; capture?: boolean } = {}) {
  const model = scriptedModel([]); const authority = { current: true };
  const f = await subagentFixture(model, { snapshot: { async capture(request) {
    const captured = await createRunServiceStub().admit(request);
    return { snapshot: RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(captured.snapshot),
      context: { authorityCurrent: () => authority.current, tools: {}, memoryTools: {} } };
  } } });
  // This fixture drives canonical repository ports directly; scripted SDK scheduling has its own integration suite.
  await f.service.close();
  const timeline = createTimelineRepo(f.db);
  const userEntry = timeline.append({ characterId: "taki", role: "user", content: "Research this and give me the final answer." });
  const child = f.children.create({ characterId: "taki", createdByRunId: f.parent.run.runId, label: "Research",
    initialContext: { kind: "fresh" } });
  const work = f.inputs.accept({ subagentId: child.subagentId, operationKey: randomUUID(),
    sender: { kind: "parent", runId: f.parent.run.runId }, direction: "Research", materials: [],
    input: { kind: "work", completionPolicy: "request_parent",
      ...(options.lifetimeMinutes === undefined ? {} : { lifetimeMinutes: options.lifetimeMinutes }) } }).input;
  const binding: SubagentToolBinding = { service: f.service, characterId: "taki", userEntry,
    turn: { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, turnKind: "primary" } };
  const deliveries = createRunDeliveryRepo({ db: f.db, events: createRunEventRepo(f.db) });
  const subscriptions = createTimelineSubscriptions(); const send = vi.fn(async () => "accepted" as const);
  const hooks: { beforeCommit?: () => void } = {};
  subscriptions.subscribe("taki", { state: { status: "authenticated", deviceId: "fixture", role: "operator", capabilities: [] },
    notifyObserved: send }, { appended: () => undefined, removed: () => undefined });
  const delivery = createDeliveryCoordinator({ runs: f.runs, repo: deliveries, queue: f.queue, turns: f.turns,
    store: f.conversation, subscriptions, busyMaxWaitMs: () => 90_000,
    policy: () => { hooks.beforeCommit?.(); return { hourLimit: 0, dayLimit: 0, gapMs: 60_000,
      dayStart: new Date(Date.now() - 3600_000).toISOString(), timezone: "UTC" }; } });
  const deps = { ...f, timeline, deliveries, delivery, changed: () => undefined, reportError: (code: string) => f.errors.push(code) };
  const reports = createDirectRequestReports(deps);
  try { if (options.capture !== false) await reports.capturePrimary(binding, work); }
  catch (error) { await reports.close(); delivery.close(); await f.close(); throw error; }
  return { ...f, model, authority, hooks, timeline, child, work, binding, userEntry, send, reports, deps, deliveries, delivery,
    async cleanup() { await reports.close(); delivery.close(); await f.close(); } };
}

/** Model-free producer fixture: canonical repository proposal/terminal ports, not raw SQL result insertion. */
export async function commitDirectChild(f: Awaited<ReturnType<typeof directRequestReportFixture>>) {
  const token = { subagentId: f.child.subagentId, workInputId: f.work.inputId,
    throughWorkSeq: f.inputs.latestWorkSeq(f.work.inputId), controlVersion: f.children.get(f.child.subagentId).controlVersion };
  const deadline = f.work.workValidity.kind === "expires_at" ? { deadlineAt: f.work.workValidity.expiresAt } : {};
  const child = await f.runs.admitLinked({ triggerRequestId: randomUUID(), idempotencyKey: randomUUID(),
    characterId: "taki", initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
    provenance: { provider: "core.subagent", parentRunId: f.parent.run.runId }, payloadRef: f.work.inputId, ...deadline },
  { linked: { kind: "subagent", token, triggerInputId: f.work.inputId, validateTx() {} } });
  f.runs.start(child.run.runId, child.attempt.attemptId);
  const proposal = { text: "Research result" };
  f.executions.recordProposal({ runId: child.run.runId, attemptId: child.attempt.attemptId,
    workToken: f.executions.token(child.run.runId), proposal, digest: digestRunValue(proposal) });
  f.runs.settle(child.run.runId, child.attempt.attemptId, "completed");
  const result = f.executions.result(child.run.runId)!;
  return { child, result, deadline };
}

export async function commitDirectReply(f: Awaited<ReturnType<typeof directRequestReportFixture>>,
  decision: "reply" | "no_action" = "reply") {
  const { child, result, deadline } = await commitDirectChild(f);
  const parent = await f.runs.admitLinked({ triggerRequestId: randomUUID(), idempotencyKey: `subagent-completion:${child.run.runId}`,
    characterId: "taki", initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
    provenance: { provider: "core.subagent-completion", parentRunId: f.parent.run.runId }, payloadRef: child.run.runId, ...deadline },
  { linked: { kind: "parent-continuation", completionId: child.run.runId, resultDigest: result.childDigest, validateTx() {} } });
  f.runs.start(parent.run.runId, parent.attempt.attemptId);
  const reply = decision === "reply" ? { decision, text: "The final answer." }
    : { decision, reason: "Retain this intermediate finding privately." };
  f.executions.recordParentProposal({ runId: parent.run.runId, attemptId: parent.attempt.attemptId,
    proposal: reply, digest: digestRunValue(reply) });
  f.runs.settle(parent.run.runId, parent.attempt.attemptId, "completed");
  const complete = f.executions.result(child.run.runId)!;
  return { completionId: child.run.runId, parentRunId: parent.run.runId, parentResultDigest: complete.parentDigest! };
}

export async function commitInboxSpeech(f: Awaited<ReturnType<typeof directRequestReportFixture>>,
  options: { decision?: "speech_proposed" | "no_action"; deliver?: boolean; handle?: boolean } = {}) {
  const { child } = await commitDirectChild(f);
  const event = f.service.events.list({ characterId: "taki" }).find((event) => event.producerRunId === child.run.runId)!;
  const id = randomUUID();
  const consumer = await f.runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } });
  f.runs.start(consumer.run.runId, consumer.attempt.attemptId);
  const inbox = createSubagentInboxRepo(f.db);
  const claim = inbox.claim({ characterId: "taki", runId: consumer.run.runId, attemptId: consumer.attempt.attemptId, mode: "foreground" })!;
  const input = { eventId: event.eventId, consumerRunId: consumer.run.runId, actionId: randomUUID() };
  if (options.deliver !== false) {
    const effect = f.effects.prepare({ runId: consumer.run.runId, attemptId: consumer.attempt.attemptId, kind: "model",
      sourceRef: { type: "model", provider: "fixture", modelId: "fixture" }, replayPosture: "never", inputDigest: digestRunValue(claim.instructions),
      onCommitIntent: (effect) => inbox.commitIntent({ consumerId: claim.consumerId, effect, stepNumber: 0 }) });
    f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "completed" });
    if (options.handle !== false) inbox.action({ consumerId: claim.consumerId, eventId: event.eventId, operationKey: input.actionId,
      invocation: { invocationId: randomUUID(), runId: effect.runId, attemptId: effect.attemptId, modelEffectId: effect.effectId,
        toolName: "handle_agent_event", toolCallId: "speech", validationState: "accepted" },
      action: { kind: options.decision ?? "speech_proposed", note: "The final inbox answer." }, apply: () => ({ accepted: true }) });
  }
  return { input, event, consumer };
}
