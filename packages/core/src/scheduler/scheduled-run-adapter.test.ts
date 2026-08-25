import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createRunService } from "../harness/run-service.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createScheduledRunAdapter } from "./scheduled-run-adapter.ts";

const dbs: Database[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
describe("ScheduledRunAdapter", () => {
  it("admits the frozen trigger and executes a non-primary turn once", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const repo = createScheduledTaskRepo(db);
    const task = repo.create({ characterId: "taki", name: "Run", controlInput: "bounded control", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" }, nextRunAt: "2026-08-25T00:00:00.000Z" });
    const occurrence = repo.claimOccurrence({ taskId: task.taskId, characterId: task.characterId, scheduledFor: task.nextRunAt!, taskRevision: 1, controlInput: task.controlInput, firedAt: task.nextRunAt!, late: false })!;
    const runs = createRunService({ repo: createRunRepo(db), provider: "test", modelId: "test", snapshot: { async capture(request) { return { context: {}, snapshot: { schemaVersion: "test.v1", characterId: request.characterId, initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test", modelId: "test", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 2, approvalGeneration: 1 }, memory: { providerId: "local", contractVersion: 1, capabilities: caps, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "test.v1" }, sourceRefs: [] } }; } } });
    const stream = vi.fn(async function* (_params, turn) { expect(turn).toMatchObject({ turnKind: "non-primary", controlInput: "bounded control" }); yield "done"; });
    const adapter = createScheduledRunAdapter({ repo, runs, agent: { stream }, queue: createTurnQueue(), turns: createTurnRegistry(), logger: { warn: vi.fn() } as never });
    const runId = await adapter.dispatch(task.taskId, occurrence); expect(runs.status(runId).run).toMatchObject({ initiator: "scheduled", state: "completed", provenance: { provider: "scheduled-task", taskId: task.taskId } }); expect(stream).toHaveBeenCalledOnce(); expect(db.prepare("SELECT state,control_input FROM schedule_occurrences").get()).toEqual({ state: "terminal", control_input: null });
  });

  it("uses the occurrence Character snapshot after the task is edited", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const repo = createScheduledTaskRepo(db);
    const task = repo.create({ characterId: "old-character", name: "Run", controlInput: "bounded control", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" }, nextRunAt: "2026-08-25T00:00:00.000Z" });
    const occurrence = repo.claimOccurrence({ taskId: task.taskId, characterId: task.characterId, scheduledFor: task.nextRunAt!, taskRevision: task.revision, controlInput: task.controlInput, firedAt: task.nextRunAt!, late: false })!;
    repo.update({ taskId: task.taskId, expectedRevision: task.revision, characterId: "new-character", name: task.name, controlInput: task.controlInput, pattern: task.pattern, timezone: task.timezone });
    const runs = createRunService({ repo: createRunRepo(db), provider: "test", modelId: "test", snapshot: { async capture(request) { return { context: {}, snapshot: { schemaVersion: "test.v1", characterId: request.characterId, initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test", modelId: "test", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 2, approvalGeneration: 1 }, memory: { providerId: "local", contractVersion: 1, capabilities: caps, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "test.v1" }, sourceRefs: [] } }; } } });
    const stream = vi.fn(async function* (params) { expect(params.characterId).toBe("old-character"); yield "done"; });
    const adapter = createScheduledRunAdapter({ repo, runs, agent: { stream }, queue: createTurnQueue(), turns: createTurnRegistry(), logger: { warn: vi.fn() } as never });
    await adapter.dispatch(task.taskId, occurrence); expect(stream).toHaveBeenCalledOnce();
  });

  it("reuses an already-running Run without invoking a second Agent loop", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const repo = createScheduledTaskRepo(db);
    const task = repo.create({ characterId: "taki", name: "Run", controlInput: "bounded control", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" }, nextRunAt: "2026-08-25T00:00:00.000Z" });
    const occurrence = repo.claimOccurrence({ taskId: task.taskId, characterId: task.characterId, scheduledFor: task.nextRunAt!, taskRevision: task.revision, controlInput: task.controlInput, firedAt: task.nextRunAt!, late: false })!;
    const runs = createRunService({ repo: createRunRepo(db), provider: "test", modelId: "test", snapshot: { async capture(request) { return { context: {}, snapshot: { schemaVersion: "test.v1", characterId: request.characterId, initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test", modelId: "test", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 2, approvalGeneration: 1 }, memory: { providerId: "local", contractVersion: 1, capabilities: caps, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: [], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "test.v1" }, sourceRefs: [] } }; } } });
    const requestId = `scheduled:${createHash("sha256").update(`${task.taskId}\n${occurrence.scheduledFor}`).digest("hex")}`;
    const admitted = await runs.admit({ triggerRequestId: requestId, idempotencyKey: requestId, characterId: task.characterId, initiator: "scheduled", provenance: { provider: "scheduled-task", taskId: task.taskId }, deliveryClass: "class_a", contextMode: "autonomous" });
    expect(runs.start(admitted.run.runId, admitted.attempt.attemptId)).toBe(true); repo.linkOccurrence({ taskId: task.taskId, scheduledFor: occurrence.scheduledFor, runId: admitted.run.runId });
    const stream = vi.fn(async function* () { yield "duplicate"; });
    const adapter = createScheduledRunAdapter({ repo, runs, agent: { stream }, queue: createTurnQueue(), turns: createTurnRegistry(), logger: { warn: vi.fn() } as never });
    await adapter.dispatch(task.taskId, repo.unsettled()[0]!); expect(stream).not.toHaveBeenCalled();
  });
});
