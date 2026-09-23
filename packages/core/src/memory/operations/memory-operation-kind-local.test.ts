import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { cleanupLegacyMigrationFixtures, legacyEntry, PROFILE_ENTRY } from "../legacy-migration/legacy-migration-fixture.ts";
import { createLocalOnboardingHarness, type LocalOnboardingHarness, type OnboardingOwner } from "../local-onboarding/local-onboarding-fixture.ts";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import type { MemoryOperationContext, MemoryOperationExecution } from "./memory-operation-contract.ts";
import { localActivateKind } from "./memory-operation-kind-local.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";

afterEach(cleanupLegacyMigrationFixtures);

const entries = { [PROFILE_ENTRY]: legacyEntry("supported") };
const activate = (runId: string): MemoryOperationRequest => ({ kind: "local.onboard.activate", runId });

async function settled(owner: OnboardingOwner, request: MemoryOperationRequest): Promise<MemoryOperation> {
  const admitted = owner.service.submit(request);
  await owner.service.stop();
  return owner.service.status(admitted.operationId);
}

async function prepared(h: LocalOnboardingHarness, owner: OnboardingOwner) {
  const preview = await h.local.preview();
  const operation = await settled(owner, { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } });
  expect(operation).toMatchObject({ state: "completed", result: { outcome: "ready" } });
  return { preview, runId: (operation.producer as { runId: string }).runId };
}

/** A row another boot left open, exactly as the durable table would hold it after a crash. */
function foreignRow(h: LocalOnboardingHarness, input: { request: MemoryOperationRequest; producer: Extract<MemoryOperation["producer"], { kind: "local" }>; running?: boolean }): string {
  const repo = createMemoryOperationRepo(h.f.db, () => h.f.clock.now);
  const operationId = crypto.randomUUID();
  repo.insertAdmitted({ operationId, kind: input.request.kind, family: "local-onboarding", request: input.request, producer: input.producer, bootId: "boot-old", authorityEpochId: null });
  if (input.running) repo.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
  return operationId;
}

const reserved = { phase: "reserved" as const, sourceCount: null, resolvedCount: null, blockingCount: null };

