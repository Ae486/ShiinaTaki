import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_METHODS, type HeartbeatDecision } from "@taki/shared";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import type { Connection } from "../server/connection-registry.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createDeliveryCoordinator, type DeliveryBinding } from "./delivery-coordinator.ts";

const fixtures: { db: ReturnType<typeof initiativeFixture>["db"]; delivery: ReturnType<typeof createDeliveryCoordinator> }[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) { f.delivery.close(); f.db.close(); }
  vi.useRealTimers();
});
const expression: HeartbeatDecision = { outcome: "express", selectedCandidateIds: ["one"], presentation: { kind: "expression", name: "happy" } };
const speech: HeartbeatDecision = { outcome: "speak", selectedCandidateIds: ["one"], text: "A result", presentation: null, responseExpectation: "none" };
function fixture(hourLimit = 2) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
  const f = initiativeFixture(); const queue = createTurnQueue(); const turns = createTurnRegistry();
  const subscriptions = createTimelineSubscriptions();
  const delivery = createDeliveryCoordinator({ ...f, repo: f.deliveries, queue, turns, subscriptions,
    busyMaxWaitMs: () => 100, policy: () => ({ hourLimit, dayLimit: 8, gapMs: 1, dayStart: "2026-09-26T00:00:00.000Z", timezone: "UTC" }) });
  const result = { ...f, queue, turns, delivery,
    connect(notifyObserved: Connection["notifyObserved"]) {
      subscriptions.subscribe("taki", { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] }, notifyObserved },
        { appended: () => undefined, removed: () => undefined });
    },
    async stage(input: { ttl: number; decision?: HeartbeatDecision; deliveryClass?: "class_a" | "class_b" }) {
      const identity = await f.admit(input.deliveryClass);
      return f.deliveries.stage({ ...identity, decision: input.decision ?? expression,
        expiresAt: new Date(Date.now() + input.ttl).toISOString(), primaryVersion: 0, consideredCount: 1 });
    } };
  fixtures.push(result); return result;
}
function binding(): DeliveryBinding {
  return { isCurrent: () => true, gate: () => "hold", present: vi.fn(async () => "completed" as const) };
}

describe("delivery hold lifetime", () => {
  it.each([50, 500])("expires an undispatched expression at the earlier TTL or busy limit (%s ms)", async (ttl) => {
    const f = fixture(); const record = await f.stage({ ttl }); const retained = binding();
    expect(await f.delivery.finish(record, retained)).toBe("held");
    const primary = f.queue.reservePrimary("taki"); const release = await primary.acquire();
    const primaryController = f.turns.begin("taki", undefined, "primary");
    await vi.advanceTimersByTimeAsync(Math.min(ttl, 100));
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "expired", continuation: "expired" });
    expect(f.runs.status(record.runId).run.state).toBe("cancelled");
    expect(retained.present).not.toHaveBeenCalled();
    expect(primaryController.signal.aborted).toBe(false);
    f.turns.end("taki", primaryController); release();
  });

  it("does not extend the original busy hold when resume is retried", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500 }); const retained = binding();
    await f.delivery.finish(record, retained);
    await vi.advanceTimersByTimeAsync(75);
    expect(await f.delivery.resume(record.runId)).toBe("held");
    await vi.advanceTimersByTimeAsync(25);
    expect(await f.delivery.resume(record.runId)).toBe("refused");
    expect(retained.present).not.toHaveBeenCalled();
    expect(f.runs.status(record.runId).attempts).toHaveLength(1);
  });

  it("lets Scheduled text use its own TTL beyond the Class B busy limit", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 300, decision: speech, deliveryClass: "class_a" }); const retained = binding();
    await f.delivery.finish(record, retained);
    await vi.advanceTimersByTimeAsync(150);
    expect(f.deliveries.get(record.runId)?.state).toBe("held");
    retained.gate = () => "ready";
    expect(await f.delivery.resume(record.runId)).toBe("settled");
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["A result"]);
    expect(f.runs.status(record.runId).attempts).toHaveLength(1);
  });

  it("expires held text without reopening or rewriting the completed execution", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 30, decision: speech });
    await f.delivery.finish(record, binding());
    expect(f.runs.status(record.runId).run.state).toBe("completed");
    await vi.advanceTimersByTimeAsync(30);
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "expired", timelineSeq: null, chargedAt: null });
    expect(f.runs.status(record.runId).run.state).toBe("completed");
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  });

  it("stops the hold timer at dispatch so crossing the busy deadline cannot preempt an executing Effect", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500 }); const retained = binding();
    await f.delivery.finish(record, retained);
    await vi.advanceTimersByTimeAsync(90);
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    retained.gate = () => "ready";
    retained.present = async () => {
      const effect = f.effects.prepare({ ...record, kind: "tool", sourceRef: { type: "tool", toolName: "set_expression" }, replayPosture: "never" });
      await completion;
      f.effects.settle({ ...record, effectId: effect.effectId, expectedVersion: effect.version, outcome: "completed" });
      return "completed";
    };
    const resumed = f.delivery.resume(record.runId);
    await vi.advanceTimersByTimeAsync(20);
    expect(f.runs.status(record.runId).run.state).toBe("running");
    expect(f.deliveries.get(record.runId)?.continuation).toBe("running");
    complete();
    expect(await resumed).toBe("settled");
    expect(f.runs.status(record.runId).run.state).toBe("completed");
  });
});

