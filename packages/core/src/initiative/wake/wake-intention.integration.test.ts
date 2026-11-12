import { afterEach, describe, expect, it, vi } from "vitest";
import type { InitiativeSelectedContext } from "@taki/shared";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createDeliveryCoordinator } from "../../delivery/delivery-coordinator.ts";
import { createInitiativeOpportunityRepo } from "../../db/initiative-opportunity-repo.ts";
import { createTimelineSubscriptions } from "../../server/timeline-subscriptions.ts";
import { initiativeFixture } from "../../testing/initiative-fixture.ts";
import { createInitiativeRuntime } from "../initiative-runtime.ts";
import { createIntentionService } from "../intentions/intention-service.ts";
import { createInitiativeWakeEngine } from "./wake-engine.ts";
import type { InitiativeWakeDependencies, InitiativeWakeSnapshot, WakeSelection } from "./wake-contract.ts";
import { canonicalWakeKey } from "./wake-policy-repo.ts";

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  vi.useRealTimers();
});

async function fixture(options: { dueDelay?: number; ttl?: number; speak?: boolean } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  const f = initiativeFixture(); const queue = createTurnQueue(); const turns = createTurnRegistry();
  let source: "current" | "unavailable" | "withdrawn" = "current";
  const intentions = createIntentionService({ db: f.db, sourceState: () => source });
  const primary = await f.runs.admit({ characterId: "taki", triggerRequestId: "primary", idempotencyKey: "primary",
    initiator: "primary", provenance: { provider: "chat" }, contextMode: "primary", deliveryClass: "class_a" });
  f.runs.start(primary.run.runId, primary.attempt.attemptId);
  const user = f.timeline.append({ characterId: "taki", role: "user", content: "My interview is later today; its outcome is unknown." });
  expect(intentions.registerPrimarySource({ characterId: "taki", runId: primary.run.runId,
    attemptId: primary.attempt.attemptId, userTimelineId: user.id, userTimelineSeq: user.seq })).toBe(true);
  const plan = { purpose: "Consider asking about the interview without assuming its outcome.",
    notBefore: new Date(Date.now() + (options.dueDelay ?? 0)).toISOString(),
    expiresAt: new Date(Date.now() + (options.ttl ?? 3_600_000)).toISOString(), reportedEventTime: null };
  const result = intentions.plan({ characterId: "taki", plan }, { runId: primary.run.runId,
    attemptId: primary.attempt.attemptId, toolCallId: "plan-call" });
  if (result.status === "refused") throw new Error(result.reason);
  const intention = result.intention;
  f.runs.settle(primary.run.runId, primary.attempt.attemptId, "completed", { retryable: false });

  const policy = { modelHourLimit: 4, utteranceHourLimit: 2, utteranceDayLimit: 8, utteranceGapMs: 600_000,
    busyMaxWaitMs: 90_000, outputTtlMs: 600_000, scheduledOutputTtlMs: 86_400_000 };
  const wakePolicy = { periodicEnabled: true, eventsEnabled: true, checkIntervalMs: 60_000,
    modelCadenceMs: 900_000, jitterRatio: 0.2, quietStart: "23:00", quietEnd: "08:00" };
  const snapshot: InitiativeWakeSnapshot = { enabled: true, targetId: "taki", targetReady: true, policyRevision: "1",
    timezone: "UTC", timezoneRevision: 1, primaryVersion: 0, privacyPaused: false, presence: "present",
    foreground: null, presenceReturn: null, completions: [], intentions: [] };
  const control: { busy: boolean; contextAvailable: boolean; hold: boolean; afterPrepare?(): void; afterModel?(): void } = {
    busy: false, contextAvailable: true, hold: false,
  };
  const selections: WakeSelection[] = []; const model = vi.fn(); const errors = vi.fn();
  const atModel: { state: string | undefined; runId: string | null | undefined; dueCount: number; current: boolean }[] = [];
  const delivery = createDeliveryCoordinator({ ...f, repo: f.deliveries, queue, turns, subscriptions: createTimelineSubscriptions(),
    busyMaxWaitMs: () => policy.busyMaxWaitMs, policy: () => ({ hourLimit: 2, dayLimit: 8, gapMs: 600_000,
      dayStart: "2026-09-28T00:00:00.000Z", timezone: "UTC" }) });
  const runtime = createInitiativeRuntime({ ...f, queue, turns, delivery,
    opportunities: createInitiativeOpportunityRepo(f.db), policy: () => policy, enabled: () => snapshot.enabled,
    timezoneRevision: () => snapshot.timezoneRevision, authorityCurrent: () => true,
    capturePresentation: () => ({ isCurrent: () => true, accepts: () => true, execute: async () => "completed" }),
    agent: { async *stream(_params, turn) {
      model();
      const current = intentions.get(intention); const selection = selections.at(-1)!;
      atModel.push({ state: current?.state, runId: current?.runId, dueCount: intentions.listDue("taki").length,
        current: intentions.isCurrent({ characterId: "taki", intentionId: intention.intentionId,
          canonicalRunKey: canonicalWakeKey("taki", selection.opportunityId) }) });
      const effect = f.effects.prepare({ runId: turn!.runId!, attemptId: turn!.attemptId!, kind: "model",
        sourceRef: { type: "model", provider: "fixture", modelId: "fixture" }, replayPosture: "never", onCommitIntent: turn?.onCommitModelIntent });
      f.effects.settle({ runId: effect.runId, attemptId: effect.attemptId, effectId: effect.effectId,
        expectedVersion: effect.version, outcome: "completed" });
      control.afterModel?.();
      await turn!.decisionCollector!.tools.heartbeat_respond!.execute!({
        outcome: options.speak ? "speak" : "silent", selectedCandidateIds: options.speak ? [selection.candidates[0]!.candidateId] : [],
        text: options.speak ? "How did the interview go?" : null,
        presentation: null, responseExpectation: options.speak ? "invitation" : null,
      }, { toolCallId: "decision", messages: [], context: {} });
      yield "";
    } },
  });
  const prepareContext = vi.fn(async (selection: WakeSelection): Promise<InitiativeSelectedContext | undefined> => {
    selections.push(selection); control.afterPrepare?.();
    if (!control.contextAvailable) return undefined;
    return { instructions: "Stable Persona", controlInput: selection.candidates.map((candidate) => candidate.definition.purpose).join("\n"),
      candidateIds: selection.candidates.map((candidate) => candidate.candidateId), allowedToolNames: [],
      candidatePolicies: selection.candidates.map((candidate) => ({ candidateId: candidate.candidateId,
        allowedOutcomes: candidate.definition.allowedOutcomes })),
      manifest: { version: "initiative-context.v1", profile: "initiative-thin", capturedAt: new Date(selection.capturedAt).toISOString(),
        expiresAt: new Date(selection.expiresAt).toISOString(), primaryVersion: snapshot.primaryVersion,
        timezoneRevision: snapshot.timezoneRevision, policyRevision: snapshot.policyRevision, accountingQuality: "unknown",
        sources: [{ category: "intention", reference: intention.intentionId, revision: intention.source.digest, trust: "core" }] } };
  });
  const deps: InitiativeWakeDependencies = { db: f.db, patterns: { listActive: () => [] }, intentions,
    snapshot: () => ({ ...snapshot, intentions: intentions.listDue("taki") }), policy: () => policy,
    wakePolicy: () => wakePolicy, prepareContext, busy: () => control.busy, onError: errors,
    // The supported delivery-gate port is forced only by the held-output tests. All admission,
    // source currentness, Run/Effect and publication behavior still uses the actual C1 owners.
    runtime: { ...runtime, dispatch: (opportunity) => runtime.dispatch({ ...opportunity,
      deliveryGate: () => control.hold ? "hold" : opportunity.deliveryGate() }) },
  };
  const engine = createInitiativeWakeEngine(deps);
  closing.push(async () => { await engine.close(); await runtime.close(); f.db.close(); });
  const heartbeatRuns = () => f.db.prepare("SELECT run_id,idempotency_key,state FROM runs WHERE initiator='heartbeat'").all();
  return { ...f, intentions, intention, user, plan, engine, runtime, deps, queue, policy, wakePolicy, snapshot,
    control, model, errors, atModel, selections, prepareContext, heartbeatRuns,
    setSource: (value: typeof source) => { source = value; } };
}

