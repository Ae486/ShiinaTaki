import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionPatternDefinitionSchema, type InteractionPatternView, type InitiativeSelectedContext } from "@taki/shared";
import { initiativeFixture } from "../../testing/initiative-fixture.ts";
import { runMigrations } from "../../db/migration-runner.ts";
import { initiativeWakePolicyMigration053 } from "../../db/migrations/053-initiative-wake-policy.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createTimelineSubscriptions } from "../../server/timeline-subscriptions.ts";
import { createDeliveryCoordinator } from "../../delivery/delivery-coordinator.ts";
import { createInitiativeOpportunityRepo } from "../../db/initiative-opportunity-repo.ts";
import { createInitiativeRuntime } from "../initiative-runtime.ts";
import { createInitiativeWakeEngine } from "./wake-engine.ts";
import { canonicalWakeKey, createWakePolicyRepo } from "./wake-policy-repo.ts";
import type { InitiativeWakeSnapshot, WakeSelection } from "./wake-contract.ts";

const closing: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closing.splice(0)) await close(); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  const f = initiativeFixture(); runMigrations(f.db, [initiativeWakePolicyMigration053]);
  const queue = createTurnQueue(); const turns = createTurnRegistry(); let busy = false;
  const policy = { modelHourLimit: 4, utteranceHourLimit: 2, utteranceDayLimit: 8, utteranceGapMs: 600_000,
    busyMaxWaitMs: 90_000, outputTtlMs: 600_000, scheduledOutputTtlMs: 86_400_000 };
  const wakePolicy = { periodicEnabled: true, eventsEnabled: true, checkIntervalMs: 60_000,
    modelCadenceMs: 900_000, jitterRatio: 0.2, quietStart: "23:00", quietEnd: "08:00" };
  const snapshot: InitiativeWakeSnapshot = { enabled: true, targetId: "taki", targetReady: true, policyRevision: "1",
    timezone: "UTC", timezoneRevision: 1, primaryVersion: 0, privacyPaused: false, presence: "present",
    foreground: null, presenceReturn: null, completions: [], intentions: [] };
  const definition = InteractionPatternDefinitionSchema.parse({ title: "Reflection", purpose: "Consider the current reflection window",
    conditions: { all: [{ kind: "local_time_window", start: "11:00", end: "13:00", daysOfWeek: [1] }] },
    contextSelectors: [], allowedOutcomes: ["silent", "speak"], timing: { minimumGapMinutes: 0, chance: 1 },
    lifetime: { startsAt: null, expiresAt: null } });
  const patterns: InteractionPatternView[] = [{ patternId: "reflection", characterId: "taki", version: 2, state: "active",
    effectiveRevision: { revisionId: "r1", baseVersion: 1, definition, origin: { kind: "user", description: "Reviewed" },
      changes: [], createdAt: new Date().toISOString(), acceptedAt: new Date().toISOString() }, candidateRevision: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  const model = vi.fn();
  const delivery = createDeliveryCoordinator({ ...f, repo: f.deliveries, queue, turns, subscriptions: createTimelineSubscriptions(),
    busyMaxWaitMs: () => policy.busyMaxWaitMs, policy: () => ({ hourLimit: 2, dayLimit: 8, gapMs: 600_000,
      dayStart: "2026-09-28T00:00:00.000Z", timezone: snapshot.timezone }) });
  const runtime = createInitiativeRuntime({ ...f, queue, turns, delivery, opportunities: createInitiativeOpportunityRepo(f.db),
    policy: () => policy, timezoneRevision: () => snapshot.timezoneRevision, enabled: () => snapshot.enabled, authorityCurrent: () => true,
    capturePresentation: () => ({ isCurrent: () => true, accepts: () => true, execute: async () => "completed" }),
    agent: { async *stream(_params, turn) {
      model();
      const effect = f.effects.prepare({ runId: turn!.runId!, attemptId: turn!.attemptId!, kind: "model",
        sourceRef: { type: "model", provider: "fixture", modelId: "fixture" }, replayPosture: "never", onCommitIntent: turn?.onCommitModelIntent });
      f.effects.settle({ runId: effect.runId, attemptId: effect.attemptId, effectId: effect.effectId, expectedVersion: effect.version, outcome: "completed" });
      await turn!.decisionCollector!.tools.heartbeat_respond!.execute!({ outcome: "silent", selectedCandidateIds: [],
        text: null, presentation: null, responseExpectation: null },
        { toolCallId: "decision", messages: [], context: {} });
      yield "";
    } },
  });
  const prepareContext = vi.fn(async (selection: WakeSelection): Promise<InitiativeSelectedContext> => ({
    instructions: "Stable Persona", controlInput: "Consider the admitted purposes", candidateIds: selection.candidates.map((c) => c.candidateId),
    allowedToolNames: [], manifest: { version: "initiative-context.v1", profile: "initiative-thin", capturedAt: new Date(selection.capturedAt).toISOString(),
      expiresAt: new Date(selection.expiresAt).toISOString(), primaryVersion: snapshot.primaryVersion, timezoneRevision: snapshot.timezoneRevision,
      policyRevision: snapshot.policyRevision, accountingQuality: "unknown", sources: [{ category: "pattern", reference: "reflection", revision: "r1", trust: "core" }] } }));
  const changed = vi.fn(); const errors = vi.fn(); const invalidate = vi.fn();
  const deps = { db: f.db, patterns: { listActive: () => patterns }, snapshot: () => snapshot, policy: () => policy,
    wakePolicy: () => wakePolicy, prepareContext, runtime, busy: () => busy, onChanged: changed, onError: errors, invalidate };
  const engine = createInitiativeWakeEngine(deps);
  closing.push(async () => { await engine.close(); await runtime.close(); f.db.close(); });
  return { ...f, engine, deps, runtime, model, prepareContext, patterns, snapshot, policy, wakePolicy, changed, errors, invalidate,
    busy: (value: boolean) => { busy = value; } };
}

describe("wake engine through real C1 Run/Effect accounting", () => {
  it("ignores source and policy notifications until the explicit post-recovery start barrier", async () => {
    const f = fixture(); f.engine.notify("source"); f.engine.notify("policy"); f.engine.notify("release");
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0); expect(f.model).not.toHaveBeenCalled();
    f.engine.start(); f.engine.notify("source"); await vi.advanceTimersByTimeAsync(1);
    expect(f.model).toHaveBeenCalledTimes(1);
  });
  it.each(["source", "policy", "release"] as const)("cannot start work from %s when both wake sources are disabled", async (reason) => {
    const f = fixture(); f.wakePolicy.periodicEnabled = false; f.wakePolicy.eventsEnabled = false;
    f.engine.start(); f.engine.notify(reason); await vi.advanceTimersByTimeAsync(1);
    expect(f.model).not.toHaveBeenCalled(); expect(f.prepareContext).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await f.engine.evaluate();
    expect(f.engine.read("taki").recent[0]?.reason).toBe("wake-disabled");
    expect(f.model).not.toHaveBeenCalled(); expect(f.prepareContext).not.toHaveBeenCalled();
  });
  it("keeps event-only and periodic-only wake modes independently usable", async () => {
    const events = fixture(); events.wakePolicy.periodicEnabled = false;
    events.engine.start(); expect(vi.getTimerCount()).toBe(0);
    events.engine.notify("source"); await vi.advanceTimersByTimeAsync(1);
    expect(events.model).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const periodic = fixture(); periodic.wakePolicy.eventsEnabled = false;
    periodic.engine.start(); periodic.engine.notify("source"); await vi.advanceTimersByTimeAsync(1);
    expect(periodic.model).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(periodic.wakePolicy.checkIntervalMs);
    expect(periodic.model).toHaveBeenCalledTimes(1);
  });
  it("retires pending busy work and rejects prepared context when both wake modes are disabled", async () => {
    const pending = fixture(); pending.busy(true); await pending.engine.evaluate();
    pending.wakePolicy.periodicEnabled = false; pending.wakePolicy.eventsEnabled = false; pending.busy(false);
    await pending.engine.evaluate();
    expect(pending.prepareContext).not.toHaveBeenCalled(); expect(pending.model).not.toHaveBeenCalled();
    expect(pending.db.prepare("SELECT disposition FROM initiative_wake_claims").get()?.disposition).toBe("retired");
    const preparing = fixture(); const original = preparing.prepareContext.getMockImplementation()!;
    preparing.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection);
      preparing.wakePolicy.periodicEnabled = false; preparing.wakePolicy.eventsEnabled = false;
      return context;
    });
    await preparing.engine.evaluate();
    expect(preparing.model).not.toHaveBeenCalled();
    expect(preparing.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  });
  it("admits one shared judgment for compatible data-only definitions and never repeats the source occurrence", async () => {
    const f = fixture();
    f.patterns.push(...Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(f.patterns[0]!), patternId: `extra-${i}` })));
    await f.engine.evaluate(); await f.engine.evaluate();
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.prepareContext.mock.calls[0]![0].candidates).toHaveLength(4);
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT disposition FROM initiative_wake_claims").get()?.disposition).toBe("admitted");
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
    vi.setSystemTime(Date.now() + 1_500_000);
    const restarted = createInitiativeWakeEngine(f.deps); await restarted.evaluate(); await restarted.close();
    expect(f.model).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "quiet", "empty", "missing", "stale", "privacy", "budget", "chance"])("performs zero model and context work for %s", async (condition) => {
    const f = fixture();
    if (condition === "disabled") f.snapshot.enabled = false;
    if (condition === "quiet") { f.wakePolicy.quietStart = "11:00"; f.wakePolicy.quietEnd = "13:00"; }
    if (condition === "empty") f.patterns.splice(0);
    if (["missing", "stale", "privacy"].includes(condition)) {
      f.patterns[0]!.effectiveRevision!.definition.conditions.all = [{ kind: "activity_dwell_at_least", minutes: 10 }];
      if (condition !== "missing") f.snapshot.foreground = { occurrenceKey: "activity", application: "Editor", meaningful: true,
        startedAt: Date.now() - 1_800_000, observedAt: Date.now() - (condition === "stale" ? 60_000 : 0), idleSeconds: null,
        observationEpoch: 1, hostId: "host", connectionGeneration: 1, catalogGeneration: 1 };
      f.snapshot.privacyPaused = condition === "privacy";
    }
    if (condition === "budget") f.policy.modelHourLimit = 0;
    if (condition === "chance") f.patterns[0]!.effectiveRevision!.definition.timing.chance = 0;
    await f.engine.evaluate();
    expect(f.model).not.toHaveBeenCalled(); expect(f.prepareContext).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  });
  it("waits once while busy without sliding expiry, and cannot replay expired work after release", async () => {
    const f = fixture(); f.busy(true); await f.engine.evaluate();
    vi.setSystemTime(Date.now() + 60_000); await f.engine.evaluate();
    expect(f.prepareContext).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 31_000); f.busy(false); await f.engine.evaluate(); await f.engine.evaluate();
    expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT disposition FROM initiative_wake_claims").get()?.disposition).toBe("retired");
  });
  it("dispatches the same bounded pending selection when busy clears in time", async () => {
    const f = fixture(); f.busy(true); await f.engine.evaluate();
    vi.setSystemTime(Date.now() + 30_000); f.busy(false); await f.engine.evaluate();
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.prepareContext.mock.calls[0]![0].expiresAt).toBe(Date.parse("2026-09-28T12:10:00.000Z"));
  });
  it("invalidates Pattern/policy/target changes during context preparation before admitting a Run", async () => {
    const f = fixture(); const original = f.prepareContext.getMockImplementation()!;
    f.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection); f.patterns[0]!.effectiveRevision!.revisionId = "changed-effective"; return context;
    });
    await f.engine.evaluate(); expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.engine.read("taki").recent[0]?.reason).toBe("stale-policy");
  });
  it("preserves Core-wide model capacity across target and timezone switches", async () => {
    const f = fixture(); f.policy.modelHourLimit = 1; await f.engine.evaluate();
    f.snapshot.targetId = "other"; f.snapshot.timezone = "Europe/Paris"; f.snapshot.timezoneRevision += 1;
    f.patterns[0]!.characterId = "other"; f.patterns[0]!.patternId = "other-pattern";
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.engine.read("other").recent[0]?.reason).toBe("model-budget");
  });
  it("coalesces repeated policy observations and isolates asynchronous observer failures", async () => {
    const f = fixture(); f.snapshot.enabled = false;
    f.changed.mockImplementation(async () => { throw new Error("observer failure"); });
    await f.engine.evaluate(); await f.engine.evaluate();
    const status = f.engine.read("taki");
    expect(status.recent).toHaveLength(1); expect(status.counters).toEqual([{ reason: "disabled", count: 1 }]);
    expect(f.errors).toHaveBeenCalledTimes(1); expect(f.model).not.toHaveBeenCalled();
    const repo = createWakePolicyRepo(f.db, Date.now);
    for (let index = 0; index < 150; index++) repo.note("taki", { reason: index % 2 ? "no-pattern" : "no-signal",
      source: "none", matchedCount: 0, occurredAt: new Date().toISOString() });
    expect(repo.read("taki").recent).toHaveLength(100);
  });
  it("has bounded unref timers and does not accumulate a catch-up backlog after sleep", async () => {
    const f = fixture(); f.engine.start();
    f.engine.notify(); f.engine.notify(); f.engine.notify();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(f.model).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 86_400_000);
    await vi.advanceTimersByTimeAsync(60_000); expect(f.model).toHaveBeenCalledTimes(1);
    await f.engine.close(); expect(vi.getTimerCount()).toBe(0);
  });
  it("reconciles a claim/admit/link crash cut from canonical idempotency without another Run", async () => {
    const f = fixture(); const original = f.prepareContext.getMockImplementation()!;
    f.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection); const key = canonicalWakeKey(selection.characterId, selection.opportunityId);
      await f.runs.admit({ triggerRequestId: key, idempotencyKey: key, characterId: selection.characterId,
        initiator: "heartbeat", provenance: { provider: "initiative", sourceRef: key }, deliveryClass: "class_b", contextMode: "autonomous" }, undefined, context);
      throw new Error("crash after canonical admission before linking");
    });
    await f.engine.evaluate();
    expect(f.db.prepare("SELECT disposition,run_id FROM initiative_wake_claims").get()?.disposition).toBe("admitted");
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(f.model).not.toHaveBeenCalled();
    f.prepareContext.mockImplementation(original);
    const restarted = createInitiativeWakeEngine(f.deps); await restarted.evaluate(); await restarted.close();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1); expect(f.model).not.toHaveBeenCalled();
  });
  it("charges Pattern judgment cooldown for silence and preserves it across accepted revision changes", async () => {
    const f = fixture(); await f.engine.evaluate();
    vi.setSystemTime(Date.now() + 3_660_000);
    const revision = f.patterns[0]!.effectiveRevision!;
    revision.revisionId = "revised"; revision.definition.timing.minimumGapMinutes = 120;
    revision.definition.conditions.all = [{ kind: "local_time_window", start: "13:00", end: "14:00", daysOfWeek: [1] }];
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.engine.read("taki").recent[0]?.reason).toBe("pattern-cooldown");
  });
  it("cannot let a failed error reporter turn observer rejection into admission failure", async () => {
    const f = fixture(); f.changed.mockImplementation(async () => { throw new Error("observer"); });
    f.errors.mockImplementation(() => { throw new Error("reporter"); });
    await expect(f.engine.evaluate()).resolves.toBeUndefined();
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT disposition FROM initiative_wake_claims").get()?.disposition).toBe("admitted");
  });
  it("preserves a charged utterance day across a target/zone switch whose new day starts after the charge", async () => {
    const f = fixture(); vi.setSystemTime(new Date("2026-09-28T20:00:00.000Z"));
    const admitted = await f.admit();
    f.deliveries.stage({ ...admitted, primaryVersion: 0, consideredCount: 1,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      decision: { outcome: "speak", text: "A real committed utterance", presentation: null,
        selectedCandidateIds: ["reason"], responseExpectation: "none" } });
    f.runs.settle(admitted.runId, admitted.attemptId, "completed", { retryable: false });
    f.deliveries.commitPublication({ runId: admitted.runId, append: f.store.appendDelivery,
      policy: { hourLimit: 2, dayLimit: 8, gapMs: 600_000, timezone: "UTC", dayStart: "2026-09-28T00:00:00.000Z" } });
    vi.setSystemTime(new Date("2026-09-28T23:00:00.000Z"));
    f.snapshot.targetId = "other"; f.snapshot.timezone = "Europe/Paris"; f.snapshot.timezoneRevision++;
    f.wakePolicy.quietStart = "00:00"; f.wakePolicy.quietEnd = "00:00"; f.policy.utteranceDayLimit = 1;
    await f.engine.evaluate();
    expect(f.engine.read("other").recent[0]?.reason).toBe("utterance-budget");
    expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
  });
  it("retires optional Sampling context on Privacy Pause even when the matched reason is clock-only", async () => {
    const f = fixture(); f.patterns[0]!.effectiveRevision!.definition.contextSelectors = ["accepted_screen"];
    f.snapshot.foreground = { occurrenceKey: "accepted", application: "Editor", meaningful: true,
      startedAt: Date.now() - 60_000, observedAt: Date.now(), idleSeconds: 0,
      observationEpoch: 1, hostId: "host", connectionGeneration: 1, catalogGeneration: 1 };
    const original = f.prepareContext.getMockImplementation()!;
    f.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection); f.snapshot.privacyPaused = true; return context;
    });
    await f.engine.evaluate();
    expect(f.model).not.toHaveBeenCalled(); expect(f.engine.read("taki").recent[0]?.reason).toBe("stale-policy");
  });
  it("retains the thin-input assembler's original Memory authority across the later C1 capture", async () => {
    const f = fixture(); let contextCurrent = true;
    const engine = createInitiativeWakeEngine({ ...f.deps, contextIsCurrent: () => contextCurrent });
    const original = f.prepareContext.getMockImplementation()!;
    f.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection); contextCurrent = false; return context;
    });
    await engine.evaluate(); await engine.close();
    expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.engine.read("taki").recent[0]?.reason).toBe("stale-policy");
  });
  it("keeps the accepted rule current while drafting a separate unconfirmed replacement", async () => {
    const f = fixture(); const original = f.prepareContext.getMockImplementation()!;
    f.prepareContext.mockImplementation(async (selection) => {
      const context = await original(selection); f.patterns[0]!.version += 1;
      f.patterns[0]!.candidateRevision = { ...structuredClone(f.patterns[0]!.effectiveRevision!), revisionId: "unconfirmed", acceptedAt: null };
      return context;
    });
    await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT disposition FROM initiative_wake_claims").get()?.disposition).toBe("admitted");
  });
});
