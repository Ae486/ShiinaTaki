import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { createRecoveryCoordinator } from "./recovery-coordinator.ts";

describe("linked delegation restart classification", () => {
  it.each(["completed_model", "unknown_host"] as const)("retains %s evidence without inferring child success or replaying an Effect", async (kind) => {
    const model = streamingMockModel(["must never run"]); const f = await subagentFixture(model);
    try {
      const child = f.children.create({ characterId: "taki", createdByRunId: f.parent.run.runId, label: "Interrupted", initialContext: { kind: "fresh" } });
      const input = f.inputs.accept({ subagentId: child.subagentId, operationKey: "original", sender: { kind: "parent", runId: f.parent.run.runId },
        direction: "Interrupted work", materials: [], input: { kind: "work", completionPolicy: "request_parent", lifetimeMinutes: 30 } }).input;
      const run = await f.runs.admitLinked({ triggerRequestId: randomUUID(), idempotencyKey: randomUUID(), characterId: "taki",
        initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: "core.subagent", parentRunId: f.parent.run.runId },
        payloadRef: input.inputId, deadlineAt: input.workExpiresAt ?? undefined }, { linked: { kind: "subagent", triggerInputId: input.inputId,
        token: { subagentId: child.subagentId, workInputId: input.inputId, throughWorkSeq: 1, controlVersion: 0 }, validateTx() {} } });
      f.runs.start(run.run.runId, run.attempt.attemptId);
      const effect = f.effects.prepare({ runId: run.run.runId, attemptId: run.attempt.attemptId, replayPosture: "never",
        ...(kind === "completed_model" ? { kind: "model" as const, sourceRef: { type: "model" as const, provider: "fixture", modelId: "fixture" } }
          : { kind: "host" as const, sourceRef: { type: "host" as const, operationId: "dispatched-operation" } }) });
      if (kind === "completed_model") f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId,
        expectedVersion: effect.version, outcome: "completed" });
      await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
      const expected = kind === "completed_model" ? "cancelled" : "outcome_unknown";
      expect(f.executions.result(run.run.runId)?.child).toMatchObject({ outcome: expected, outputKind: "none", body: null });
      expect(f.children.get(child.subagentId).activeRunId).toBeNull();
      expect(f.effects.get(effect.effectId)?.outcome).toBe(kind === "completed_model" ? "completed" : "outcome_unknown");
      expect(model.doStreamCalls).toEqual([]);
      if (kind === "unknown_host") expect(() => f.service.continue({ characterId: "taki", target: { subagentId: child.subagentId,
        workInputId: input.inputId, expectedRunId: null, expectedControlVersion: f.children.get(child.subagentId).controlVersion },
      operationKey: "explicit", direction: "Continue", materials: [] }, { kind: "user" })).toThrow("RECONCILIATION");
      await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
      expect(f.executions.list({ subagentId: child.subagentId })).toHaveLength(1);
    } finally { await f.close(); }
  });
});
