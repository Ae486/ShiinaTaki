import { afterEach, describe, expect, it } from "vitest";
import type { TriggerRequest } from "@taki/shared";
import { createRunRepo } from "../db/run-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createRunService } from "./run-service.ts";
import type { RunEventRepo } from "../db/run-event-repo.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const request: TriggerRequest = { triggerRequestId: "trigger-1", idempotencyKey: "idem-1", characterId: "taki", initiator: "primary", provenance: { provider: "chat", triggerRequestId: "trigger-1" }, deliveryClass: "class_a", contextMode: "primary" };
const memoryCapabilities = { providerId: "legacy-markdown", contractVersion: 1 as const, retain: true, recall: true,
  reflect: false, edit: false, invalidate: true, restore: false, conditionalMutation: false,
  idempotentWrites: false, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };

function harness() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const context = { instructions: "captured", tools: {} };
  const service = createRunService({
    repo: createRunRepo(db), provider: "test-provider", modelId: "test-model",
    snapshot: { async capture(input) { return { context, snapshot: { schemaVersion: "slice1.v1", characterId: input.characterId, initiator: input.initiator, provenance: input.provenance, deliveryClass: input.deliveryClass, contextMode: input.contextMode, modelProvider: "test-provider", modelId: "test-model", primaryHostId: "core-host", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "legacy-markdown", contractVersion: 1, capabilities: memoryCapabilities, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" }, sourceRefs: [] } }; } },
  });
  return { db, service };
}

describe("RunService", () => {
  it("atomically admits a queued Run, immutable snapshot, and first prepared Attempt, then reuses exact idempotency", async () => {
    const { db, service } = harness();
    const first = await service.admit(request);
    const second = await service.admit(request);
    expect(second).toMatchObject({ reused: true, run: { runId: first.run.runId }, attempt: { attemptId: first.attempt.attemptId } });
    expect(second.eventTail).toEqual({ runId: first.run.runId, seq: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM run_snapshots").get()?.n).toBe(1);
    expect(service.status(first.run.runId)).toMatchObject({ run: { state: "queued", operationPhase: "admitted" }, attempts: [{ state: "prepared", ordinal: 1 }] });
  });

  it("rejects reused idempotency keys with different request hashes", async () => {
    const { service } = harness();
    await service.admit(request);
    await expect(service.admit({ ...request, characterId: "other" })).rejects.toThrow(/RUN_IDEMPOTENCY_CONFLICT/);
  });

  it("refuses expired and exhausted admissions before creating durable rows", async () => {
    const { db, service } = harness();
    await expect(service.admit({ ...request, deadlineAt: "2000-01-01T00:00:00.000Z" })).rejects.toThrow("RUN_DEADLINE_EXCEEDED");
    await expect(service.admit({ ...request, budgetHint: 0 })).rejects.toThrow("RUN_BUDGET_EXHAUSTED");
    expect(db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  });


  it("lists durable queue entries and seals shutdown admission", async () => {
    const { service } = harness();
    const admitted = await service.admit(request);
    expect(service.queue({ characterId: "taki", now: "2026-08-25T00:00:00.000Z" })).toMatchObject({ entries: [{ runId: admitted.run.runId, state: "queued", ageMs: expect.any(Number) }] });
    service.seal();
    await expect(service.admit({ ...request, idempotencyKey: "after-seal" })).rejects.toThrow("RUN_ADMISSION_CLOSED");
  });

  it("owns legal start/terminal settlement, creates a bounded Receipt, and keeps terminal settlement idempotent", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    expect(service.start(run.runId, firstAttemptId(service, run.runId))).toBe(true);
    const completed = service.settle(run.runId, firstAttemptId(service, run.runId), "completed", { retryable: false, summary: "done" });
    expect(completed).toMatchObject({ run: { state: "completed", outcome: "completed" }, attempts: [{ state: "completed" }], receipt: { state: "completed", outcome: "completed", summary: "done" } });
    expect(service.settle(run.runId, firstAttemptId(service, run.runId), "failed").run.state).toBe("completed");
  });

  it("bounds durable attempt and receipt diagnostics before committing them", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const attemptId = firstAttemptId(service, run.runId);
    expect(service.start(run.runId, attemptId)).toBe(true);
    const status = service.settle(run.runId, attemptId, "failed", {
      summary: "s".repeat(2_000),
      errorCode: "e".repeat(200),
    });
    expect(status.run.state).toBe("failed");
    expect(status.attempts[0]?.resultSummary).toHaveLength(1_000);
    expect(status.attempts[0]?.errorCode).toHaveLength(100);
    expect(status.receipt?.summary).toHaveLength(1_000);
  });

  it("normalizes an empty optional error code before committing terminal evidence", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const attemptId = firstAttemptId(service, run.runId);
    expect(service.start(run.runId, attemptId)).toBe(true);
    const status = service.settle(run.runId, attemptId, "failed", { errorCode: "" });
    expect(status.attempts[0]?.errorCode).toBeUndefined();
  });

  it("refuses an Attempt beyond the shared status bound before changing durable state", async () => {
    const { db, service } = harness();
    const { run } = await service.admit(request);
    const attemptId = firstAttemptId(service, run.runId);
    expect(service.start(run.runId, attemptId)).toBe(true);
    db.prepare("UPDATE run_attempts SET ordinal=10000 WHERE attempt_id=:id").run({ id: attemptId });
    expect(() => service.retry(run.runId, attemptId, "overflow")).toThrow(/RUN_ATTEMPT_LIMIT_EXCEEDED/);
    expect(service.status(run.runId)).toMatchObject({
      run: { state: "running", activeAttemptId: attemptId },
      attempts: [{ attemptId, ordinal: 10_000, state: "effect_running" }],
    });
  });

  it("settles a retryable overflow Attempt and starts a second Attempt inside the same Run", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const firstAttempt = service.status(run.runId).attempts[0]!.attemptId;
    expect(service.start(run.runId, firstAttempt)).toBe(true);
    const retried = service.retry(run.runId, firstAttempt, "context_overflow");
    expect(retried.run.runId).toBe(run.runId);
    expect(retried.attempts).toMatchObject([
      { ordinal: 1, state: "failed", retryability: "retryable" },
      { ordinal: 2, state: "effect_running", retryReason: "context_overflow" },
    ]);
    expect(service.settle(run.runId, retried.run.activeAttemptId!, "completed").receipt?.attemptCount).toBe(2);
  });

  it("turns close-before-start into durable cancellation without starting an effect", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const attemptId = service.status(run.runId).attempts[0]!.attemptId;
    expect(service.requestCancel(run.runId, "connection closed")).toBe(true);
    expect(service.requestCancel(run.runId, "duplicate close")).toBe(false);
    expect(service.start(run.runId, attemptId)).toBe(false);
    expect(service.status(run.runId)).toMatchObject({ run: { state: "cancelled" }, attempts: [{ state: "cancelled" }], receipt: { outcome: "cancelled" } });
    expect(service.requestCancel(run.runId, "late close")).toBe(false);
  });

  it("can settle an expired queued Run before any effect starts", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const attemptId = firstAttemptId(service, run.runId);
    expect(service.settle(run.runId, attemptId, "deadline_exceeded", {
      retryable: false,
      summary: "captured deadline elapsed in queue",
    })).toMatchObject({
      run: { state: "deadline_exceeded", outcome: "deadline_exceeded" },
      attempts: [{ state: "deadline_exceeded", outcome: "deadline_exceeded" }],
      receipt: { outcome: "deadline_exceeded" },
    });
  });

  it("ignores stale callbacks and duplicate starts without consuming a newer Attempt", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const firstAttempt = service.status(run.runId).attempts[0]!.attemptId;
    expect(service.start(run.runId, firstAttempt)).toBe(true);
    expect(service.start(run.runId, firstAttempt)).toBe(false);
    const retried = service.retry(run.runId, firstAttempt, "context_overflow");
    const secondAttempt = retried.run.activeAttemptId!;
    expect(service.retry(run.runId, firstAttempt, "late-overflow").run.activeAttemptId).toBe(secondAttempt);
    expect(service.settle(run.runId, firstAttempt, "failed").run.state).toBe("running");
    expect(service.context(run.runId)).toBeDefined();
    expect(service.settle(run.runId, secondAttempt, "completed").run.state).toBe("completed");
  });

  it("keeps the captured context alive when a duplicate start callback is stale", async () => {
    const { service } = harness();
    const { run } = await service.admit(request);
    const attemptId = service.status(run.runId).attempts[0]!.attemptId;
    expect(service.context(run.runId)).toBeDefined();
    expect(service.start(run.runId, attemptId)).toBe(true);
    expect(service.start(run.runId, attemptId)).toBe(false);
    expect(service.context(run.runId)).toBeDefined();
  });

  it("rolls back Run admission when the event ledger rejects the batch", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
    const failingEvents: RunEventRepo = { append: () => { throw new Error("EVENT_WRITE_FAILED"); }, appendMany: () => { throw new Error("EVENT_WRITE_FAILED"); }, list: () => [], tail: (runId) => ({ runId, seq: 0 }) };
    const repo = createRunRepo(db, failingEvents);
    expect(() => repo.admit({ runId: "run-failure", request, snapshot: { schemaVersion: "slice1.v1", characterId: "taki", initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test-provider", modelId: "test-model", primaryHostId: "core-host", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64), governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: { providerId: "legacy-markdown", contractVersion: 1, capabilities: memoryCapabilities, capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" }, sourceRefs: [] }, provider: "test-provider", modelId: "test-model" })).toThrow("EVENT_WRITE_FAILED");
    expect(db.prepare("SELECT count(*) AS count FROM runs").get()?.count).toBe(0);
    expect(db.prepare("SELECT count(*) AS count FROM run_events").get()?.count).toBe(0);
  });
});

function firstAttemptId(service: ReturnType<typeof createRunService>, runId: string): string {
  return service.status(runId).attempts[0]!.attemptId;
}