describe("delivery publication and terminal boundaries", () => {
  it.each([
    ["accepted", "sent"], ["unknown", "unknown"], ["refused", "no_target"], ["throws", "unknown"],
  ] as const)("records transport %s as %s only after atomic Timeline and charge commitment", async (transport, state) => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    const observed: unknown[] = [];
    const send = vi.fn(async (method: string, payload: unknown) => {
      // Assert outside the transport callback: the sender deliberately catches transport exceptions.
      observed.push({ method, payload, delivery: f.deliveries.get(record.runId), history: f.timeline.latestAscending("taki", 10),
        events: f.events.list(record.runId).map((event) => event.kind), runState: f.runs.status(record.runId).run.state });
      if (transport === "throws") throw new Error("socket completion lost");
      return transport;
    });
    f.connect(send);
    const retained = { ...binding(), gate: () => "ready" as const };
    expect(await f.delivery.finish(record, retained)).toBe("settled");
    const entry = f.timeline.latestAscending("taki", 10)[0];
    expect(observed).toEqual([{ method: TIMELINE_METHODS.appended, payload: entry, history: [entry], runState: "completed",
      delivery: expect.objectContaining({ state: "dispatch_committed", chargedAt: new Date().toISOString() }),
      events: expect.arrayContaining(["delivery.dispatch_committed"]) }]);
    const settled = f.deliveries.get(record.runId)!;
    expect(settled).toMatchObject({ state, timelineSeq: 1, chargedAt: new Date().toISOString() });
    expect(send).toHaveBeenCalledTimes(1);
    const facts = f.events.list(record.runId).filter((event) => event.kind.startsWith("delivery."));
    expect(facts.map((event) => event.kind)).toEqual(["delivery.staged", "delivery.dispatch_committed", `delivery.${state}`]);
    expect(await f.delivery.finish(record, retained)).toBe("settled");
    expect(f.deliveries.get(record.runId)).toEqual(settled);
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const terminal = f.runs.status(record.runId); const committedEvents = f.events.list(record.runId);
    f.delivery.retireRun(record.runId);
    expect(f.deliveries.get(record.runId)).toEqual(settled);
    expect(f.runs.status(record.runId)).toEqual(terminal);
    expect(f.events.list(record.runId)).toEqual(committedEvents);
  });

  it("keeps a committed no-subscriber result in ordinary history without claiming it was sent", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    await f.delivery.finish(record, { ...binding(), gate: () => "ready" });
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "no_target", timelineSeq: 1, chargedAt: new Date().toISOString() });
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["A result"]);
    expect(f.events.list(record.runId).some((event) => event.kind === "delivery.sent")).toBe(false);
  });

  it("keeps one identity and charge when duplicate finish and cancellation arrive during uncertain fan-out", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    const send = vi.fn(async () => { await completion; return "unknown" as const; });
    f.connect(send);
    const controller = new AbortController();
    const retained = { ...binding(), controller, isCurrent: () => !controller.signal.aborted, gate: () => "ready" as const };
    const finishing = f.delivery.finish(record, retained);
    expect(f.deliveries.get(record.runId)?.state).toBe("dispatch_committed");
    f.delivery.retireRun(record.runId);
    expect(controller.signal.aborted).toBe(false);
    expect(f.deliveries.get(record.runId)?.state).toBe("dispatch_committed");
    expect(await f.delivery.finish(record, retained)).toBe("settled");
    controller.abort("operator cancelled after publication");
    expect(f.runs.requestCancel(record.runId)).toBe(false);
    expect(await f.delivery.finish(record, retained)).toBe("settled");
    expect(f.deliveries.get(record.runId)?.state).toBe("dispatch_committed");
    complete(); expect(await finishing).toBe("settled");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "unknown", timelineSeq: 1, chargedAt: new Date().toISOString() });
    expect(f.runs.status(record.runId).run.state).toBe("completed");
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.events.list(record.runId).filter((event) => event.kind === "delivery.dispatch_committed")).toHaveLength(1);
  });

  it("leaves a cancelled pre-publication output uncharged so the next valid output retains its slot", async () => {
    const f = fixture(1); const cancelled = await f.stage({ ttl: 500, decision: speech });
    const send = vi.fn(async () => "accepted" as const); f.connect(send);
    const controller = new AbortController(); controller.abort("cancelled before publication");
    f.runs.requestCancel(cancelled.runId);
    await f.delivery.finish(cancelled, { ...binding(), controller, isCurrent: () => !controller.signal.aborted, gate: () => "ready" });
    expect(f.runs.status(cancelled.runId).run.state).toBe("cancelled");
    expect(f.deliveries.get(cancelled.runId)).toMatchObject({ state: "expired", chargedAt: null, timelineSeq: null });
    expect(send).not.toHaveBeenCalled(); expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    const next = await f.stage({ ttl: 500, decision: speech });
    await f.delivery.finish(next, { ...binding(), gate: () => "ready" });
    expect(f.deliveries.get(next.runId)?.state).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
  });

  it.each(["completed", "failed", "cancelled"] as const)("refuses held presentation after the original Attempt is already %s", async (outcome) => {
    const f = fixture(); const record = await f.stage({ ttl: 500 }); const retained = binding();
    await f.delivery.finish(record, retained);
    f.runs.settle(record.runId, record.attemptId, outcome);
    const terminal = f.runs.status(record.runId);
    retained.gate = () => "ready";
    expect(await f.delivery.resume(record.runId)).toBe("refused");
    expect(retained.present).not.toHaveBeenCalled();
    expect(f.effects.list?.(record.runId)).toEqual([]);
    expect(f.runs.status(record.runId).attempts).toEqual(terminal.attempts);
    expect(f.runs.status(record.runId).run.state).toBe(outcome);
    expect(f.deliveries.get(record.runId)?.continuation).toBe("expired");
  });

  it("does not report a canonical Run cancellation as budget exhaustion when its binding is still current", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    const send = vi.fn(async () => "accepted" as const); f.connect(send);
    f.runs.requestCancel(record.runId);
    await f.delivery.finish(record, { ...binding(), gate: () => "ready" });
    expect(f.runs.status(record.runId).run.state).toBe("cancelled");
    expect(f.deliveries.get(record.runId)).toMatchObject({ timelineSeq: null, chargedAt: null });
    expect(send).not.toHaveBeenCalled();
    const budgetRefusals = f.events.list(record.runId).filter((event) => event.schemaVersion === "run-event.v2"
      && "reasonCode" in event.payload && event.payload.reasonCode === "budget");
    expect(budgetRefusals).toEqual([]);
    expect(f.events.list(record.runId).at(-1)?.payload).toMatchObject({ kind: "delivery.suppressed", reasonCode: "stale" });
  });

  it("propagates unexpected Timeline write failures without charging or fabricating a policy refusal", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    const send = vi.fn(async () => "accepted" as const); f.connect(send);
    f.db.exec("CREATE TRIGGER fail_delivery_timeline BEFORE INSERT ON timeline_messages BEGIN SELECT RAISE(ABORT,'timeline write failed'); END");
    await expect(f.delivery.finish(record, { ...binding(), gate: () => "ready" })).rejects.toThrow("timeline write failed");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "staged", chargedAt: null, timelineSeq: null });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(f.events.list(record.runId).filter((event) => event.kind.startsWith("delivery.")).map((event) => event.kind))
      .toEqual(["delivery.staged"]);
  });

  it("preserves committed charge and identity when writing the observed transport fact fails", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech });
    const send = vi.fn(async () => "accepted" as const); f.connect(send);
    f.db.exec(`CREATE TRIGGER fail_delivery_sent BEFORE INSERT ON run_events
      WHEN NEW.kind='delivery.sent' BEGIN SELECT RAISE(ABORT,'delivery fact write failed'); END`);
    const retained = { ...binding(), gate: () => "ready" as const };
    await expect(f.delivery.finish(record, retained)).rejects.toThrow("delivery fact write failed");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "dispatch_committed", chargedAt: new Date().toISOString(), timelineSeq: 1 });
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
    expect(f.events.list(record.runId).some((event) => event.kind === "delivery.sent" || event.kind === "delivery.suppressed")).toBe(false);
    expect(await f.delivery.finish(record, retained)).toBe("settled");
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.deliveries.get(record.runId)?.state).toBe("dispatch_committed");
  });
});