describe("local kinds — boot observation and retry", () => {
  it("marks an unpublished reservation unknown, offers retry, and retry materializes the same reserved run", async () => {
    const h = createLocalOnboardingHarness({ entries });
    const preview = await h.local.preview();
    const runId = crypto.randomUUID();
    const interrupted = foreignRow(h, { request: { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } },
      producer: { kind: "local", runId, previewId: preview.reportId, snapshotId: null, activationTransactionId: null, progress: reserved } });
    const owner = h.owner("boot-b");
    expect(owner.service.status(interrupted)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", producer: { runId } });
    expect(owner.changes.map((change) => change.state)).toEqual(["outcome_unknown"]);
    expect(owner.status().actions).toMatchObject({ retryOperationId: interrupted, prepare: true });
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_runs").get()?.n).toBe(0);

    const retried = await settled(owner, { kind: "local.onboard.prepare", source: { mode: "retry", operationId: interrupted } });
    expect(retried).toMatchObject({ state: "completed", result: { outcome: "ready", runId }, producer: { runId, previewId: preview.reportId } });
    expect(owner.status()).toMatchObject({ run: { runId, status: "ready" }, actions: { retryOperationId: null, activate: true } });
    expect(owner.service.status(interrupted).state).toBe("outcome_unknown");
    // A second retry of the same command finishes the now-published run instead of creating another candidate.
    const again = await settled(owner, { kind: "local.onboard.prepare", source: { mode: "retry", operationId: interrupted } });
    expect(again).toMatchObject({ state: "completed", result: { outcome: "ready", runId } });
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_runs").get()?.n).toBe(1);
  });

  it("reconstructs a prepared run as completed and an incomplete run as unknown without dispatching work", async () => {
    const h = createLocalOnboardingHarness({ entries });
    const { preview, runId } = await prepared(h, h.owner());
    const request: MemoryOperationRequest = { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } };
    const ready = foreignRow(h, { request, producer: { kind: "local", runId, previewId: preview.reportId, snapshotId: null, activationTransactionId: null, progress: reserved }, running: true });
    const first = h.owner("boot-b");
    expect(first.service.status(ready)).toMatchObject({ state: "completed", result: { outcome: "ready", runId }, producer: { progress: { phase: "ready", sourceCount: 1 } } });
    h.f.db.prepare("UPDATE memory_migration_runs SET status='running',phase='staged' WHERE run_id=:run").run({ run: runId });
    const incomplete = foreignRow(h, { request, producer: { kind: "local", runId, previewId: preview.reportId, snapshotId: null, activationTransactionId: null, progress: reserved }, running: true });
    const second = h.owner("boot-c");
    expect(second.service.status(incomplete)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", producer: { snapshotId: expect.stringMatching(/^sha256:/) } });
    expect(second.status().actions).toMatchObject({ retryOperationId: null, resume: true });
  });

  it("classifies activation rows from the receipt: committed, committed-but-unavailable, mismatched, or never committed", async () => {
    const h = createLocalOnboardingHarness({ entries });
    const owner = h.owner();
    const { runId } = await prepared(h, owner);
    const noReceipt = foreignRow(h, { request: activate(runId), producer: { kind: "local", runId, previewId: null, snapshotId: "s", activationTransactionId: "tx-never", progress: reserved }, running: true });
    expect(h.owner("boot-b").service.status(noReceipt)).toMatchObject({ state: "failed", reason: "producer_incomplete", errorCode: "MIGRATION_INTERRUPTED" });

    const activated = await settled(owner, activate(runId));
    const transactionId = (activated.producer as { activationTransactionId: string }).activationTransactionId;
    const producer = { kind: "local" as const, runId, previewId: null, snapshotId: "s", activationTransactionId: transactionId, progress: reserved };
    const committed = foreignRow(h, { request: activate(runId), producer, running: true });
    expect(h.owner("boot-c").service.status(committed)).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true } });

    h.binding.state = { kind: "unavailable", epochId: h.binding.state.kind === "published" ? h.binding.state.epochId : "", code: "MEMORY_LOCAL_BINDING_FAILED" };
    const unavailable = foreignRow(h, { request: activate(runId), producer, running: true });
    const boot = h.owner("boot-d");
    expect(boot.service.status(unavailable)).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_RUNTIME_UNAVAILABLE", result: { outcome: "binding_unavailable" } });
    expect(boot.status()).toMatchObject({ runtime: { available: false, unavailableReason: "not_installed" }, actions: { recoverBinding: true, activate: false } });

    const mismatched = foreignRow(h, { request: activate(runId), producer: { ...producer, activationTransactionId: "tx-other" }, running: true });
    expect(h.owner("boot-e").service.status(mismatched)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
  });
});