describe("standalone Intention through WakeEngine and canonical C1", () => {
  it("links before the model, consumes silence once without a Pattern, and cannot replay after restart", async () => {
    const f = await fixture(); await f.engine.evaluate();
    const runs = f.heartbeatRuns(); expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "completed" });
    expect(f.atModel).toEqual([{ state: "claimed", runId: runs[0]!.run_id, dueCount: 0, current: true }]);
    expect(f.selections[0]?.candidates).toHaveLength(1);
    expect(f.selections[0]?.candidates[0]).toMatchObject({ kind: "intention", intentionId: f.intention.intentionId,
      definition: { purpose: f.plan.purpose } });
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "terminal", disposition: "silent", purpose: null });
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
    await f.engine.evaluate(); await f.engine.close();
    vi.setSystemTime(Date.now() + 1_500_000);
    const intentions = createIntentionService({ db: f.db }); intentions.reconcile();
    const restarted = createInitiativeWakeEngine({ ...f.deps, intentions,
      snapshot: () => ({ ...f.snapshot, intentions: intentions.listDue("taki") }) });
    try { await restarted.evaluate(); } finally { await restarted.close(); }
    expect(f.heartbeatRuns()).toEqual(runs); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_intentions").get()?.n).toBe(1);
    expect(f.errors).not.toHaveBeenCalled();
  });

  it.each(["quiet", "busy", "context-unavailable"] as const)("retains the original active window after %s refusal with zero Runs", async (reason) => {
    const f = await fixture();
    if (reason === "quiet") { f.wakePolicy.quietStart = "11:00"; f.wakePolicy.quietEnd = "13:00"; }
    if (reason === "busy") f.control.busy = true;
    if (reason === "context-unavailable") f.control.contextAvailable = false;
    await f.engine.evaluate();
    expect(f.heartbeatRuns()).toEqual([]); expect(f.model).not.toHaveBeenCalled();
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "active", canonicalRunKey: null,
      notBefore: f.plan.notBefore, expiresAt: f.plan.expiresAt });
    expect(f.db.prepare("SELECT * FROM initiative_wake_claims").all()).toEqual([]);
    if (reason !== "context-unavailable") expect(f.prepareContext).not.toHaveBeenCalled();
    f.wakePolicy.quietStart = "23:00"; f.wakePolicy.quietEnd = "08:00";
    f.control.busy = false; f.control.contextAvailable = true;
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1); expect(f.errors).not.toHaveBeenCalled();
  });

  it("releases both domain and wake claims after an actual C1 lane refusal before Run admission", async () => {
    const f = await fixture(); let release: (() => void) | undefined;
    f.control.afterPrepare = () => { release = f.queue.tryAcquireBackground("taki"); };
    await f.engine.evaluate();
    expect(f.heartbeatRuns()).toEqual([]);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "active", canonicalRunKey: null,
      notBefore: f.plan.notBefore, expiresAt: f.plan.expiresAt });
    expect(f.db.prepare("SELECT * FROM initiative_wake_claims").all()).toEqual([]);
    release?.(); f.control.afterPrepare = undefined;
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1); expect(f.errors).not.toHaveBeenCalled();
  });

  it("preserves an unavailable source window but permanently closes an observed withdrawal", async () => {
    const f = await fixture(); f.setSource("unavailable"); await f.engine.evaluate();
    expect(f.heartbeatRuns()).toEqual([]); expect(f.intentions.get(f.intention)?.state).toBe("active");
    f.setSource("withdrawn"); await f.engine.evaluate();
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "terminal", disposition: "source_invalidated" });
    f.setSource("current"); await f.engine.evaluate();
    expect(f.model).not.toHaveBeenCalled(); expect(f.heartbeatRuns()).toEqual([]);
    expect(f.errors).not.toHaveBeenCalled();
  });

  it.each(["expiry", "unavailable", "withdrawn"] as const)("rechecks %s after context preparation before claiming or admitting", async (change) => {
    const f = await fixture();
    f.control.afterPrepare = () => {
      if (change === "expiry") vi.setSystemTime(Date.parse(f.plan.expiresAt));
      else f.setSource(change);
    };
    await f.engine.evaluate(); expect(f.heartbeatRuns()).toEqual([]); expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT * FROM initiative_wake_claims").all()).toEqual([]);
    const expected = change === "unavailable" ? { state: "active", expiresAt: f.plan.expiresAt }
      : { state: "terminal", disposition: change === "expiry" ? "expired" : "source_invalidated" };
    expect(f.intentions.get(f.intention)).toMatchObject(expected);
    if (change === "unavailable") {
      f.control.afterPrepare = undefined; f.setSource("current"); await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1);
    }
    expect(f.errors).not.toHaveBeenCalled();
  });

  it.each(["expiry", "unavailable", "withdrawn"] as const)("cannot publish generated speech after %s at the model/output boundary", async (change) => {
    const f = await fixture({ speak: true });
    f.control.afterModel = () => {
      if (change === "expiry") vi.setSystemTime(Date.parse(f.plan.expiresAt));
      else f.setSource(change);
    };
    await f.engine.evaluate();
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.heartbeatRuns()).toHaveLength(1);
    expect(f.heartbeatRuns()[0]?.state).toBe("failed");
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
    expect(f.db.prepare("SELECT * FROM run_deliveries").all()).toEqual([]);
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
    f.setSource("current"); f.control.afterModel = undefined; vi.setSystemTime(Date.now() + 1_500_000);
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1); expect(f.errors).not.toHaveBeenCalled();
  });

  it("retains its own claimed source through held speech and ignores backoff caused by its own admission", async () => {
    const f = await fixture({ speak: true }); f.control.hold = true;
    let charged = false;
    f.deps.backoff = { refusal: () => charged ? "backoff-daily" : undefined,
      recordAdmission: () => { charged = true; } };
    await f.engine.evaluate();
    const runId = String(f.heartbeatRuns()[0]?.run_id);
    expect(f.heartbeatRuns()).toHaveLength(1); expect(f.deliveries.get(runId)?.state).toBe("held");
    expect(f.intentions.listDue("taki")).toEqual([]);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "claimed", runId });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
    f.control.hold = false; await f.engine.evaluate();
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.heartbeatRuns()).toHaveLength(1);
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual([f.user.content, "How did the interview go?"]);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "terminal", disposition: "speak", runId });
    expect(f.runs.status(runId).attempts).toHaveLength(1); expect(f.errors).not.toHaveBeenCalled();
  });

  it("repairs admission committed before its callback was lost and never starts a replacement Run", async () => {
    const f = await fixture(); const admit = f.runs.admit.bind(f.runs);
    const lost = vi.spyOn(f.runs, "admit").mockImplementationOnce(async (...args) => {
      await admit(...args); throw new Error("lost-after-canonical-admission");
    });
    await f.engine.evaluate(); lost.mockRestore();
    const runs = f.heartbeatRuns(); expect(runs).toHaveLength(1); expect(f.model).not.toHaveBeenCalled();
    expect(f.errors).toHaveBeenCalledTimes(1);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "claimed", runId: runs[0]!.run_id,
      canonicalRunKey: runs[0]!.idempotency_key });
    await f.engine.close();
    const intentions = createIntentionService({ db: f.db }); intentions.reconcile();
    const restarted = createInitiativeWakeEngine({ ...f.deps, intentions,
      snapshot: () => ({ ...f.snapshot, intentions: intentions.listDue("taki") }) });
    try { await restarted.evaluate(); } finally { await restarted.close(); }
    expect(f.heartbeatRuns()).toEqual(runs); expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT run_id,disposition FROM initiative_wake_claims").get())
      .toEqual({ run_id: runs[0]!.run_id, disposition: "admitted" });
  });

  it("arms a finite event-only due timer with periodic wakes disabled and leaves no replay timer", async () => {
    const f = await fixture({ dueDelay: 5000 }); f.wakePolicy.periodicEnabled = false;
    f.engine.start(); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(f.model).not.toHaveBeenCalled(); expect(f.heartbeatRuns()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.heartbeatRuns()).toHaveLength(1);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "terminal", disposition: "silent" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.errors).not.toHaveBeenCalled();
  });

  it("keeps an unavailable event-only source on finite retries without renewing its original window", async () => {
    const f = await fixture({ dueDelay: 5000 }); f.wakePolicy.periodicEnabled = false;
    f.setSource("unavailable"); f.engine.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.model).not.toHaveBeenCalled(); expect(f.heartbeatRuns()).toEqual([]);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "active", notBefore: f.plan.notBefore, expiresAt: f.plan.expiresAt });
    expect(vi.getTimerCount()).toBe(1);
    f.setSource("current"); await vi.advanceTimersByTimeAsync(f.wakePolicy.checkIntervalMs);
    expect(f.model).toHaveBeenCalledTimes(1); expect(f.heartbeatRuns()).toHaveLength(1);
    expect(f.intentions.get(f.intention)).toMatchObject({ state: "terminal", disposition: "silent",
      notBefore: f.plan.notBefore, expiresAt: f.plan.expiresAt });
    expect(vi.getTimerCount()).toBe(0); expect(f.errors).not.toHaveBeenCalled();
  });
});
