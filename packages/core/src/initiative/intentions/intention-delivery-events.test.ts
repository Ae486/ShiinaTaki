import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@taki/shared";
import { initiativeFixture } from "../../testing/initiative-fixture.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { createRunEventLiveBus } from "../../db/run-event-live.ts";
import { createRunDeliveryRepo } from "../../db/run-delivery-repo.ts";
import { createRunService } from "../../harness/run-service.ts";
import { createRecoveryCoordinator } from "../../harness/recovery-coordinator.ts";
import { createDeliveryCoordinator } from "../../delivery/delivery-coordinator.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createTimelineSubscriptions } from "../../server/timeline-subscriptions.ts";
import type { Connection } from "../../server/connection-registry.ts";
import { createIntentionService } from "./intention-service.ts";

const fixtures: ReturnType<typeof initiativeFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.db.close(); vi.useRealTimers(); });

async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  const f = initiativeFixture(); fixtures.push(f);
  const intentions = createIntentionService({ db: f.db });
  const observed: { kind: RunEvent["kind"]; state: string | undefined; disposition: string | null | undefined }[] = [];
  // Match the production committed-event consumer, driven by the actual repository producers.
  const live = createRunEventLiveBus(undefined, (events) => {
    for (const event of events) {
      if (event.kind !== "run.settled" && !event.kind.startsWith("delivery.")) continue;
      const row = f.db.prepare("SELECT intention_id,character_id FROM initiative_intentions WHERE run_id=:runId")
        .get({ runId: event.runId });
      if (typeof row?.intention_id !== "string" || typeof row.character_id !== "string") continue;
      const scope = { intentionId: row.intention_id, characterId: row.character_id };
      intentions.settleLinked(scope);
      const plan = intentions.get(scope);
      observed.push({ kind: event.kind, state: plan?.state, disposition: plan?.disposition });
    }
  });
  const repo = createRunRepo(f.db, f.events, live);
  const runs = createRunService({ repo, provider: "test", modelId: "test", snapshot: {
    capture: async () => { throw new Error("ADMISSION_IS_OWNED_BY_EXISTING_FIXTURE"); },
  } });
  const primary = await f.runs.admit({ characterId: "taki", triggerRequestId: "primary", idempotencyKey: "primary",
    initiator: "primary", provenance: { provider: "chat" }, contextMode: "primary", deliveryClass: "class_a" });
  runs.start(primary.run.runId, primary.attempt.attemptId);
  const user = f.timeline.append({ characterId: "taki", role: "user", content: "My interview has ended; the outcome is unknown." });
  intentions.registerPrimarySource({ characterId: "taki", runId: primary.run.runId, attemptId: primary.attempt.attemptId,
    userTimelineId: user.id, userTimelineSeq: user.seq });
  const result = intentions.plan({ characterId: "taki", plan: {
    purpose: "Consider asking how the interview felt without assuming the result.", reportedEventTime: null,
    notBefore: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } }, { runId: primary.run.runId, attemptId: primary.attempt.attemptId, toolCallId: "plan" });
  if (result.status === "refused") throw new Error(result.reason);
  const plan = result.intention;
  const claim = { characterId: "taki", intentionId: plan.intentionId, canonicalRunKey: "initiative:event-sequence" };
  expect(intentions.claim(claim)).toBe(true);
  runs.settle(primary.run.runId, primary.attempt.attemptId, "completed");
  const heartbeat = await f.runs.admit({ characterId: "taki", triggerRequestId: claim.canonicalRunKey,
    idempotencyKey: claim.canonicalRunKey, initiator: "heartbeat", provenance: { provider: "initiative" },
    contextMode: "autonomous", deliveryClass: "class_b", deadlineAt: plan.expiresAt });
  const runId = heartbeat.run.runId; const attemptId = heartbeat.attempt.attemptId;
  expect(intentions.link({ ...claim, runId })).toBe(true); runs.start(runId, attemptId);
  const deliveries = createRunDeliveryRepo({ db: f.db, events: f.events, live });
  const record = deliveries.stage({ runId, attemptId, characterId: "taki", deliveryClass: "class_b",
    expiresAt: plan.expiresAt, primaryVersion: 0, consideredCount: 1,
    decision: { outcome: "speak", selectedCandidateIds: ["selected"], text: "How did the interview feel?",
      presentation: null, responseExpectation: "invitation" } });
  const policy = { hourLimit: 2, dayLimit: 8, gapMs: 600_000, dayStart: "2026-09-28T00:00:00.000Z", timezone: "UTC" };
  const subscriptions = createTimelineSubscriptions();
  const delivery = createDeliveryCoordinator({ runs, repo: deliveries, store: f.store,
    queue: createTurnQueue(), turns: createTurnRegistry(), subscriptions, policy: () => policy, busyMaxWaitMs: () => 90_000 });
  return { ...f, runs, repo, intentions, plan, claim, record, runId, attemptId, observed, deliveries, delivery, subscriptions, policy };
}

