import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCEPTED_WORK_PROVIDER, type TriggerRequest } from "@taki/shared";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createRunServiceStub } from "../testing/run-service-stub.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createRunService } from "./run-service.ts";
import { createEffectLifecycleService } from "./effect-lifecycle-service.ts";
import { createRecoveryCoordinator } from "./recovery-coordinator.ts";
import { projectEvent } from "../observability/observability-event-projection.ts";
import { inspectEvent } from "../observability/observability-inspector.ts";

const databases: Database[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of databases.splice(0)) db.close(); });
const request: TriggerRequest = { triggerRequestId: "accepted-source", idempotencyKey: "accepted-work",
  characterId: "taki", initiator: "primary", deliveryClass: "internal", contextMode: "autonomous",
  provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: "accepted:primary-source" } };

async function fixture(extra: Partial<TriggerRequest> = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const events = createRunEventRepo(db); const repo = createRunRepo(db, events);
  const flags = { authority: true, source: true };
  const sourceRef = request.provenance.sourceRef!;
  const context = { authorityCurrent: () => flags.authority,
    acceptedWork: { sourceRef, isCurrent: () => flags.source } };
  const snapshot = { async capture(candidate: TriggerRequest) {
    return { snapshot: (await createRunServiceStub().admit(candidate)).snapshot, context };
  } };
  const service = createRunService({ repo, snapshot, provider: "fixture", modelId: "fixture" });
  const admitted = await service.admit({ ...request, ...extra });
  service.start(admitted.run.runId, admitted.attempt.attemptId);
  const identity = () => ({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
    expectedRunVersion: service.status(admitted.run.runId).run.stateVersion });
  return { db, events, repo, service, snapshot, context, flags, sourceRef, admitted, identity };
}

