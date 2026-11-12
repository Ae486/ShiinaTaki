import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserPlaybackView, CoWatchingControlResult, CoWatchingInvitationRespond,
  InitiativeSelectedContext } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createTimelineSubscriptions } from "../server/timeline-subscriptions.ts";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createInitiativeOpportunityRepo } from "../db/initiative-opportunity-repo.ts";
import { createDeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import { createInitiativeRuntime } from "../initiative/initiative-runtime.ts";
import { createInitiativeWakeEngine } from "../initiative/wake/wake-engine.ts";
import type { InitiativeWakeSnapshot, WakeSelection } from "../initiative/wake/wake-contract.ts";
import { createViewingInvitationSource, type ViewingInvitationEvidence, type ViewingInvitationPreparation } from "./viewing-invitation-source.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); vi.useRealTimers(); });
const interactive = { connection: { state: { status: "authenticated" as const, role: "operator" as const, deviceId: "operator", capabilities: [] } } };
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
  const f = initiativeFixture(); const queue = createTurnQueue(); const turns = createTurnRegistry();
  const policy = { effectivePlaybackMs: 60_000, minimumRemainingSeconds: 120, invitationTtlMs: 120_000 };
  const initiativePolicy = { modelHourLimit: 4, utteranceHourLimit: 2, utteranceDayLimit: 8, utteranceGapMs: 1,
    busyMaxWaitMs: 90_000, outputTtlMs: 120_000, scheduledOutputTtlMs: 86_400_000 };
  const wakePolicy = { periodicEnabled: true, eventsEnabled: true, checkIntervalMs: 60_000,
    modelCadenceMs: 0, jitterRatio: 0.2, quietStart: "23:00", quietEnd: "08:00" };
  const state: InitiativeWakeSnapshot = { enabled: true, targetId: "taki", targetReady: true, policyRevision: "1",
    timezone: "UTC", timezoneRevision: 1, primaryVersion: 0, privacyPaused: false, presence: "present",
    foreground: null, presenceReturn: null, completions: [], intentions: [] };
  let view: BrowserPlaybackView = { sourceRef: randomUUID(), hostId: randomUUID(), connectionGeneration: 1, catalogGeneration: 1,
    attachmentId: randomUUID(), attachmentGeneration: 1, sequence: 1,
    source: { tabId: 1, frameId: 0, documentId: randomUUID(), playerId: randomUUID(), media: { kind: "bilibili", bvid: "BV1xx411c7mD", cid: "123", page: 1 } },
    sample: { state: "playing", positionSeconds: 0, durationSeconds: 3600, playbackRate: 1, visible: true, pictureInPicture: false },
    receivedAt: new Date().toISOString(), freshUntil: new Date(Date.now() + 5000).toISOString() };
  let present = true; let active = false; let sourceAvailable = true; let evidenceCurrent = true; let busy = false; let silent = false;
  let ready = true; let extras: BrowserPlaybackView[] = []; let acceptedSource: string | undefined;
  let afterDecision: (() => void) | undefined;
  let candidateIds: string[] = [];
  const preparedTurns: TurnContext[] = [];
  const release = vi.fn();
  const nativeImageContext = { images: [{ mediaType: "image/png" as const, dataBase64: "AAAA" }], context: "Native viewing source",
    isCurrent: () => evidenceCurrent, release };
  const prepareEvidence = vi.fn(async (input: ViewingInvitationPreparation, turn: TurnContext): Promise<ViewingInvitationEvidence | undefined> => {
    expect(f.runs.status(turn.runId!).run.state).toBe("running"); preparedTurns.push(turn);
    return { nativeImageContext, title: "Example video", text: "Captured frame and verified exact-media range access", isCurrent: () => evidenceCurrent && input.isCurrent() };
  });
  const startAccepted = vi.fn((): CoWatchingControlResult => {
    active = true;
    return { accepted: true, session: { sessionId: randomUUID(), sourceRef: view.sourceRef, analysisId: randomUUID(), title: "Example video",
      status: "starting", reason: null, expiresAt: new Date(Date.now() + 7_200_000).toISOString(), preparedCount: null, sentCount: 0, pendingRevision: false } };
  });
  const changed = vi.fn();
  const source = createViewingInvitationSource({ db: f.db, sources: { read: () => ({ enabled: !state.privacyPaused,
    sources: sourceAvailable ? [view, ...extras] : [] }) }, policy: () => policy, presence: () => present ? "present" : "unknown",
    activeSession: () => active, ready: () => ready, acceptedSource: () => acceptedSource, prepareEvidence, startAccepted, onChanged: changed });
  const model = vi.fn<(turn?: TurnContext) => void>();
  const delivery = createDeliveryCoordinator({ ...f, repo: f.deliveries, queue, turns, subscriptions: createTimelineSubscriptions(),
    busyMaxWaitMs: () => 90_000, policy: () => ({ hourLimit: 2, dayLimit: 8, gapMs: 1, dayStart: "2026-10-17T00:00:00.000Z", timezone: "UTC" }) });
  const runtime = createInitiativeRuntime({ ...f, queue, turns, delivery, opportunities: createInitiativeOpportunityRepo(f.db),
    policy: () => initiativePolicy, timezoneRevision: () => 0, enabled: () => state.enabled, authorityCurrent: () => true,
    capturePresentation: () => ({ isCurrent: () => true, accepts: () => true, execute: async () => "completed" }),
    agent: { async *stream(_params, turn) {
      model(turn);
      const effect = f.effects.prepare({ runId: turn!.runId!, attemptId: turn!.attemptId!, kind: "model",
        sourceRef: { type: "model", provider: "test", modelId: "test" }, replayPosture: "never", onCommitIntent: turn?.onCommitModelIntent });
      f.effects.settle({ runId: effect.runId, attemptId: effect.attemptId, effectId: effect.effectId, expectedVersion: effect.version, outcome: "completed" });
      await turn!.decisionCollector!.tools.heartbeat_respond!.execute!({ outcome: silent ? "silent" : "speak",
        selectedCandidateIds: silent ? [] : candidateIds, text: silent ? null : "一起看这个视频吗？", presentation: null,
        responseExpectation: silent ? null : "invitation" }, { toolCallId: "decision", messages: [], context: {} });
      afterDecision?.();
      yield "";
    } },
  });
  const prepareContext = vi.fn(async (selection: WakeSelection): Promise<InitiativeSelectedContext> => {
    candidateIds = selection.candidates.map((candidate) => candidate.candidateId);
    return { instructions: "Stable persona", controlInput: "Consider one exact video", candidateIds, allowedToolNames: [],
      manifest: { version: "initiative-context.v1", profile: "initiative-thin", capturedAt: new Date(selection.capturedAt).toISOString(),
        expiresAt: new Date(selection.expiresAt).toISOString(), policyRevision: "1", primaryVersion: 0, timezoneRevision: 0, accountingQuality: "unknown",
        sources: [{ category: "observation", reference: selection.sourceKey, revision: "1", trust: "untrusted" }] } };
  });
  const errors = vi.fn();
  const engine = createInitiativeWakeEngine({ db: f.db, patterns: { listActive: () => [] },
    snapshot: () => ({ ...state, presence: present ? "present" : "unknown", viewing: source.facts("taki") }),
    policy: () => initiativePolicy, wakePolicy: () => wakePolicy, prepareContext,
    sourceIsCurrent: source.isCurrent, prepareInput: source.prepareInput, sourceAdmitted: source.admitted,
    runtime, busy: () => busy, onError: errors });
  source.changed();
  function tick(seconds = 1) {
    for (let index = 0; index < seconds; index++) {
      vi.setSystemTime(Date.now() + 1000);
      view = { ...view, sequence: view.sequence + 1, sample: { ...view.sample,
        positionSeconds: (view.sample.positionSeconds ?? 0) + (view.sample.state === "playing" ? view.sample.playbackRate ?? 1 : 0) },
        receivedAt: new Date().toISOString(), freshUntil: new Date(Date.now() + 5000).toISOString() };
      source.changed();
    }
  }
  closers.push(async () => { await engine.close(); await runtime.close(); source.close(); f.db.close(); });
  return { ...f, source, engine, runtime, state, policy, initiativePolicy, wakePolicy, prepareEvidence, preparedTurns, model, prepareContext, release, startAccepted, changed, errors, tick,
    setSource: (value: Partial<BrowserPlaybackView>) => { view = { ...view, sequence: view.sequence + 1, ...value }; source.changed(); },
    view: () => view, setPresence: (value: boolean) => { present = value; }, setBusy: (value: boolean) => { busy = value; },
    setAvailable: (value: boolean) => { sourceAvailable = value; source.changed(); }, setEvidence: (value: boolean) => { evidenceCurrent = value; },
    setReady: (value: boolean) => { ready = value; }, setExtras: (value: BrowserPlaybackView[]) => { extras = value; },
    acceptElsewhere: () => { acceptedSource = view.sourceRef; active = true; source.facts("taki"); },
    setActive: (value: boolean) => { active = value; source.changed(); }, setSilent: () => { silent = true; },
    afterDecision: (callback: () => void) => { afterDecision = callback; },
    async invite() { tick(60); await engine.evaluate(); source.changed(); return source.read("taki").invitation; } };
}
function response(invitation: NonNullable<ReturnType<ReturnType<typeof fixture>["source"]["read"]>["invitation"]>, action: "accept" | "defer"): CoWatchingInvitationRespond {
  return { characterId: "taki", invitationId: invitation.invitationId, expectedVersion: invitation.version, commandId: randomUUID(), action };
}

