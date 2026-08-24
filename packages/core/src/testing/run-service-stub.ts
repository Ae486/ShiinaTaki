/**
 * INPUT:  validated Trigger Requests from focused chat/server tests
 * OUTPUT: in-memory RunService-shaped lifecycle responses without persistence or external effects
 * POS:    core/testing — test-only harness for transport behavior that is independent of SQLite lifecycle semantics
 */
import { randomUUID } from "node:crypto";
import type { Attempt, Run, RunStatusResult, TriggerRequest } from "@taki/shared";
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
    async admit(request: TriggerRequest) {
      const runId = randomUUID();
      const snapshot = { snapshotId: randomUUID(), manifestDigest: DIGEST, schemaVersion: "test.v1" };
      const attempt: Attempt = { attemptId: randomUUID(), runId, ordinal: 1, state: "prepared", stateVersion: 0,
        provider: "test", modelId: "test", snapshot };
      const run: Run = { runId, characterId: request.characterId, triggerRequestId: request.triggerRequestId,
        idempotencyKey: request.idempotencyKey, initiator: request.initiator, provenance: request.provenance,
        deliveryClass: request.deliveryClass, state: "queued", stateVersion: 0, operationPhase: "admitted",
        snapshot, activeAttemptId: attempt.attemptId, queuedAt: AT };
      statuses.set(runId, { run, attempts: [attempt] });
      return { run, attempt, eventTail: { runId: run.runId, seq: 0 }, reused: false };
    },
    start: () => true,
    retry: (runId) => read(runId),
    settle: (runId) => read(runId),
    requestCancel: () => false,
    context: () => undefined,
    status: read,
  };
}