describe("accepted-work quiescent lifecycle", () => {
  it("holds without fabricated delivery/effects and resumes the same Attempt behind foreground work", async () => {
    const f = await fixture(); const queue = createTurnQueue();
    const release = await queue.acquire("taki");
    const hold = f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef });
    expect(hold).toEqual({ changed: true, state: "waiting", runVersion: 2 });
    release();
    expect(f.repo.guardDispatch(f.admitted.run.runId, f.admitted.attempt.attemptId)).toBe(false);
    const primary = queue.reservePrimary("taki");
    expect(queue.tryAcquireBackground("taki")).toBeUndefined();
    const releasePrimary = await primary.acquire(); releasePrimary();
    const releaseResume = queue.tryAcquireBackground("taki"); expect(releaseResume).toBeTypeOf("function");
    try { expect(f.service.resumeWork(f.identity())).toEqual({ changed: true, state: "running", runVersion: 3 }); }
    finally { releaseResume?.(); }
    expect(f.service.status(f.admitted.run.runId).attempts).toHaveLength(1);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries").get()?.n).toBe(0);
    const work = f.events.list(f.admitted.run.runId).filter((event) => event.schemaVersion === "run-event.v3");
    expect(work.map((event) => event.kind)).toEqual(["run.work_held", "run.work_resumed"]);
    for (const event of work) {
      expect(projectEvent(event).kind).toBe("lifecycle");
      expect(JSON.stringify(inspectEvent(event, "FULL_LOCAL"))).not.toContain(f.sourceRef);
    }
  });

  it("refuses stale versions, different Attempts and a changed immutable purpose", async () => {
    const f = await fixture(); const identity = f.identity();
    expect(f.service.holdWork({ ...identity, expectedRunVersion: 0, reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "stale_version" });
    expect(f.service.holdWork({ ...identity, attemptId: "different", reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "stale_attempt" });
    expect(f.service.holdWork({ ...identity, reasonRef: "different-purpose" }))
      .toEqual({ changed: false, reason: "wrong_scope" });
    expect(f.service.status(identity.runId).run.stateVersion).toBe(identity.expectedRunVersion);
  });

  it("keeps unfinished Effects outside quiescent work and refuses closed/retired authority", async () => {
    const f = await fixture();
    const effects = createEffectLifecycleService(createEffectRepo(f.db, f.events));
    effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId,
      kind: "tool", sourceRef: { type: "tool", toolName: "fixture" }, replayPosture: "never" });
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "unfinished_effect" });
    f.flags.authority = false;
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "authority_changed" });
    f.service.seal();
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "closed" });
  });

  it("refuses source retirement, cancellation and expiry without reopening the root", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-10T01:00:00.000Z");
    const f = await fixture({ deadlineAt: "2026-10-10T01:00:10.000Z" });
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }).changed).toBe(true);
    f.flags.source = false;
    expect(f.service.resumeWork(f.identity())).toEqual({ changed: false, reason: "binding_lost" });
    f.flags.source = true; vi.setSystemTime("2026-10-10T01:00:11.000Z");
    expect(f.service.resumeWork(f.identity())).toEqual({ changed: false, reason: "expired" });
    f.service.requestCancel(f.admitted.run.runId);
    expect(f.service.resumeWork(f.identity())).toEqual({ changed: false, reason: "invalid_state" });
    expect(f.service.status(f.admitted.run.runId).run.state).toBe("cancel_requested");
  });

  it("atomically rolls back a hold when its required event cannot be persisted", async () => {
    const f = await fixture();
    const broken = createRunRepo(f.db, { ...f.events, append() { throw new Error("EVENT_WRITE_FAILED"); } });
    const before = f.service.status(f.admitted.run.runId).run;
    expect(() => broken.holdWork({ ...f.identity(), reasonRef: f.sourceRef })).toThrow("EVENT_WRITE_FAILED");
    expect(f.service.status(f.admitted.run.runId).run).toEqual(before);
  });

  it("preserves an accepted purpose at restart instead of treating its last model Effect as completion", async () => {
    const f = await fixture();
    const effects = createEffectLifecycleService(createEffectRepo(f.db, f.events));
    const effect = effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId,
      kind: "model", sourceRef: { type: "model", provider: "fixture", modelId: "fixture" }, replayPosture: "never" });
    effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
      expectedVersion: effect.version, outcome: "completed" });
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }).changed).toBe(true);
    const restarted = createRunService({ repo: f.repo, snapshot: f.snapshot, provider: "fixture", modelId: "fixture" });
    const recovery = createRecoveryCoordinator({ db: f.db, runs: f.repo, effects });
    expect(await recovery.scan()).toMatchObject({ classified: 1, terminal: 0 });
    expect(restarted.status(effect.runId).run.state).toBe("waiting");
    expect(restarted.resumeWork(f.identity())).toEqual({ changed: false, reason: "binding_lost" });
    await expect(restarted.admit(request)).rejects.toThrow("RUN_WORK_CONTINUE_REQUIRED");
    const before = f.events.tail(effect.runId);
    await createRecoveryCoordinator({ db: f.db, runs: f.repo, effects }).scan();
    expect(f.events.tail(effect.runId)).toEqual(before);
  });

  it("does not convert ordinary tasks into accepted work merely by requesting a hold", async () => {
    const f = await fixture({ provenance: { provider: "scheduled-task" }, deliveryClass: "class_a" });
    expect(f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef }))
      .toEqual({ changed: false, reason: "wrong_scope" });
  });

  it("requires the retained source reference to remain equal to the immutable admitted purpose", async () => {
    const f = await fixture();
    f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef });
    f.context.acceptedWork.sourceRef = "unexpected-replacement";
    expect(f.service.resumeWork(f.identity())).toEqual({ changed: false, reason: "wrong_scope" });
    expect(f.repo.status(f.admitted.run.runId).run.state).toBe("waiting");
  });

  it("routes accepted heartbeat-origin work before legacy missing-decision recovery", async () => {
    const f = await fixture({ initiator: "heartbeat" });
    f.service.holdWork({ ...f.identity(), reasonRef: f.sourceRef });
    const effects = createEffectLifecycleService(createEffectRepo(f.db, f.events));
    const result = await createRecoveryCoordinator({ db: f.db, runs: f.repo, effects }).scan();
    expect(result).toMatchObject({ classified: 1, terminal: 0 });
    expect(f.repo.status(f.admitted.run.runId).run.state).toBe("waiting");
  });

  it("does not replay or reconcile unfinished accepted work using newly available recovery adapters", async () => {
    const f = await fixture();
    const effects = createEffectLifecycleService(createEffectRepo(f.db, f.events));
    const effect = effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId,
      kind: "tool", sourceRef: { type: "tool", toolName: "fixture" }, replayPosture: "safe" });
    const replay = vi.fn(async () => ({ classification: "completed" as const }));
    const reconcile = vi.fn(async () => ({ classification: "completed" as const }));
    const result = await createRecoveryCoordinator({ db: f.db, runs: f.repo, effects, adapters: [{
      supports: () => true, replayPosture: () => "safe", replay, reconcile,
    }] }).scan();
    expect(result).toMatchObject({ classified: 1, terminal: 0 });
    expect(replay).not.toHaveBeenCalled(); expect(reconcile).not.toHaveBeenCalled();
    expect(effects.get(effect.effectId)?.state).toBe(effect.state);
    expect(f.repo.status(effect.runId).run.state).toBe("recovering");
  });
});