describe("viewing invitation through existing Wake, Run and Delivery", () => {
  it("does no preparation, capture or model work before eligibility and judges a viewing once", async () => {
    const f = fixture(); f.tick(59); await f.engine.evaluate();
    expect(f.prepareEvidence).not.toHaveBeenCalled(); expect(f.prepareContext).not.toHaveBeenCalled(); expect(f.model).not.toHaveBeenCalled();
    f.tick(); await f.engine.evaluate(); f.source.changed();
    expect(f.errors).not.toHaveBeenCalled(); expect(f.prepareEvidence).toHaveBeenCalledTimes(1); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.model.mock.calls[0]?.[0]?.nativeImageContext?.images[0]?.dataBase64).toBe("AAAA"); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.source.read("taki"))).not.toContain("AAAA");
    expect(f.model.mock.calls[0]?.[0]?.controlInput).toContain("Captured frame"); expect(f.startAccepted).not.toHaveBeenCalled();
    expect(f.source.read("taki").invitation).not.toBeNull();
    const rows = f.db.prepare("SELECT role,content FROM timeline_messages").all();
    expect(rows).toEqual([{ role: "assistant", content: "一起看这个视频吗？" }]);
    f.tick(5); await f.engine.evaluate(); expect(f.prepareEvidence).toHaveBeenCalledTimes(1); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(f.deliveries.get(f.preparedTurns[0]!.runId!)?.deliveryClass).toBe("class_b");
  });
  it.each(["quiet", "budget", "busy", "privacy", "absence", "disabled", "unknown-duration", "near-end", "not-ready", "ambiguous"])("rejects %s before any evidence work", async (reason) => {
    const f = fixture(); f.tick(60);
    if (reason === "quiet") { f.wakePolicy.quietStart = "11:00"; f.wakePolicy.quietEnd = "13:00"; }
    if (reason === "budget") f.initiativePolicy.modelHourLimit = 0;
    if (reason === "busy") f.setBusy(true);
    if (reason === "privacy") f.state.privacyPaused = true;
    if (reason === "absence") f.setPresence(false);
    if (reason === "disabled") f.state.enabled = false;
    if (reason === "unknown-duration") f.setSource({ sample: { ...f.view().sample, durationSeconds: null } });
    if (reason === "near-end") f.setSource({ sample: { ...f.view().sample, positionSeconds: 3500 } });
    if (reason === "not-ready") f.setReady(false);
    if (reason === "ambiguous") f.setExtras([{ ...f.view(), sourceRef: randomUUID(), hostId: randomUUID() }]);
    await f.engine.evaluate();
    expect(f.prepareEvidence).not.toHaveBeenCalled(); expect(f.prepareContext).not.toHaveBeenCalled(); expect(f.model).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  });
  it("does not expose a silent judgment as an invitation or retry its viewing", async () => {
    const f = fixture(); f.setSilent(); expect(await f.invite()).toBeNull();
    f.tick(); await f.engine.evaluate(); expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
  });
  it("keeps explicit acceptance suppressed after Stop and a same-view lease renewal", async () => {
    const f = fixture(); f.tick(60); f.acceptElsewhere(); f.setActive(false);
    f.setSource({ sourceRef: randomUUID(), attachmentGeneration: 2 }); f.tick(); await f.engine.evaluate();
    expect(f.prepareEvidence).not.toHaveBeenCalled(); expect(f.model).not.toHaveBeenCalled();
  });
  it("a failed access/capture preparation creates no model decision, invitation or analysis start", async () => {
    const f = fixture(); f.prepareEvidence.mockResolvedValueOnce(undefined);
    expect(await f.invite()).toBeNull(); expect(f.model).not.toHaveBeenCalled(); expect(f.startAccepted).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM runs").get()?.state).toBe("failed");
    f.tick(); await f.engine.evaluate(); expect(f.prepareEvidence).toHaveBeenCalledTimes(1);
  });
  it("rejects a late prepared result after exact source generation changes", async () => {
    const f = fixture();
    f.prepareEvidence.mockImplementationOnce(async (input) => {
      f.setSource({ sourceRef: randomUUID(), attachmentGeneration: 2 });
      return { nativeImageContext: { images: [], context: "Late source", isCurrent: () => false, release: vi.fn() }, title: "late", text: "late evidence", isCurrent: input.isCurrent };
    });
    expect(await f.invite()).toBeNull(); expect(f.model).not.toHaveBeenCalled();
  });
  it("rechecks quiet policy after evidence preparation before the main judgment", async () => {
    const f = fixture(); const original = f.prepareEvidence.getMockImplementation()!;
    f.prepareEvidence.mockImplementationOnce(async (input, turn) => {
      const evidence = await original(input, turn); f.wakePolicy.quietStart = "11:00"; f.wakePolicy.quietEnd = "13:00"; return evidence;
    });
    expect(await f.invite()).toBeNull(); expect(f.model).not.toHaveBeenCalled();
  });
  it("rechecks captured evidence after the model and never publishes a stale invitation", async () => {
    const f = fixture(); f.afterDecision(() => f.setEvidence(false));
    expect(await f.invite()).toBeNull(); expect(f.model).toHaveBeenCalledOnce();
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
    expect(f.startAccepted).not.toHaveBeenCalled();
  });
  it("defers the same viewing with no second invitation after source renewal; new media is considered afresh", async () => {
    const f = fixture(); const invitation = (await f.invite())!;
    expect(f.source.respond(response(invitation, "defer"), interactive)).toMatchObject({ status: "applied", action: "defer" });
    expect(f.source.read("taki").invitation).toBeNull(); expect(f.startAccepted).not.toHaveBeenCalled();
    f.setSource({ sourceRef: randomUUID(), attachmentGeneration: 2 }); f.tick(); await f.engine.evaluate();
    expect(f.model).toHaveBeenCalledTimes(1);
    f.tick(301); // The existing global model-cadence floor still applies to another video's new opportunity.
    f.setSource({ source: { ...f.view().source, media: { ...f.view().source.media, cid: "456" } } });
    f.tick(61); await f.engine.evaluate(); f.source.changed();
    expect(f.model).toHaveBeenCalledTimes(2); expect(f.source.read("taki").invitation?.media.cid).toBe("456");
  });
  it("accepts a committed invitation once even after switching to Chat hides the player", async () => {
    const f = fixture(); const invitation = (await f.invite())!;
    f.setSource({ sample: { ...f.view().sample, visible: false, state: "paused" } });
    const command = response(invitation, "accept");
    const result = f.source.respond(command, interactive);
    expect(result).toMatchObject({ status: "applied", action: "accept" });
    expect(f.source.respond(command, interactive)).toEqual(result); expect(f.startAccepted).toHaveBeenCalledTimes(1);
    expect(f.source.respond({ ...command, action: "defer" }, interactive)).toEqual({ status: "refused", reason: "command_conflict" });
    expect(f.source.read("taki").invitation).toBeNull();
  });
  it("expires a published invitation after 120 seconds and refuses stale clicks", async () => {
    const f = fixture(); const invitation = (await f.invite())!;
    f.tick(119); expect(f.source.read("taki").invitation).not.toBeNull();
    f.tick(); expect(f.source.read("taki").invitation).toBeNull();
    expect(f.source.respond(response(invitation, "accept"), interactive)).toEqual({ status: "refused", reason: "stale" });
    expect(f.startAccepted).not.toHaveBeenCalled();
  });
  it("preserves the full post-publication lease when preparation consumed its original opportunity time", async () => {
    const f = fixture(); const original = f.prepareEvidence.getMockImplementation()!;
    f.prepareEvidence.mockImplementationOnce(async (input, turn) => { f.tick(30); return original(input, turn); });
    const invitation = (await f.invite())!; expect(invitation).not.toBeNull();
    f.tick(119); expect(f.source.read("taki").invitation?.invitationId).toBe(invitation.invitationId);
    f.tick(); expect(f.source.read("taki").invitation).toBeNull();
  });
  it("retires loss of source, acceptance elsewhere or evidence authority before an old click", async () => {
    const f = fixture(); const invitation = (await f.invite())!;
    f.setAvailable(false); f.setAvailable(true);
    expect(f.source.read("taki").invitation).toBeNull(); expect(f.source.respond(response(invitation, "accept"), interactive).status).toBe("refused");
    const second = fixture(); const offered = (await second.invite())!;
    second.setEvidence(false); expect(second.source.read("taki").invitation).toBeNull(); second.setEvidence(true);
    expect(second.source.read("taki").invitation).toBeNull();
    expect(second.source.respond(response(offered, "accept"), interactive).status).toBe("refused");
  });
});
