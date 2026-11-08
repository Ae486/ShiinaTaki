import { afterEach, describe, expect, it } from "vitest";
import { MemoryActivationStatusSchema, type MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createHindsightActivationHarness, type HindsightActivationHarness } from "./hindsight-activation-fixture.ts";
import { readHindsightActivationStatus } from "./hindsight-activation-status.ts";

const harnesses: HindsightActivationHarness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });
function harness() { const value = createHindsightActivationHarness(); harnesses.push(value); return value; }
const activate = (h: HindsightActivationHarness): MemoryOperationRequest => ({ kind: "hindsight.activate", source: { mode: "new", setupRevision: 2, expectedEpochId: h.local.epochId } });

describe("memory.activation.status read", () => {
  it("passes its schema in every state and derives exactly the admissible action", async () => {
    const h = harness(); const owner = h.owner();
    const idle = owner.status();
    expect(MemoryActivationStatusSchema.parse(idle)).toEqual(idle);
    expect(idle).toMatchObject({ authority: { mode: "canonical-local", epochId: h.local.epochId }, runtime: { available: true, unavailableReason: null },
      setup: { phase: "configured", revision: 2, configured: true }, prerequisites: { blocking: [] }, run: null, operation: null,
      custody: { openGroups: 0, unconsumedWitnesses: 0, pendingSpans: 0 }, actions: { activate: true, resume: false, recoverBinding: false, cancelOperationId: null } });
    expect(idle.prerequisites.banks).toEqual([
      { scope: "global", characterId: null, localBankId: "bank", nativeBankId: h.banks[0]!.nativeBankId, verified: true },
      { scope: "character", characterId: "taki", localBankId: "bank-taki", nativeBankId: h.banks[1]!.nativeBankId, verified: true }]);

    h.db.prepare("UPDATE hindsight_connection_state SET phase='compatible' WHERE singleton=1").run();
    const unconfigured = owner.status();
    expect(MemoryActivationStatusSchema.parse(unconfigured)).toEqual(unconfigured);
    expect(unconfigured).toMatchObject({ setup: { phase: "compatible", configured: false }, actions: { activate: false } });
    h.db.prepare("UPDATE hindsight_connection_state SET phase='configured' WHERE singleton=1").run();
    h.primary();
    expect(owner.status().custody).toMatchObject({ unconsumedWitnesses: 2, pendingSpans: 0 });

    const admitted = owner.service.submit(activate(h));
    const open = owner.status();
    expect(MemoryActivationStatusSchema.parse(open)).toEqual(open);
    expect(open).toMatchObject({ operation: { operationId: admitted.operationId, state: "admitted" },
      actions: { activate: false, resume: false, recoverBinding: false, cancelOperationId: admitted.operationId } });
    owner.service.cancel(admitted.operationId);
    await owner.service.stop();
    expect(owner.status()).toMatchObject({ operation: { state: "cancelled" }, actions: { activate: true, cancelOperationId: null } });
  });

  it("offers resume for an uncommitted run, recoverBinding for a committed-but-unavailable epoch and nothing once bound", async () => {
    const h = harness(); const owner = h.owner();
    h.transport.fail("transfer-post", { response: new Error("offline") });
    const failedAttempt = await owner.settled(activate(h));
    expect(failedAttempt.state).toBe("failed");
    const interrupted = owner.status();
    expect(MemoryActivationStatusSchema.parse(interrupted)).toEqual(interrupted);
    expect(interrupted).toMatchObject({ authority: { mode: "canonical-local" }, run: { runId: "run", phase: "importing", receipt: null, lease: { active: false } },
      operation: { operationId: failedAttempt.operationId }, actions: { activate: false, resume: true, recoverBinding: false } });

    h.binding.publishFails = true;
    const unbound = await owner.settled({ kind: "hindsight.activate", source: { mode: "resume", runId: "run" } });
    expect(unbound).toMatchObject({ state: "failed", result: { outcome: "binding_unavailable" } });
    const unavailable = owner.status();
    expect(MemoryActivationStatusSchema.parse(unavailable)).toEqual(unavailable);
    expect(unavailable).toMatchObject({ authority: { mode: "hindsight" }, runtime: { available: false, unavailableReason: "not_installed" },
      run: { phase: "activated", status: "completed", receipt: { epochId: (unbound.producer as { hindsightEpochId: string }).hindsightEpochId } },
      actions: { activate: false, resume: false, recoverBinding: true } });

    h.binding.publishFails = false;
    await owner.settled({ kind: "hindsight.activate", source: { mode: "recover", epochId: (unbound.producer as { hindsightEpochId: string }).hindsightEpochId } });
    const bound = owner.status();
    expect(MemoryActivationStatusSchema.parse(bound)).toEqual(bound);
    expect(bound).toMatchObject({ runtime: { available: true }, prerequisites: { banks: [], blocking: [] }, actions: { activate: false, resume: false, recoverBinding: false } });
  });

  it("reconciles another boot's open reservation before deriving actions", () => {
    const h = harness();
    const repo = createMemoryOperationRepo(h.db);
    repo.insertAdmitted({ operationId: crypto.randomUUID(), kind: "hindsight.activate", family: "hindsight-activation", request: activate(h),
      producer: { kind: "hindsight", runId: "run", hindsightEpochId: "e", transactionId: "t", configFingerprint: "a".repeat(64), manifestId: null,
        progress: { phase: "reserved", bankCount: 0, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0 }, banks: [] },
      bootId: "boot-old", authorityEpochId: null });
    const status = h.owner("boot-b").status();
    expect(MemoryActivationStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({ run: null, operation: { state: "outcome_unknown", reason: "producer_incomplete" }, actions: { activate: true, resume: false, cancelOperationId: null } });
  });

  it("offers installed-runtime recovery only for the matching committed attempt with incomplete preparation", async () => {
    const h = harness(); const owner = h.owner();
    h.binding.runtime.prepareHindsightActivation = async () => { throw new Error("HINDSIGHT_TIMEOUT"); };
    const failed = await owner.settled(activate(h));
    expect(failed).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_TIMEOUT", producer: { progress: { phase: "binding" } } });
    expect(owner.status()).toMatchObject({ runtime: { available: true }, actions: { recoverBinding: true } });
    if (failed.producer?.kind !== "hindsight") throw new Error("fixture producer missing");
    const foreign = { ...failed, producer: { ...failed.producer, transactionId: "another-transaction" } };
    expect(readHindsightActivationStatus({ service: h.service, operations: { latest: () => foreign } }).actions.recoverBinding).toBe(false);
    const completed = { ...failed, producer: { ...failed.producer, progress: { ...failed.producer.progress, phase: "completed" as const } } };
    expect(readHindsightActivationStatus({ service: h.service, operations: { latest: () => completed } }).actions.recoverBinding).toBe(false);
  });
});