describe("Intention disposition at real committed delivery events", () => {
  it.each(["accepted", "unknown"] as const)("waits through dispatch commitment for the transport %s result", async (transport) => {
    const f = await fixture();
    let finishSend: (outcome: "accepted" | "unknown") => void = () => { throw new Error("transport not started"); };
    const pending = new Promise<"accepted" | "unknown">((resolve) => { finishSend = resolve; });
    const notifyObserved = vi.fn(() => pending);
    const connection: Connection = { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] }, notifyObserved };
    f.subscriptions.subscribe("taki", connection, { appended: vi.fn(), removed: vi.fn() });
    const finished = f.delivery.finish(f.record, { isCurrent: () => f.intentions.isCurrent(f.claim), gate: () => "ready",
      present: async () => { throw new Error("speech has no presentation continuation"); } });
    expect(notifyObserved).toHaveBeenCalledTimes(1);
    expect(f.deliveries.get(f.runId)?.state).toBe("dispatch_committed");
    expect(f.observed.filter((entry) => entry.kind === "delivery.dispatch_committed"))
      .toEqual([{ kind: "delivery.dispatch_committed", state: "claimed", disposition: null }]);
    expect(f.intentions.listDue("taki")).toEqual([]);
    const chargedAt = f.deliveries.get(f.runId)?.chargedAt;
    finishSend(transport); await finished;
    expect(f.deliveries.get(f.runId)).toMatchObject({ state: transport === "accepted" ? "sent" : "unknown", chargedAt });
    expect(f.intentions.get(f.claim)).toMatchObject({ state: "terminal", disposition: transport === "accepted" ? "speak" : "unknown" });
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(2);
    expect(f.runs.status(f.runId).run.state).toBe("completed");
    expect(f.runs.status(f.runId).attempts).toHaveLength(1);
    expect(f.intentions.claim(f.claim)).toBe(false);
    expect(f.deliveries.commitPublication({ runId: f.runId, policy: f.policy, append: f.store.appendDelivery })).toBeUndefined();
    f.delivery.close();
  });

  it("closes a lost dispatch acknowledgement as unknown on restart without replay or refund", async () => {
    const f = await fixture(); f.runs.settle(f.runId, f.attemptId, "completed");
    f.deliveries.commitPublication({ runId: f.runId, policy: f.policy, append: f.store.appendDelivery });
    expect(f.intentions.get(f.claim)).toMatchObject({ state: "claimed", disposition: null });
    const chargedAt = f.deliveries.get(f.runId)?.chargedAt;
    const runBefore = f.runs.status(f.runId); const timelineBefore = f.timeline.latestAscending("taki", 10);
    const restarted = createIntentionService({ db: f.db }); restarted.reconcile();
    expect(restarted.get(f.claim)).toMatchObject({ state: "terminal", disposition: "unknown" });
    await createRecoveryCoordinator({ db: f.db, runs: f.repo, effects: f.effects }).scan();
    expect(f.deliveries.get(f.runId)).toMatchObject({ state: "unknown", chargedAt });
    expect(f.runs.status(f.runId)).toEqual(runBefore);
    expect(f.timeline.latestAscending("taki", 10)).toEqual(timelineBefore);
    expect(restarted.claim(f.claim)).toBe(false);
    expect(f.deliveries.commitPublication({ runId: f.runId, policy: f.policy, append: f.store.appendDelivery })).toBeUndefined();
    const tail = f.events.tail(f.runId).seq; restarted.reconcile();
    expect(f.events.tail(f.runId).seq).toBe(tail);
    f.delivery.close();
  });
});
