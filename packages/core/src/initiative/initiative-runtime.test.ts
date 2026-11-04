import { afterEach, describe, expect, it, vi } from "vitest";
import type { HeartbeatDecision, InitiativeSelectedContext } from "@taki/shared";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createInitiativeOpportunityRepo } from "../db/initiative-opportunity-repo.ts";
import { createDeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import { createInitiativeRuntime } from "./initiative-runtime.ts";
import { canonicalWakeKey } from "./wake/wake-policy-repo.ts";
import { tool } from "ai";
import { z } from "zod";
import { wrapGovernedTool } from "../governance/governed-tool.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";

const fixtures: { db: ReturnType<typeof initiativeFixture>["db"]; runtime: ReturnType<typeof createInitiativeRuntime> }[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) { await f.runtime.close(); f.db.close(); }
  vi.useRealTimers();
});

function fixture(options: { ttl?: number; retire?: "before-intent" | "after-intent"; decision?: HeartbeatDecision } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
  const nativeInputs: unknown[] = [];
  const f = initiativeFixture(); const queue = createTurnQueue(); const turns = createTurnRegistry();
  let revision = 1; let gate: "ready" | "hold" = "ready";
  const presentation = vi.fn(async () => "completed" as const);
  const delivery = createDeliveryCoordinator({ ...f, repo: f.deliveries, queue, turns, subscriptions: createTimelineSubscriptions(),
    busyMaxWaitMs: () => 90_000, policy: () => ({ hourLimit: 2, dayLimit: 8, gapMs: 1, dayStart: "2026-09-26T00:00:00.000Z", timezone: "UTC" }) });
  const runtime = createInitiativeRuntime({ ...f, queue, turns, delivery,
    opportunities: createInitiativeOpportunityRepo(f.db), enabled: () => true, authorityCurrent: () => true,
    timezoneRevision: () => revision,
    policy: () => ({ modelHourLimit: 1, utteranceHourLimit: 2, utteranceDayLimit: 8, utteranceGapMs: 1,
      busyMaxWaitMs: 90_000, outputTtlMs: options.ttl ?? 600_000, scheduledOutputTtlMs: 86_400_000 }),
    capturePresentation: () => ({ isCurrent: () => true, accepts: () => true, execute: presentation }),
    agent: { async *stream(_params, turn) {
      nativeInputs.push(turn?.nativeImageContext?.images.map((image) => ({ ...image })));
      if (options.retire === "before-intent") revision++;
      const effect = f.effects.prepare({ runId: turn!.runId!, attemptId: turn!.attemptId!, kind: "model",
        sourceRef: { type: "model", provider: "test", modelId: "test" }, replayPosture: "never", onCommitIntent: turn?.onCommitModelIntent });
      f.effects.settle({ runId: effect.runId, attemptId: effect.attemptId, effectId: effect.effectId, expectedVersion: effect.version, outcome: "completed" });
      if (options.retire === "after-intent") revision++;
      await turn!.decisionCollector!.tools.heartbeat_respond!.execute!(
        { text: null, responseExpectation: null, presentation: null,
          ...(options.decision ?? { outcome: "express", selectedCandidateIds: ["one"], presentation: { kind: "expression", name: "happy" } }) },
        { toolCallId: "decision", messages: [], context: {} });
      yield "";
    } },
  });
  const selectedContext: InitiativeSelectedContext = { instructions: "Stable persona", controlInput: "Consider the due matter",
    candidateIds: ["one"], allowedToolNames: [], manifest: { version: "initiative-context.v1", profile: "initiative-thin",
      capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100_000).toISOString(), policyRevision: "test",
      primaryVersion: 0, timezoneRevision: 1, accountingQuality: "unknown",
      sources: [{ category: "time", reference: "user-timezone", revision: "1", trust: "core" }] } };
  const result = { ...f, runtime, presentation, selectedContext, nativeInputs,
    retireTimezone: () => { revision++; }, hold: () => { gate = "hold"; },
    dispatch: () => runtime.dispatch({ opportunityId: "one", characterId: "taki", selectedContext, isCurrent: () => true, deliveryGate: () => gate }) };
  fixtures.push(result); return result;
}