describe("Run-scoped delivery retirement", () => {
  it("retires held terminal text without changing another task or the foreground controller", async () => {
    const f = fixture(); const retired = await f.stage({ ttl: 500, decision: speech, deliveryClass: "class_a" });
    const sibling = await f.stage({ ttl: 500, decision: { ...speech, text: "Other task" }, deliveryClass: "class_a" });
    const retained = binding(); const other = binding();
    // The current schema permits one held delivery per Character; the sibling remains independently staged.
    await f.delivery.finish(retired, retained);
    const terminal = f.runs.status(retired.runId);
    expect(terminal.run.state).toBe("completed");
    const primary = f.queue.reservePrimary("taki"); const release = await primary.acquire();
    const controller = f.turns.begin("taki", undefined, "foreground");
    f.delivery.retireRun(retired.runId);
    const retiredState = f.deliveries.get(retired.runId); const retiredEvents = f.events.list(retired.runId);
    f.delivery.retireRun(retired.runId); f.delivery.retireRun("missing-run");
    expect(f.runs.status(retired.runId)).toEqual(terminal);
    expect(f.deliveries.get(retired.runId)).toMatchObject({ state: "expired", chargedAt: null, timelineSeq: null });
    expect(controller.signal.aborted).toBe(false);
    expect(f.deliveries.get(sibling.runId)?.state).toBe("staged");
    expect(await f.delivery.finish(retired, retained)).toBe("settled");
    retained.gate = () => "ready";
    expect(await f.delivery.finish(retired, retained)).toBe("settled");
    expect(await f.delivery.resume(retired.runId)).toBe("refused");
    expect(f.deliveries.get(retired.runId)).toEqual(retiredState);
    expect(f.events.list(retired.runId)).toEqual(retiredEvents);
    f.turns.end("taki", controller); release();
    other.gate = () => "ready";
    expect(await f.delivery.finish(sibling, other)).toBe("settled");
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["Other task"]);
  });

  it("refuses stale callbacks for a retired staged presentation", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500 }); const retained = binding();
    f.delivery.retireRun(record.runId);
    const retired = f.deliveries.get(record.runId);
    expect(retired).toMatchObject({ state: "expired", continuation: "expired" });
    expect(f.runs.status(record.runId).run.state).toBe("cancelled");
    retained.gate = () => "ready";
    await f.delivery.finish(record, retained);
    expect(retained.present).not.toHaveBeenCalled();
    expect(f.effects.list?.(record.runId)).toEqual([]);
    expect(f.deliveries.get(record.runId)).toEqual(retired);
  });

  it.each([
    ["direct", "completed"], ["direct", "outcome_unknown"],
    ["resumed", "completed"], ["resumed", "outcome_unknown"],
  ] as const)("waits for actual presentation settlement after %s retirement (%s)", async (mode, outcome) => {
    const f = fixture(); const record = await f.stage({ ttl: 500,
      decision: { ...speech, presentation: { kind: "expression", name: "happy" } } });
    const controller = new AbortController();
    let complete!: () => void; const completion = new Promise<void>((resolve) => { complete = resolve; });
    const present = vi.fn(async () => {
      const effect = f.effects.prepare({ ...record, kind: "tool", sourceRef: { type: "tool", toolName: "set_expression" }, replayPosture: "never" });
      await completion;
      f.effects.settle({ ...record, effectId: effect.effectId, expectedVersion: effect.version, outcome });
      return outcome;
    });
    const retained = { ...binding(), controller, present };
    if (mode === "resumed") await f.delivery.finish(record, retained);
    retained.gate = () => "ready";
    const finishing = mode === "resumed" ? f.delivery.resume(record.runId) : f.delivery.finish(record, retained);
    expect(f.effects.unfinished(record.runId)).toHaveLength(1);
    f.delivery.retireRun(record.runId);
    expect(controller.signal.aborted).toBe(true);
    expect(f.runs.status(record.runId).run.state).toBe("cancel_requested");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "expired", continuation: "running", chargedAt: null });
    expect(f.effects.unfinished(record.runId)).toHaveLength(1);
    await f.delivery.finish(record, retained);
    f.delivery.retireRun(record.runId);
    complete(); expect(await finishing).toBe("settled");
    expect(present).toHaveBeenCalledTimes(1);
    expect(f.runs.status(record.runId).run.state).toBe(outcome === "completed" ? "cancelled" : "outcome_unknown");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "expired",
      continuation: outcome === "completed" ? "completed" : "unknown", chargedAt: null, timelineSeq: null });
    expect(f.effects.list?.(record.runId)).toEqual([expect.objectContaining({ state: "terminal", outcome })]);
    expect(f.effects.unfinished(record.runId)).toEqual([]);
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  });

  it("preserves its retained binding when durable retirement fails", async () => {
    const f = fixture(); const record = await f.stage({ ttl: 500, decision: speech }); const retained = binding();
    await f.delivery.finish(record, retained);
    f.db.exec(`CREATE TRIGGER fail_retirement BEFORE INSERT ON run_events
      WHEN NEW.kind='delivery.expired' BEGIN SELECT RAISE(ABORT,'retirement write failed'); END`);
    try {
      expect(() => f.delivery.retireRun(record.runId)).toThrow("retirement write failed");
      expect(f.deliveries.get(record.runId)?.state).toBe("held");
    } finally { f.db.exec("DROP TRIGGER fail_retirement"); }
    retained.gate = () => "ready";
    expect(await f.delivery.resume(record.runId)).toBe("settled");
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
  });
});