describe("local kinds — binding repair and historical immutability", () => {
  it("keeps a committed-but-unavailable activation failed after a later repair succeeds", async () => {
    const h = createLocalOnboardingHarness({ entries, publishFails: true });
    const owner = h.owner();
    const { runId } = await prepared(h, owner);
    const first = await settled(owner, activate(runId));
    expect(first).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_RUNTIME_UNAVAILABLE",
      result: { outcome: "binding_unavailable", runtimeAvailable: false }, producer: { progress: { phase: "binding" } } });
    const status = owner.status();
    expect(status).toMatchObject({ authority: { mode: "canonical-local" }, runtime: { available: false, unavailableReason: "not_installed" },
      run: { receipt: { runId } }, actions: { recoverBinding: true, activate: false, resume: false } });

    h.binding.publishFails = false; h.binding.recoverable = 2;
    const repaired = await settled(owner, activate(runId));
    expect(repaired).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true }, producer: { activationTransactionId: status.run?.receipt?.transactionId } });
    expect(h.recover).toHaveBeenCalledWith(status.run?.receipt?.epochId);
    expect(owner.service.status(first.operationId)).toEqual(first);
    expect(owner.status()).toMatchObject({ runtime: { available: true }, actions: { recoverBinding: false, reconcileSources: false } });
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
  });

  it("offers source reconciliation on a healthy binding and repairs without a second commit", async () => {
    const h = createLocalOnboardingHarness({ entries });
    const owner = h.owner();
    const { runId } = await prepared(h, owner);
    await settled(owner, activate(runId));
    h.binding.recoverable = 1;
    expect(owner.status().actions).toMatchObject({ reconcileSources: true, recoverBinding: false });
    const reconciled = await settled(owner, activate(runId));
    expect(reconciled).toMatchObject({ state: "completed", result: { outcome: "activated" } });
    expect(h.recover).toHaveBeenCalledTimes(1);
    expect(owner.status().actions.reconcileSources).toBe(false);
  });

  it("settles a refused repair as failed with its closed code instead of completing over a swallowed custody fault", async () => {
    const h = createLocalOnboardingHarness({ entries });
    const owner = h.owner();
    const { runId } = await prepared(h, owner);
    const activated = await settled(owner, activate(runId));
    h.binding.recoverable = 1;
    h.recover.mockImplementationOnce(() => { throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN"); });
    const refused = await settled(owner, activate(runId));
    expect(refused).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "MEMORY_INGESTION_SOURCE_UNPROVEN",
      result: { outcome: "activated", runtimeAvailable: true }, producer: { activationTransactionId: (activated.producer as { activationTransactionId: string }).activationTransactionId } });
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
    expect(owner.status()).toMatchObject({ runtime: { available: true }, actions: { reconcileSources: true, recoverBinding: false } });
  });
});

describe("local activate — unknown commitment classification", () => {
  function execution(local: Partial<LocalOnboardingService>): MemoryOperationExecution<Extract<MemoryOperationRequest, { kind: "local.onboard.activate" }>> {
    const ctx: MemoryOperationContext = { live: () => null, setup: fakeSetup(), local: local as LocalOnboardingService, lookup: () => undefined,
      activeInFamily: () => undefined, latestInFamily: () => undefined, now: () => "2026-09-22T00:00:00.000Z" };
    return { operationId: "11111111-1111-4111-8111-111111111111", request: { kind: "local.onboard.activate", runId: "run" }, ctx, running: () => undefined, tryClaim: () => true, checkpoint: vi.fn(),
      producer: { kind: "local", runId: "run", previewId: null, snapshotId: "s", activationTransactionId: "tx", progress: reserved } };
  }
  const base = { stopRequested: () => false, activate: vi.fn(async () => { throw new Error("EPIPE"); }) };

  it("never collapses an unreadable receipt or a non-Legacy marker without receipt into failed", async () => {
    let reads = 0;
    const unreadable = execution({ ...base, receipt: () => { if (reads++ === 0) return null; throw new Error("SQLITE_IOERR"); } });
    expect(await localActivateKind.execute(unreadable)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown", errorCode: null });
    const nonLegacy = execution({ ...base, receipt: () => null, authority: () => ({ mode: "canonical-local", epochId: "e", snapshotId: null, transactionId: null, providerLineageId: null, replicaCheckpointDigest: null }) });
    expect(await localActivateKind.execute(nonLegacy)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    const legacy = execution({ ...base, receipt: () => null, authority: () => ({ mode: "legacy-markdown", epochId: null, snapshotId: null, transactionId: null, providerLineageId: null, replicaCheckpointDigest: null }) });
    expect(await localActivateKind.execute(legacy)).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "MIGRATION_INTERNAL_ERROR" });
  });

  it("does not start the producer when the claim is lost and settles interrupted when stopping before claim", async () => {
    const producer = vi.fn(async () => { throw new Error("unreachable"); });
    const lost = { ...execution({ ...base, activate: producer }), tryClaim: () => false };
    expect(await localActivateKind.execute(lost)).toBeNull();
    const stopping = execution({ ...base, activate: producer, stopRequested: () => true });
    expect(await localActivateKind.execute(stopping)).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MIGRATION_INTERRUPTED" });
    expect(producer).not.toHaveBeenCalled();
  });
});