describe("initiative expiry and timezone fences", () => {
  it("binds admitted evidence reads to the Run and Attempt before the Agent starts", async () => {
    const f = fixture();
    const service = createGovernancePolicyService(createGovernancePolicyRepo(f.db));
    const read = wrapGovernedTool(tool({ inputSchema: z.strictObject({}), execute: async () => ({ ok: true }) }), {
      service, binding: { identity: { capabilityId: "workspace.file.read", ownerHostId: "11111111-1111-4111-8111-111111111111" }, cellKey: "workspace-read" },
    });
    let capturedContext: ReturnType<typeof f.runs.context>;
    const result = await f.runtime.dispatch({ opportunityId: "prepared", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready",
      onAdmitted({ runId }) { capturedContext = f.runs.context(runId); Object.assign(capturedContext!, { tools: Object.freeze({ evidence_read: read }) }); return true; },
      async prepareInput(turn) {
        await turn.runContext!.tools!.evidence_read!.execute!({}, { toolCallId: "evidence", messages: [], context: undefined });
        expect(f.effects.list?.(turn.runId!).filter(effect => effect.kind === "tool")).toHaveLength(1);
        return { text: "Verified captured evidence" };
      } });
    expect(f.runs.status(result.runId!).run.state).toBe("completed");
    const effect = f.effects.list?.(result.runId!).find(effect => effect.kind === "tool");
    expect(effect).toMatchObject({ runId: result.runId, attemptId: result.attemptId, outcome: "completed" });
    expect(capturedContext?.tools?.evidence_read).toBe(read);
  });

  it("carries prepared native pixels into the single normal decision and releases after silent settlement", async () => {
    const f = fixture({ decision: { outcome: "silent", selectedCandidateIds: [] } }); const release = vi.fn();
    const input = { images: [{ mediaType: "image/png" as const, dataBase64: "AAAA" }], context: "Screen source",
      isCurrent: () => true, release };
    const result = await f.runtime.dispatch({ opportunityId: "native", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready", prepareInput: async () => ({ text: "Screen evidence", nativeImageContext: input }) });
    expect(f.nativeInputs).toEqual([[{ mediaType: "image/png", dataBase64: "AAAA" }]]);
    expect(f.effects.list?.(result.runId!).filter((effect) => effect.kind === "model")).toHaveLength(1);
    expect(release).toHaveBeenCalledOnce(); expect(JSON.stringify(f.selectedContext)).not.toContain("AAAA");
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
  });

  it("releases invalidated preparation without beginning a main-model request", async () => {
    const f = fixture(); const release = vi.fn();
    const result = await f.runtime.dispatch({ opportunityId: "native-invalid", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready", prepareInput: async () => ({ text: "Screen evidence",
        nativeImageContext: { images: [{ mediaType: "image/png", dataBase64: "AAAA" }], context: "Screen source", isCurrent: () => false, release } }) });
    expect(f.runs.status(result.runId!).run.state).toBe("failed"); expect(f.effects.list?.(result.runId!)).toEqual([]);
    expect(f.nativeInputs).toEqual([]); expect(release).toHaveBeenCalledOnce();
  });

  it("refuses backoff before canonical admission without invoking its admission callback", async () => {
    const f = fixture(); const onAdmitted = vi.fn(() => true);
    const result = await f.runtime.dispatch({ opportunityId: "one", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready", beforeAdmit: () => "budget", onAdmitted });
    expect(result).toEqual({ status: "refused", reason: "budget" });
    expect(onAdmitted).not.toHaveBeenCalled(); expect(f.presentation).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT state,run_id,charged_at FROM initiative_model_opportunities").get())
      .toEqual({ state: "released", run_id: null, charged_at: null });
  });

  it("fails a newly committed admission if its binding throws before any model Effect", async () => {
    const f = fixture(); const onAdmitted = vi.fn(() => { throw new Error("binding-write-failed"); });
    const result = await f.runtime.dispatch({ opportunityId: "one", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready", onAdmitted });
    expect(result.status).toBe("settled"); expect(onAdmitted).toHaveBeenCalledTimes(1);
    expect(f.runs.status(result.runId!).run.state).toBe("failed");
    expect(f.effects.list?.(result.runId!)).toEqual([]);
    expect(f.deliveries.get(result.runId!)).toBeUndefined(); expect(f.presentation).not.toHaveBeenCalled();
  });

  it("does not rebind a reused Run or backfill its unknown admission timezone", async () => {
    const f = fixture(); const key = canonicalWakeKey("taki", "one");
    const previous = await f.runs.admit({ triggerRequestId: key, idempotencyKey: key, characterId: "taki",
      initiator: "heartbeat", provenance: { provider: "initiative", sourceRef: key },
      deliveryClass: "class_b", contextMode: "autonomous", deadlineAt: f.selectedContext.manifest.expiresAt }, undefined, f.selectedContext);
    const onAdmitted = vi.fn(() => true);
    const result = await f.runtime.dispatch({ opportunityId: "one", characterId: "taki", selectedContext: f.selectedContext,
      isCurrent: () => true, deliveryGate: () => "ready", onAdmitted });
    expect(result.runId).toBe(previous.run.runId); expect(onAdmitted).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT initiative_timezone FROM runs WHERE run_id=:runId").get({ runId: result.runId! })?.initiative_timezone).toBeNull();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(f.effects.list?.(result.runId!)).toEqual([]); expect(f.presentation).not.toHaveBeenCalled();
  });

  it("enforces captured Pattern outcomes in the actual Run and does not relabel refusal as successful silence", async () => {
    const f = fixture(); f.selectedContext.candidatePolicies = [{ candidateId: "one", allowedOutcomes: ["silent"] }];
    const result = await f.dispatch();
    expect(f.runs.status(result.runId!).run.state).toBe("failed");
    expect(f.deliveries.get(result.runId!)).toBeUndefined(); expect(f.presentation).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities WHERE charged_at IS NOT NULL").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
  });

  it("requires every selected candidate to allow the outcome, even when another candidate allows it", async () => {
    const f = fixture({ decision: { outcome: "express", selectedCandidateIds: ["one", "two"], presentation: { kind: "expression", name: "happy" } } });
    f.selectedContext.candidateIds = ["one", "two"];
    f.selectedContext.candidatePolicies = [{ candidateId: "one", allowedOutcomes: ["silent"] },
      { candidateId: "two", allowedOutcomes: ["silent", "express"] }];
    const result = await f.dispatch();
    expect(f.runs.status(result.runId!).run.state).toBe("failed"); expect(f.presentation).not.toHaveBeenCalled();
  });

  it("does not let an unselected restrictive candidate veto an allowed selected expression", async () => {
    const f = fixture(); f.selectedContext.candidateIds = ["one", "two"];
    f.selectedContext.candidatePolicies = [{ candidateId: "one", allowedOutcomes: ["silent", "express"] },
      { candidateId: "two", allowedOutcomes: ["silent"] }];
    const result = await f.dispatch();
    expect(f.runs.status(result.runId!).run.state).toBe("completed"); expect(f.presentation).toHaveBeenCalledTimes(1);
  });

  it("accepts deliberate silence with no selected candidate under every captured outcome restriction", async () => {
    const f = fixture({ decision: { outcome: "silent", selectedCandidateIds: [] } });
    f.selectedContext.candidatePolicies = [{ candidateId: "one", allowedOutcomes: ["silent"] }];
    const result = await f.dispatch();
    expect(f.runs.status(result.runId!).run.state).toBe("completed");
    expect(f.deliveries.get(result.runId!)?.decision.outcome).toBe("silent"); expect(f.presentation).not.toHaveBeenCalled();
  });
  it("refuses an old timezone revision before creating a Run or reservation", async () => {
    const f = fixture(); f.retireTimezone();
    expect(await f.dispatch()).toEqual({ status: "refused", reason: "stale" });
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities").get()?.n).toBe(0);
  });

  it.each(["before-intent", "after-intent"] as const)("revalidates timezone %s and keeps model accounting truthful", async (retire) => {
    const f = fixture({ retire }); const result = await f.dispatch();
    expect(result.status).toBe("settled");
    expect(f.runs.status(result.runId!).run.state).toBe("failed");
    const charged = f.db.prepare("SELECT charged_at FROM initiative_model_opportunities").get()?.charged_at;
    expect(charged === null).toBe(retire === "before-intent");
    expect(f.effects.list?.(result.runId!)).toHaveLength(retire === "before-intent" ? 0 : 1);
    expect(f.deliveries.get(result.runId!)).toBeUndefined();
    expect(f.presentation).not.toHaveBeenCalled();
  });

  it.each([30_000, 200_000])("stages the earlier configured output lifetime and source deadline (%s ms)", async (ttl) => {
    const f = fixture({ ttl }); f.hold(); const result = await f.dispatch();
    expect(result.status).toBe("held");
    expect(f.deliveries.get(result.runId!)?.expiresAt).toBe(new Date(Date.now() + Math.min(ttl, 100_000)).toISOString());
  });

  it("invalidates a held same-Attempt expression after a timezone revision without another model or presentation", async () => {
    const f = fixture(); f.hold(); const result = await f.dispatch();
    expect(result.status).toBe("held"); f.retireTimezone();
    expect(await f.runtime.resume(result.runId!)).toBe("refused");
    expect(f.deliveries.get(result.runId!)?.state).toBe("expired");
    expect(f.runs.status(result.runId!).run.state).toBe("cancelled");
    expect(f.runs.status(result.runId!).attempts).toHaveLength(1);
    expect(f.effects.list?.(result.runId!)).toHaveLength(1);
    expect(f.presentation).not.toHaveBeenCalled();
  });
});
