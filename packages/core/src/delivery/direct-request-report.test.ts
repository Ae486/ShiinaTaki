import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createSubagentTools } from "../agents/subagent-tools.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import { createDeliveryCoordinator } from "./delivery-coordinator.ts";
import { createDirectRequestReports } from "./direct-request-report.ts";
import { readSubagentSpeechPublication } from "../db/subagent-speech-repo.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("direct-request delayed report", () => {
  it.each(["reply", "record"] as const)("retains accepted primary evidence through immediate cancel and handles %s through actual owners", async (decision) => {
    const primaryAndChild = scriptedModel([
      { kind: "tool", toolCallId: "delegate", toolName: "delegate_subagent", input: { label: "Research", subagentId: null,
        direction: "Research my original question", context: { kind: "fresh" }, completionPolicy: "request_parent",
        toolSelection: null, materials: [] } },
      { kind: "tool", toolCallId: "child-result", toolName: "complete_subagent", input: { text: "Retained research answer", materials: [] } },
    ]);
    let request = 0;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (request++ < 2) return primaryAndChild.doStream(options);
      const event = f.service.events.list({ characterId: "taki" })[0]!;
      return scriptedModel([{ kind: "tool", toolCallId: "parent-result", toolName: "handle_agent_event", input: {
        eventId: event.eventId, intent: decision, target: null,
        text: decision === "reply" ? "Delayed requested answer" : "The result needs no further action",
      } }]).doStream(options);
    } });
    const controller = new AbortController();
    const f: Awaited<ReturnType<typeof subagentFixture>> = await subagentFixture(model, { agent: { primaryTools: ({ characterId, userEntry, turn }) => createSubagentTools({
      service: f.service, characterId, userEntry, turn: turn!, captureReply: async (binding, work) => {
        await reports.capturePrimary(binding, work);
        f.runs.requestCancel(f.parent.run.runId, "user cancelled original turn");
        controller.abort("user cancelled original turn");
      },
    }) } });
    const timeline = createTimelineRepo(f.db); const deliveries = createRunDeliveryRepo({ db: f.db, events: createRunEventRepo(f.db) });
    const subscriptions = createTimelineSubscriptions(); const send = vi.fn(async () => "accepted" as const);
    subscriptions.subscribe("taki", { state: { status: "authenticated", deviceId: "report-fixture", role: "operator", capabilities: [] },
      notifyObserved: send }, { appended: () => undefined, removed: () => undefined });
    const delivery = createDeliveryCoordinator({ runs: f.runs, repo: deliveries, queue: f.queue, turns: f.turns, store: f.conversation,
      subscriptions, busyMaxWaitMs: () => 90_000, policy: () => ({ hourLimit: 0, dayLimit: 0, gapMs: 60_000,
        dayStart: new Date(Date.now() - 3600_000).toISOString(), timezone: "UTC" }) });
    const reports = createDirectRequestReports({ ...f, inputs: f.inputs, timeline, deliveries, delivery,
      changed: () => undefined, reportError: (code) => f.errors.push(code) });
    f.service.state.deps.reports = reports;
    cleanups.push(async () => { await f.service.close(); await reports.close(); delivery.close(); await f.close(); });
    const release = f.queue.tryAcquireBackground("taki")!;
    for await (const _delta of f.agent.stream({ characterId: "taki", message: "Please research my original question and report back." }, {
      runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, signal: controller.signal,
      runContext: f.runs.context(f.parent.run.runId), turnKind: "primary",
    })) { void _delta; /* Parent is cancelled immediately after independent acceptance, before its tool step completes. */ }
    f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "cancelled");
    release(); f.service.released();
    await vi.waitFor(() => expect(f.db.prepare("SELECT count(*) AS n FROM subagent_event_actions").get()?.n,
      JSON.stringify({ errors: f.errors, requests: model.doStreamCalls.length,
        consumers: f.db.prepare("SELECT state FROM subagent_inbox_consumers").all(),
        result: model.doStreamCalls[3]?.prompt.filter((message) => message.role === "tool") })).toBe(1));
    await vi.waitFor(() => expect(f.service.state.work.size).toBe(0));
    // The production queue's onAvailable hook retries prepared speech only after the handler releases its lane.
    reports.released();
    if (decision === "reply") await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const childId = f.children.list({ characterId: "taki" })[0]!.subagentId;
    const execution = f.executions.list({ subagentId: childId })[0]!;
    const accepted = f.inputs.get(execution.workInputId).replyAcceptance!;
    expect(accepted).toMatchObject({ primaryRunId: f.parent.run.runId, originalWording: "Please research my original question and report back." });
    expect(accepted.acceptedRootRunId).not.toBe(f.parent.run.runId);
    expect(timeline.rangeAscending("taki", accepted.userSeq - 1, accepted.userSeq)[0]?.id).toBe(accepted.userEntryId);
    expect(execution.parentResult).toBeNull();
    const event = f.service.events.list({ characterId: "taki" })[0]!;
    expect(event.state).toBe("handled");
    expect(model.doStreamCalls).toHaveLength(3);
    expect(f.runs.status(f.parent.run.runId).run.state).toBe("cancelled");
    const spoken = timeline.latestAscending("taki", 20).filter((entry) => entry.role === "assistant" && entry.content === "Delayed requested answer");
    expect(spoken).toHaveLength(decision === "reply" ? 1 : 0);
    expect(send).toHaveBeenCalledTimes(decision === "reply" ? 1 : 0);
    if (decision === "reply") {
      const actionId = String(f.db.prepare("SELECT operation_key FROM subagent_event_actions WHERE event_id=:event").get({ event: event.eventId })!.operation_key);
      await vi.waitFor(() => expect(readSubagentSpeechPublication(f.db, { eventId: event.eventId, actionId }))
        .toMatchObject({ status: "recorded", state: "sent" }));
      expect(f.runs.status(accepted.acceptedRootRunId).run.state).toBe("completed");
      const consumer = f.db.prepare("SELECT run_id FROM subagent_inbox_consumers").get()!;
      await reports.stageEventReply({ eventId: event.eventId, consumerRunId: String(consumer.run_id), actionId });
      expect(send).toHaveBeenCalledOnce();
    } else {
      expect(reports.canReply(execution.workInputId)).toBe(true);
      expect(f.runs.status(accepted.acceptedRootRunId).run.state).toBe("waiting");
    }
    expect(f.errors).toEqual([]);
  });
});
