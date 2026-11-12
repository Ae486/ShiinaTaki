import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { retainNewLocalSource } from "../../db/hindsight-local-coverage-fixtures.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { preparationVerificationId } from "../hindsight-activation/hindsight-activation-chain.ts";
import { createHindsightActivationHarness, recordedVerifications, type HindsightActivationHarness, type HindsightActivationOwner } from "../hindsight-activation/hindsight-activation-fixture.ts";
import { MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationExecution } from "./memory-operation-contract.ts";
import { hindsightActivateKind } from "./memory-operation-kind-hindsight.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";

const harnesses: HindsightActivationHarness[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const harness of harnesses.splice(0)) await harness.close(); });
function harness(...args: Parameters<typeof createHindsightActivationHarness>) { const value = createHindsightActivationHarness(...args); harnesses.push(value); return value; }

type HindsightRef = Extract<MemoryOperation["producer"], { kind: "hindsight" }>;
const activate = (h: HindsightActivationHarness, setupRevision = 2): MemoryOperationRequest =>
  ({ kind: "hindsight.activate", source: { mode: "new", setupRevision, expectedEpochId: h.local.epochId } });
const resume = (): MemoryOperationRequest => ({ kind: "hindsight.activate", source: { mode: "resume", runId: "run" } });
const recover = (epochId: string): MemoryOperationRequest => ({ kind: "hindsight.activate", source: { mode: "recover", epochId } });
const refusal = (owner: HindsightActivationOwner, request: MemoryOperationRequest) => {
  try { owner.service.submit(request); } catch (error) { if (error instanceof MemoryOperationRefusal) return { reason: error.reason, activeOperationId: error.activeOperationId }; throw error; }
  throw new Error("expected a refusal");
};

/** A row another boot left open, exactly as the durable table would hold it after a crash. */
function foreignRow(h: HindsightActivationHarness, input: { request: MemoryOperationRequest; producer: HindsightRef; running?: boolean }): string {
  const repo = createMemoryOperationRepo(h.db);
  const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: "hindsight.activate", family: "hindsight-activation", request: input.request, producer: input.producer, bootId: "boot-old", authorityEpochId: null });
  if (input.running) repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

async function activated(h: HindsightActivationHarness, owner: HindsightActivationOwner) {
  const operation = await owner.settled(activate(h));
  expect(operation).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true } });
  return operation.producer as HindsightRef;
}

