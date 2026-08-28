import { afterEach, describe, expect, it } from "vitest";
import type { TriggerRequest } from "@taki/shared";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createEffectLifecycleService } from "./effect-lifecycle-service.ts";
import { createRecoveryCoordinator } from "./recovery-coordinator.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const at = "2026-08-25T00:00:00.000Z";
const memoryCapabilities = { providerId: "legacy", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: false, idempotentWrites: false, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
const request: TriggerRequest = { triggerRequestId: "t", idempotencyKey: "i", characterId: "c", initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" };

function fixture(deadlineAt?: string) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const events = createRunEventRepo(db); const runs = createRunRepo(db, events);
  const effects = createEffectLifecycleService(createEffectRepo(db, events));
  const admitted = runs.admit({ runId: crypto.randomUUID(), request: { ...request, idempotencyKey: crypto.randomUUID(), deadlineAt }, provider: "p", modelId: "m", now: at, snapshot: { schemaVersion: "harness.v1", characterId: "c", initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary", modelProvider: "p", modelId: "m", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "legacy", contractVersion: 1, capabilities: memoryCapabilities, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: { deadlineAt }, implementation: { runtimeVersion: "test", schemaVersion: "harness.v1" }, sourceRefs: [] } });
  return { db, runs, effects, admitted, coordinator: createRecoveryCoordinator({ db, runs, effects }) };
}

describe("RecoveryCoordinator", () => {
  it("keeps queued preparation durable and makes a repeated boot scan idempotent", async () => {
    const f = fixture();
    expect(await f.coordinator.scan({ now: "2026-08-25T00:01:00.000Z" })).toMatchObject({ scanned: 1, classified: 1, terminal: 0 });
    expect(f.runs.status(f.admitted.run.runId).run).toMatchObject({ state: "queued", operationPhase: "admitted" });
    const second = createRecoveryCoordinator({ db: f.db, runs: f.runs, effects: f.effects });
    expect(await second.scan({ now: "2026-08-25T00:02:00.000Z" })).toMatchObject({ scanned: 1, classified: 1 });
    expect(f.db.prepare("SELECT count(*) AS n FROM run_events WHERE kind='recovery.classified'").get()?.n).toBe(1);
    expect(f.db.prepare("SELECT category,source FROM run_events WHERE kind='recovery.classified'").get())
      .toEqual({ category: "recovery", source: "core.recovery-repo" });
  });

  it("settles an expired queued Run before dispatch", async () => {
    const f = fixture("2026-08-25T00:00:30.000Z");
    expect(await f.coordinator.scan({ now: "2026-08-25T00:01:00.000Z" })).toMatchObject({ terminal: 1 });
    expect(f.runs.status(f.admitted.run.runId)).toMatchObject({ run: { state: "deadline_exceeded" }, attempts: [{ state: "deadline_exceeded" }] });
  });

  it("never replays an unfinished unsafe Host effect", async () => {
    const f = fixture(); f.runs.start(f.admitted.run.runId, f.admitted.attempt.attemptId);
    f.effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId, kind: "host", sourceRef: { type: "host", operationId: "op" }, replayPosture: "never" });
    await f.coordinator.scan({ now: "2026-08-25T00:01:00.000Z" });
    expect(f.runs.status(f.admitted.run.runId).run).toMatchObject({ state: "recovering", operationPhase: "recovering" });
    expect(f.effects.unfinished(f.admitted.run.runId)).toHaveLength(1);
  });

  it("replays only when stored and current contracts are both safe and preserves effect identity", async () => {
    const f = fixture(); f.runs.start(f.admitted.run.runId, f.admitted.attempt.attemptId);
    const effect = f.effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId, kind: "tool", sourceRef: { type: "tool", toolName: "files_read" }, replayPosture: "safe", idempotencyKey: "read-1" });
    const calls: string[] = [];
    const coordinator = createRecoveryCoordinator({ db: f.db, runs: f.runs, effects: f.effects, adapters: [{
      supports: (candidate) => candidate.kind === "tool", replayPosture: () => "safe",
      reconcile: async () => ({ classification: "unknown" }), replay: async (candidate) => { calls.push(candidate.effectId); return { classification: "completed", summary: "safe read replayed" }; },
    }] });
    await coordinator.scan({ now: "2026-08-25T00:01:00.000Z" });
    expect(calls).toEqual([effect.effectId]);
    expect(f.effects.get(effect.effectId)).toMatchObject({ state: "terminal", outcome: "completed", idempotencyKey: "read-1" });
    expect(f.runs.status(f.admitted.run.runId).run.state).toBe("completed");
  });

  it("repairs a non-terminal Run from a terminal Effect without dispatch", async () => {
    const f = fixture(); f.runs.start(f.admitted.run.runId, f.admitted.attempt.attemptId);
    const effect = f.effects.prepare({ runId: f.admitted.run.runId, attemptId: f.admitted.attempt.attemptId, kind: "model", sourceRef: { type: "model", provider: "p", modelId: "m" }, replayPosture: "never" });
    f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "completed" });
    await f.coordinator.scan({ now: "2026-08-25T00:01:00.000Z" });
    expect(f.runs.status(f.admitted.run.runId)).toMatchObject({ run: { state: "completed" }, receipt: { summary: "repaired from terminal effect" } });
  });
});
