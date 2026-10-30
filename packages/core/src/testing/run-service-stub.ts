/**
 * INPUT:  validated Trigger Requests from focused chat/server tests
 * OUTPUT: in-memory RunService-shaped lifecycle responses without persistence or external effects
 * POS:    core/testing — test-only harness for transport behavior that is independent of SQLite lifecycle semantics
 */
import { randomUUID } from "node:crypto";
import type { Attempt, Run, RunSnapshot, RunStatusResult, TriggerRequest } from "@taki/shared";
import type { RunService } from "../harness/run-service.ts";

const AT = "2026-08-23T00:00:00.000Z";
const DIGEST = "a".repeat(64);

export function createRunServiceStub(): RunService {
  const statuses = new Map<string, RunStatusResult>();
  const read = (runId: string): RunStatusResult => {
    const status = statuses.get(runId);
    if (!status) throw new Error("RUN_NOT_FOUND");
    return status;
  };
  return {
    admitLinked: () => Promise.reject(new Error("RUN_LINKED_STATE_REQUIRED")),
    admitAcceptedWork: () => Promise.reject(new Error("RUN_WORK_BINDING_REQUIRED")),
    admitPreparedPublication: () => { throw new Error("PREPARED_ROOT_UNAVAILABLE"); },
    holdWork: () => ({ changed: false, reason: "binding_lost" }),
    resumeWork: () => ({ changed: false, reason: "binding_lost" }),
    holdDelivery: () => false,
    resumeDelivery: () => false,
    async admit(request: TriggerRequest) {
      const runId = randomUUID();
      const snapshot = { snapshotId: randomUUID(), manifestDigest: DIGEST, schemaVersion: "slice1.v1" };
      const attempt: Attempt = { attemptId: randomUUID(), runId, ordinal: 1, state: "prepared", stateVersion: 0,
        provider: "test", modelId: "test", snapshot };
      const run: Run = { runId, characterId: request.characterId, triggerRequestId: request.triggerRequestId,
        idempotencyKey: request.idempotencyKey, initiator: request.initiator, provenance: request.provenance,
        deliveryClass: request.deliveryClass, state: "queued", stateVersion: 0, operationPhase: "admitted",
        snapshot, activeAttemptId: attempt.attemptId, queuedAt: AT, budgetUsed: 0 };
      statuses.set(runId, { run, attempts: [attempt] });
      return { run, attempt, snapshot: stubSnapshot(request, runId, snapshot.snapshotId), eventTail: { runId: run.runId, seq: 0 }, reused: false };
    },
    start: () => true,
    retry: (runId) => read(runId),
    settle: (runId) => read(runId),
    requestCancel: () => false,
    context: () => undefined,
    status: read,
    queue: () => ({ entries: [] }),
    seal: () => undefined,
  };
}

function stubSnapshot(request: TriggerRequest, runId: string, snapshotId: string): RunSnapshot {
  return { schemaVersion: "slice1.v1", snapshotId, runId, capturedAt: AT, manifestDigest: DIGEST,
    characterId: request.characterId, initiator: request.initiator, provenance: request.provenance,
    deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test", modelId: "test",
    primaryHostId: "test", hosts: [], extensions: [], extensionSnapshotDigest: DIGEST,
    governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 },
    memory: { providerId: "legacy-markdown", contractVersion: 1, capabilityDigest: DIGEST,
      capabilities: { providerId: "legacy-markdown", contractVersion: 1, retain: true, recall: true, reflect: false,
        edit: false, invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
        sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false } },
    contextDecision: { sourceCategories: [], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" },
    budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "slice1.v1" }, sourceRefs: [] };
}