describe("hindsight.activate — admission", () => {
  it("mints every identity in Core, runs the chain once, persists checkpoints and settles from the receipt and binding", async () => {
    const h = harness(); const owner = h.owner();
    const admitted = owner.service.submit(activate(h));
    const producer = admitted.producer as HindsightRef;
    expect(producer).toMatchObject({ kind: "hindsight", runId: "run", progress: { phase: "reserved", bankCount: 2 } });
    expect(producer.banks.map((bank) => bank.nativeBankId).sort()).toEqual(h.banks.map((bank) => bank.nativeBankId).sort());
    expect(refusal(owner, activate(h))).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: admitted.operationId });
    await owner.service.stop();
    const operation = owner.service.status(admitted.operationId);
    expect(operation).toMatchObject({ state: "completed", result: { kind: "hindsight", runId: "run", outcome: "activated", epochId: producer.hindsightEpochId, blocking: [] },
      producer: { hindsightEpochId: producer.hindsightEpochId, transactionId: producer.transactionId, progress: { phase: "completed", verifiedBankCount: 2, carriedWitnessCount: 0 } } });
    expect(owner.changes.map((change) => change.state).filter((state, index, all) => all.indexOf(state) === index)).toEqual(["admitted", "running", "completed"]);
    expect(readMemoryAuthoritySelection(h.db)).toMatchObject({ mode: "hindsight", epochId: producer.hindsightEpochId, transactionId: producer.transactionId });
    expect(h.binding.binds).toEqual([producer.hindsightEpochId]);
    expect(owner.status()).toMatchObject({ authority: { mode: "hindsight" }, runtime: { available: true }, actions: { activate: false, resume: false, recoverBinding: false } });
  });

  it("refuses the wrong marker, a stale client view, a drifted or unconfigured setup and recover without a matching receipt", async () => {
    const h = harness(); const owner = h.owner();
    expect(refusal(owner, { kind: "hindsight.activate", source: { mode: "new", setupRevision: 2, expectedEpochId: "other" } }).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(refusal(owner, activate(h, 3)).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(refusal(owner, resume()).reason).toBe("MEMORY_OPERATION_NOT_FOUND");
    expect(refusal(owner, recover("hindsight-epoch")).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    h.binding.fingerprint = "b".repeat(64);
    expect(refusal(owner, activate(h)).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(owner.status().actions.activate).toBe(false);
    h.binding.fingerprint = "a".repeat(64);
    h.db.prepare("UPDATE hindsight_connection_state SET phase='failed' WHERE singleton=1").run();
    expect(refusal(owner, activate(h)).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(owner.status()).toMatchObject({ setup: { configured: false }, actions: { activate: false } });
    h.db.prepare("UPDATE hindsight_connection_state SET phase='configured' WHERE singleton=1").run();
    expect(owner.status().actions.activate).toBe(true);
    expect(h.transport.calls("snapshot-create")).toBe(0);
    await activated(h, owner);
    expect(refusal(owner, activate(h)).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(refusal(owner, resume()).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
    expect(refusal(owner, recover("other-epoch")).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
  });

  it("reports missing verified Bank scopes as a completed blocked activation without any native call", async () => {
    const h = harness(); const owner = h.owner();
    h.db.prepare("UPDATE hindsight_bank_setup SET status='pending' WHERE canonical_identity='character:taki'").run();
    expect(owner.status()).toMatchObject({ prerequisites: { blocking: [{ scope: "character", characterId: "taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" }] }, actions: { activate: false } });
    const blocked = await owner.settled(activate(h));
    expect(blocked).toMatchObject({ state: "completed", result: { outcome: "prerequisite_blocked", epochId: null, runtimeAvailable: false,
      blocking: [{ scope: "character", characterId: "taki", localBankId: "bank-taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" }] } });
    expect((blocked.producer as HindsightRef).banks).toHaveLength(1);
    expect(h.transport.calls("snapshot-create")).toBe(0); expect(h.transport.calls("transfer-post")).toBe(0);
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("canonical-local"); expect(h.subsystem.fence.writable()).toBe(true);
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_cutover_runs").get()?.n).toBe(0);
  });

  it("is mutually single-flight with the setup and local-onboarding families and blocks direct setup RPCs while open", async () => {
    const h = harness(); const owner = h.owner();
    const repo = createMemoryOperationRepo(h.db);
    const setupRow = crypto.randomUUID();
    repo.insertAdmitted({ operationId: setupRow, kind: "setup.validate", family: "setup", request: { kind: "setup.validate", expectedRevision: 2 },
      producer: { kind: "setup", attemptId: null, revisionBefore: 2, revisionAfter: null }, bootId: "boot-a", authorityEpochId: null });
    expect(refusal(owner, activate(h))).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: setupRow });
    repo.transition({ operationId: setupRow, expectedState: "admitted", patch: { state: "cancelled", reason: "cancelled_before_claim" } });
    const admitted = owner.service.submit(activate(h));
    expect(refusal(owner, { kind: "setup.validate", expectedRevision: 2 })).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: admitted.operationId });
    expect(refusal(owner, { kind: "setup.apply", expectedRevision: 2, characterId: "taki" }).reason).toBe("MEMORY_OPERATION_BUSY");
    await owner.service.stop();
    expect(owner.service.status(admitted.operationId).state).toBe("completed");
  });
});

describe("hindsight.activate — claim, cancel and boot observation", () => {
  it("cancels only before the claim and never starts the producer on a lost claim or a stopping service", async () => {
    const h = harness(); const owner = h.owner();
    const admitted = owner.service.submit(activate(h));
    expect(owner.service.cancel(admitted.operationId)).toMatchObject({ state: "cancelled", reason: "cancelled_before_claim" });
    await owner.service.stop();
    expect(h.transport.calls("snapshot-create")).toBe(0); expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_cutover_runs").get()?.n).toBe(0);
    let release = (): void => undefined; let gated = false;
    h.transport.before(({ route }) => { if (route === "snapshot-create" && !gated) { gated = true; return new Promise<void>((done) => { release = done; }); } return undefined; });
    const running = owner.service.submit(activate(h));
    await vi.waitFor(() => { expect(gated).toBe(true); });
    expect(() => owner.service.cancel(running.operationId)).toThrow("MEMORY_OPERATION_RUNNING");
    release();
    await owner.service.stop();
    expect(() => owner.service.cancel(running.operationId)).toThrow("MEMORY_OPERATION_SETTLED");
    const ctx: MemoryOperationContext = { live: () => null, setup: fakeSetup(), hindsight: { ...h.service, stopRequested: () => true }, lookup: () => undefined,
      activeInFamily: () => undefined, latestInFamily: () => undefined, now: () => "2026-09-23T00:00:00.000Z" };
    const execution: MemoryOperationExecution<Extract<MemoryOperationRequest, { kind: "hindsight.activate" }>> = {
      operationId: crypto.randomUUID(), request: activate(h) as Extract<MemoryOperationRequest, { kind: "hindsight.activate" }>, ctx,
      producer: running.producer!, running: () => undefined, tryClaim: () => true, checkpoint: vi.fn(),
      updateProducer: () => { throw new Error("Unexpected activation producer update; use checkpoint"); } };
    expect(await hindsightActivateKind.execute(execution)).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "HINDSIGHT_ACTIVATION_INTERRUPTED" });
    expect(await hindsightActivateKind.execute({ ...execution, ctx: { ...ctx, hindsight: h.service }, tryClaim: () => false })).toBeNull();
  });

  it("classifies foreign rows at boot: committed from the receipt, incomplete under Local, unknown on a mismatch or unreadable marker", async () => {
    const h = harness(); const owner = h.owner();
    const request = activate(h);
    const reserved = owner.service.submit(request).producer as HindsightRef;
    await owner.service.stop();
    const producer = { ...reserved, progress: { ...reserved.progress, phase: "importing" as const } };
    const committed = foreignRow(h, { request, producer, running: true });
    const boot = h.owner("boot-b");
    expect(boot.service.status(committed)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", result: null, producer: { progress: { phase: "binding" } } });
    expect(boot.status().actions.recoverBinding).toBe(true);
    const mismatched = foreignRow(h, { request, producer: { ...producer, transactionId: "22222222-2222-4222-8222-222222222222" }, running: true });
    expect(h.owner("boot-c").service.status(mismatched)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    h.binding.state = { kind: "unavailable", epochId: producer.hindsightEpochId, code: "MEMORY_HINDSIGHT_BINDING_FAILED" };
    const unavailable = foreignRow(h, { request, producer, running: true });
    const bootD = h.owner("boot-d");
    expect(bootD.service.status(unavailable)).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_RUNTIME_UNAVAILABLE", result: { outcome: "binding_unavailable" } });
    expect(bootD.status()).toMatchObject({ runtime: { available: false, unavailableReason: "not_installed" }, actions: { recoverBinding: true } });
    h.db.prepare("UPDATE memory_authority_selection SET activation_transaction_id='corrupt' WHERE singleton=1").run();
    const corrupt = foreignRow(h, { request, producer, running: true });
    expect(h.owner("boot-e").service.status(corrupt)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    expect(h.transport.calls("transfer-post")).toBe(2);
  });

  it("marks an interrupted pre-COMMIT attempt incomplete with the durable phase and lets resume finish without a second POST", async () => {
    const h = harness(); const owner = h.owner();
    h.transport.fail("verification-verify", { response: new Error("lost reply"), afterEffect: true });
    const request = activate(h);
    const failedAttempt = await owner.settled(request);
    expect(failedAttempt).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_UNREACHABLE" });
    expect(readMemoryAuthoritySelection(h.db).mode).toBe("canonical-local"); expect(h.subsystem.fence.writable()).toBe(true);
    const interrupted = foreignRow(h, { request, producer: failedAttempt.producer as HindsightRef, running: true });
    const boot = h.owner("boot-b");
    expect(boot.service.status(interrupted)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", producer: { progress: { phase: "verifying" } } });
    expect(boot.status()).toMatchObject({ run: { phase: "importing", receipt: null }, actions: { activate: false, resume: true } });
    expect(h.transport.calls("transfer-post")).toBe(1);
    const resumed = await boot.settled(resume());
    expect(resumed).toMatchObject({ state: "completed", result: { outcome: "activated" },
      producer: { hindsightEpochId: (failedAttempt.producer as HindsightRef).hindsightEpochId, transactionId: (failedAttempt.producer as HindsightRef).transactionId } });
    expect((resumed.producer as HindsightRef).banks.map((bank) => bank.verificationId)).toEqual((failedAttempt.producer as HindsightRef).banks.map((bank) => bank.verificationId));
    expect(h.transport.calls("transfer-post")).toBe(2);
    expect(boot.service.status(interrupted).state).toBe("outcome_unknown");
  });
});

describe("hindsight.activate — recaptured verification ids", () => {
  it("resumes a recaptured run after a restart mid-verify with the per-preparation ids the interrupted attempt posted", async () => {
    const h = harness(); const owner = h.owner(); let written = false;
    h.transport.before(({ route }) => { if (route === "verification-verify" && !written) { written = true; retainNewLocalSource(h.db, h.local); } });
    const stale = await owner.settled(activate(h));
    expect(stale).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_LOCAL_COVERAGE_STALE" });
    h.transport.fail("verification-verify", { response: new Error("lost reply"), afterEffect: true });
    const interrupted = await owner.settled(resume());
    expect(interrupted).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE" });
    const posted = recordedVerifications(h.db);

    const resumed = await h.owner("boot-b").settled(resume());
    expect(resumed).toMatchObject({ state: "completed", result: { outcome: "activated" } });
    const ids = (operation: MemoryOperation) => (operation.producer as HindsightRef).banks.map((bank) => bank.verificationId);
    expect(ids(interrupted)).toEqual(ids(stale)); expect(ids(resumed)).toEqual(ids(stale));
    const all = recordedVerifications(h.db);
    expect(all.slice(0, posted.length)).toEqual(posted);
    const base = new Map((stale.producer as HindsightRef).banks.map((bank) => [bank.nativeBankId, bank.verificationId]));
    expect(all.map((row) => row.verificationId)).toEqual(all.map((row) => preparationVerificationId(base.get(row.bankId)!, row.preparationId)));
    expect(new Set(all.map((row) => row.verificationId)).size).toBe(all.length);
  });
});

describe("hindsight.activate — binding repair", () => {
  it("settles a post-COMMIT bind failure as runtime_unavailable, repairs through recover without re-promoting and keeps history immutable", async () => {
    const h = harness(); const owner = h.owner();
    h.binding.publishFails = true;
    const first = await owner.settled(activate(h));
    expect(first).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "HINDSIGHT_ACTIVATION_INTERNAL_ERROR",
      result: { outcome: "binding_unavailable", runtimeAvailable: false }, producer: { progress: { phase: "binding" } } });
    const epochId = (first.producer as HindsightRef).hindsightEpochId;
    expect(readMemoryAuthoritySelection(h.db)).toMatchObject({ mode: "hindsight", epochId });
    expect(h.subsystem.fence.writable()).toBe(false);
    expect(owner.status()).toMatchObject({ runtime: { available: false, unavailableReason: "not_installed" }, run: { receipt: { epochId } },
      actions: { recoverBinding: true, activate: false, resume: false } });
    h.binding.publishFails = false; h.binding.recoverable = 1;
    const repaired = await owner.settled(recover(epochId));
    expect(repaired).toMatchObject({ state: "completed", result: { outcome: "activated", epochId }, producer: { transactionId: (first.producer as HindsightRef).transactionId } });
    expect(h.binding.recovers).toEqual([epochId]); expect(h.binding.binds).toEqual([epochId]);
    expect(owner.service.status(first.operationId)).toEqual(first);
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(h.transport.calls("transfer-post")).toBe(2);
    expect(owner.status()).toMatchObject({ runtime: { available: true }, actions: { recoverBinding: false } });
    const healthy = await owner.settled(recover(epochId));
    expect(healthy).toMatchObject({ state: "completed", result: { outcome: "activated" } });
    expect(h.binding.recovers).toEqual([epochId, epochId]);
  });

  it("settles a refused repair as failed with its closed code instead of completing over a swallowed fault", async () => {
    const h = harness(); const owner = h.owner();
    const producer = await activated(h, owner);
    const recovery = h.binding.runtime.recoverHindsightBinding;
    h.binding.runtime.recoverHindsightBinding = () => { throw new Error("MEMORY_INGESTION_INCOMPLETE"); };
    const refused = await owner.settled(recover(producer.hindsightEpochId));
    expect(refused).toMatchObject({ state: "failed", reason: "producer_incomplete", errorCode: "MEMORY_INGESTION_INCOMPLETE", result: null,
      producer: { progress: { phase: "binding" } } });
    h.binding.runtime.recoverHindsightBinding = recovery;
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
  });

  it("rebuilds the committed identity from receipts when no operation row carries it", async () => {
    const h = harness();
    const receipt = await h.service.start(h.identity(), h.control());
    const owner = h.owner("boot-b");
    const repaired = await owner.settled(recover(receipt.hindsightEpochId));
    expect(repaired).toMatchObject({ state: "completed", result: { outcome: "activated", epochId: "hindsight-epoch" },
      producer: { runId: "run", transactionId: "hindsight-tx", progress: { phase: "completed", bankCount: 2 } } });
    // Receipts only hold the native per-preparation id; the minted base lives in operation rows, which this path lacks.
    const rebuilt = (repaired.producer as HindsightRef).banks;
    expect(rebuilt.map((bank) => bank.verificationId)).toEqual(rebuilt.map((bank) =>
      preparationVerificationId(h.identity().banks.find((minted) => minted.nativeBankId === bank.nativeBankId)!.verificationId, bank.preparationId!)));
  });

  it("does not complete when preparation finished but the completed checkpoint could not be persisted", async () => {
    const h = harness();
    const request: Extract<MemoryOperationRequest, { kind: "hindsight.activate" }> = {
      kind: "hindsight.activate", source: { mode: "new", setupRevision: 2, expectedEpochId: h.local.epochId },
    };
    const ctx: MemoryOperationContext = { live: () => null, setup: fakeSetup(), hindsight: h.service, lookup: () => undefined,
      activeInFamily: () => undefined, latestInFamily: () => undefined, now: () => "2026-09-23T00:00:00.000Z" };
    const producer = hindsightActivateKind.admit(request, ctx, { origin: "operator" });
    const checkpoints: HindsightRef[] = [];
    const preparation = vi.spyOn(h.binding.runtime, "prepareHindsightActivation");
    const settlement = await hindsightActivateKind.execute({ operationId: crypto.randomUUID(), request, producer, ctx,
      running: () => undefined, tryClaim: () => true,
      updateProducer: () => { throw new Error("Unexpected activation producer update; use checkpoint"); },
      checkpoint: (ref) => {
        if (ref?.kind !== "hindsight") throw new Error("fixture producer missing");
        if (ref.progress.phase === "completed") throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
        checkpoints.push(ref);
      } });
    expect(preparation).toHaveBeenCalledTimes(1);
    expect(checkpoints.at(-1)?.progress.phase).toBe("binding");
    expect(settlement).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_ACTIVATION_INTERRUPTED", result: null,
      producer: { progress: { phase: "binding" } } });
    expect(h.service.runtime().available).toBe(true);
    expect(h.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(h.transport.calls("transfer-post")).toBe(2);
  });
});
