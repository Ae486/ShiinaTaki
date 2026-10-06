import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryTransitionIntent, MemoryTransitionReceipt, MemoryTransitionResolution } from "@taki/shared";
import { rmTempDir } from "../testing/rm-temp.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";
import { createLogger } from "../logging/logger.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { changeTransitionAdmission, claimTransition, readTransitionAttempt, updateTransitionAttempt } from "./memory-transition-repo.ts";
import { admitTransitionRecovery, readTransitionResolution, resolveTransition } from "./memory-transition-recovery-repo.ts";
import { createMemoryOperationRepo } from "./memory-operation-repo.ts";
import { readTransitionProof, readTransitionReceipt, recordTransitionProof, recordTransitionReceipt, settleTransition } from "./memory-transition-evidence-repo.ts";
import { enqueueTransitionWrite, prepareQueueExecution, readQueueExecution, readQueueOutcome, readTransitionQueue, settleQueueIntent, type QueueAdmission } from "./memory-transition-queue-repo.ts";
import { currentLease, seedTransition, startTransition, TRANSITION_AT as AT, TRANSITION_HASH as HASH, transitionIntent, transitionProof } from "./memory-transition-fixtures.ts";

const opened: Database[] = []; const dirs: string[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });
function fixture(intent = transitionIntent(), path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); opened.push(db); seedTransition(db, intent);
  const lease = changeTransitionAdmission(db, { lease: startTransition(db, intent), now: AT, action: "open" });
  return { db, intent, lease };
}
function resolution(db: Database, intent: MemoryTransitionIntent): MemoryTransitionResolution {
  const lease = currentLease(db, intent); const receipt = readTransitionReceipt(db, intent.transitionId)!;
  const body = { version: 1 as const, operationId: lease.operationId, transitionId: intent.transitionId,
    result: { kind: "transition" as const, transitionId: intent.transitionId, receiptId: receipt.receiptId, authorityCommitted: true,
      runtime: "ready" as const, queue: "settled" as const, outcome: "completed" as const, errorCode: null },
    release: { protocol: "taki-transition-v1" as const, attemptId: lease.attemptId, generation: lease.generation,
      disposition: "source-retired" as const, proofHash: HASH, banks: [{ sourceBankId: "global", nativeGeneration: "generation", fenceId: "fence", outcomeReceiptId: "retired", proofHash: HASH }],
      incidentId: null, recordedAt: AT } };
  return { ...body, resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) };
}
function admission(intent: MemoryTransitionIntent): QueueAdmission {
  return { transitionId: intent.transitionId, sourceEpochId: "epoch", callerRequestId: randomUUID(),
    provenance: { callerId: "operator", runId: "old-run", attemptId: "old-attempt", effectId: "old-effect" },
    scope: { kind: "global", characterId: null }, logicalTargetId: "memory", expectedRevision: 1,
    command: { kind: "mutation", request: { kind: "edit", bankId: "global", memoryId: "memory", expectedRevision: 1, patch: { text: "updated" } } } };
}

/** Only simulates the W4 publication transaction to exercise W1 storage guards; no production switch or native proof is claimed. */
function publishFixture(db: Database, intent: MemoryTransitionIntent) {
  let lease = changeTransitionAdmission(db, { lease: currentLease(db, intent), now: AT, action: "close" });
  lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "draining" } });
  lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "fenced" } });
  const proofId = recordTransitionProof(db, { lease, now: AT, proof: { ...transitionProof(intent, lease), cutoffSequence: readTransitionQueue(db, intent.transitionId).length } });
  lease = updateTransitionAttempt(db, { lease: currentLease(db, intent), now: AT, patch: { phase: "proven" } });
  const body = { version: 1 as const, transitionId: intent.transitionId, operationId: intent.operationId, requestId: intent.request.requestId,
    kind: intent.request.kind, identity: intent.request.expected, newEpochId: "new-epoch", proofId, mappingHash: HASH, custodyAssignmentHash: HASH,
    cutoffSequence: readTransitionAttempt(db, intent.transitionId)!.cutoffSequence!, committedAt: AT };
  const receipt: MemoryTransitionReceipt = { ...body, receiptId: canonicalPayloadHash(["taki-transition-receipt.v1", body]) };
  const publish = () => {
    db.exec(`UPDATE canonical_memory_authority_epochs SET status='closed',ended_at='${AT}' WHERE epoch_id='epoch';
      INSERT INTO canonical_memory_authority_epochs VALUES ('new-epoch','local','target-lineage','active','epoch','${AT}',NULL,'planned-switch');
      UPDATE canonical_memory_authority_state SET active_epoch_id='new-epoch' WHERE singleton=1;`);
    recordTransitionReceipt(db, { lease, now: AT, receipt });
  };
  return { receipt, publish };
}

describe("transition queue custody and immutable evidence", () => {
  it("refuses new queue custody once a durable result exists before the owner projects it", () => {
    const { db, intent, lease } = fixture();
    settleTransition(db, { lease, now: AT, result: { kind: "transition", transitionId: intent.transitionId, receiptId: null,
      authorityCommitted: false, runtime: "source", queue: "settled", outcome: "failed", errorCode: "MEMORY_TRANSITION_PROOF_INVALID" } });
    expect(createMemoryOperationRepo(db, () => AT).get(intent.operationId)?.state).toBe("running");
    expect(() => enqueueTransitionWrite(db, { admission: admission(intent), now: AT })).toThrow("CUTOFF");
    expect(readTransitionQueue(db, intent.transitionId)).toEqual([]);
  });

  it("refuses new queue custody after source abort resolution while preserving exact old caller outcomes", () => {
    const { db, intent, lease } = fixture(); const request = admission(intent);
    enqueueTransitionWrite(db, { admission: request, now: AT });
    const item = readTransitionQueue(db, intent.transitionId)[0]!;
    const outcome = { status: "cancelled" as const, intentId: item.intentId, settledAt: AT };
    settleQueueIntent(db, { lease, now: AT, outcome });
    const body = { version: 1 as const, operationId: lease.operationId, transitionId: intent.transitionId,
      result: { kind: "transition" as const, transitionId: intent.transitionId, receiptId: null, authorityCommitted: false,
        runtime: "source" as const, queue: "settled" as const, outcome: "failed" as const, errorCode: "MEMORY_TRANSITION_PROOF_INVALID" as const },
      release: { protocol: "taki-transition-v1" as const, attemptId: lease.attemptId, generation: lease.generation,
        disposition: "source-aborted" as const, proofHash: HASH, banks: [{ sourceBankId: "global", nativeGeneration: "generation",
          fenceId: "fence", outcomeReceiptId: "aborted", proofHash: HASH }], incidentId: null, recordedAt: AT } };
    resolveTransition(db, { lease, now: AT, resolution: { ...body, resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) } });
    expect(() => enqueueTransitionWrite(db, { admission: admission(intent), now: AT })).toThrow("CUTOFF");
    expect(enqueueTransitionWrite(db, { admission: request, now: AT })).toEqual(outcome);
    expect(readTransitionQueue(db, intent.transitionId)).toHaveLength(1);
  });

  it.each(["operationId", "requestId", "kind"] as const)("rejects a correctly hashed receipt with mismatched admission %s", (field) => {
    const { db, intent } = fixture(); const { receipt, publish } = publishFixture(db, intent); db.transaction(publish);
    const { receiptId: ignored, ...body } = receipt; void ignored;
    const mismatched = { ...body, [field]: field === "kind" ? "transition.emergency-local" : randomUUID() };
    const value = { ...mismatched, receiptId: canonicalPayloadHash(["taki-transition-receipt.v1", mismatched]) };
    // Simulate persisted corruption; the write API and immutable trigger normally prevent it.
    db.exec("DROP TRIGGER memory_transition_receipts_immutable_update");
    db.prepare("UPDATE memory_transition_receipts SET receipt_id=:id,receipt_json=:json").run({ id: value.receiptId, json: JSON.stringify(value) });
    expect(() => readTransitionReceipt(db, intent.transitionId)).toThrow("PROOF_INVALID");
  });

  it("boot reports committed authority separately from missing runtime and queue settlement without a driver", async () => {
    const { db, intent } = fixture(); const { receipt, publish } = publishFixture(db, intent); db.transaction(publish);
    const owner = createMemoryOperationService({ db, setup: fakeSetup(), live: () => null, bootId: "restarted", now: () => AT,
      logger: createLogger("fatal"), onChanged: () => {} });
    expect(owner.status(intent.operationId)).toMatchObject({ state: "outcome_unknown", reason: "runtime_unavailable",
      result: { authorityCommitted: true, receiptId: receipt.receiptId, runtime: "unavailable", queue: "unsettled" } });
    expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("committed");
    // The fixture publishes only the W1 receipt/epoch subset, not W4's full runtime selection proof.
    expect(() => createMemoryOperationRepo(db, () => AT).insertAdmitted({ operationId: randomUUID(), kind: "setup.validate", family: "setup",
      authorityEpochId: "new-epoch", request: { kind: "setup.validate", expectedRevision: 3 },
      producer: { kind: "setup", attemptId: null, revisionBefore: 3, revisionAfter: null }, bootId: "restarted" })).toThrow("BUSY");
    await owner.stop();
  });

  it("persists normalized provenance before ACK; exact replay after cutoff returns original identity, late old invocation refuses", () => {
    const { db, intent, lease } = fixture(); const request = admission(intent);
    const ack = enqueueTransitionWrite(db, { admission: request, now: AT });
    expect(ack.status).toBe("queued"); expect(ack).not.toHaveProperty("memories");
    const row = readTransitionQueue(db, intent.transitionId)[0]!;
    expect(row.provenance).toEqual(request.provenance);
    expect(row.command).toEqual(request.command);
    expect(() => enqueueTransitionWrite(db, { admission: { ...request, logicalTargetId: "other" }, now: AT })).toThrow("CONFLICT");
    changeTransitionAdmission(db, { lease, now: AT, action: "close" });
    expect(enqueueTransitionWrite(db, { admission: request, now: AT })).toEqual(ack);
    expect(() => enqueueTransitionWrite(db, { admission: admission(intent), now: AT })).toThrow("CUTOFF");
    expect(() => db.exec("UPDATE memory_transition_queue SET intent_json='{}'")).toThrow("IMMUTABLE");
  });

  it("enforces count/byte/time/scope bounds and has no ACK or sequence gap on transaction failure", () => {
    const intent = transitionIntent(); intent.queuePolicy = { maxIntents: 1, maxBytes: 4096, maxIntentBytes: 1024, admissionWindowMs: 1000 };
    const { db } = fixture(intent); const request = admission(intent);
    const oversized = admission(intent); if (oversized.command.kind === "mutation" && oversized.command.request.kind === "edit") oversized.command.request.patch.text = "x".repeat(2048);
    expect(() => enqueueTransitionWrite(db, { admission: oversized, now: AT })).toThrow("QUEUE_FULL");
    expect(() => enqueueTransitionWrite(db, { admission: { ...request, scope: { kind: "character", characterId: "new" } }, now: AT })).toThrow("STALE");
    expect(() => enqueueTransitionWrite(db, { admission: request, now: "2026-09-29T00:00:01.000Z" })).toThrow("CUTOFF");
    db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON memory_transition_queue BEGIN SELECT RAISE(ABORT,'fixture-queue-failure'); END;");
    expect(() => enqueueTransitionWrite(db, { admission: request, now: AT })).toThrow("fixture-queue-failure");
    expect(readTransitionQueue(db, intent.transitionId)).toEqual([]); db.exec("DROP TRIGGER fail_queue");
    expect(enqueueTransitionWrite(db, { admission: request, now: AT })).toMatchObject({ status: "queued", sequence: 1 });
    expect(() => enqueueTransitionWrite(db, { admission: admission(intent), now: AT })).toThrow("QUEUE_FULL");
  });

  it("rolls authority pointer and receipt back together on insert failure, then preserves committed evidence", () => {
    const { db, intent } = fixture(); const { receipt, publish } = publishFixture(db, intent);
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON memory_transition_receipts BEGIN SELECT RAISE(ABORT,'fixture-receipt-failure'); END;");
    expect(() => db.transaction(publish)).toThrow("fixture-receipt-failure");
    expect(db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get()?.active_epoch_id).toBe("epoch");
    expect(readTransitionReceipt(db, intent.transitionId)).toBeUndefined();
    db.exec("DROP TRIGGER fail_receipt"); db.transaction(publish);
    expect(readTransitionReceipt(db, intent.transitionId)).toEqual(receipt);
    expect(readTransitionProof(db, receipt.proofId)?.cutoffSequence).toBe(0);
    expect(() => db.exec("DELETE FROM memory_transition_receipts")).toThrow("IMMUTABLE");
  });

  it("reserves exactly one fresh dispatch identity, keeps stable order, and blocks unknown effects from settlement completion", () => {
    const { db, intent } = fixture(); enqueueTransitionWrite(db, { admission: admission(intent), now: AT });
    enqueueTransitionWrite(db, { admission: admission(intent), now: AT });
    const original = readTransitionQueue(db, intent.transitionId); const { publish } = publishFixture(db, intent); db.transaction(publish);
    const execution = (index: number) => ({ intentId: original[index]!.intentId, replayId: original[index]!.replayId, targetRequestId: randomUUID(),
      targetEpochId: "new-epoch", targetBankId: "local-bank", targetLogicalId: "memory", expectedRevision: 1, mappingHash: HASH, preparedAt: AT });
    const lease = currentLease(db, intent); const first = execution(0); const second = execution(1);
    expect(() => prepareQueueExecution(db, { lease, now: AT, execution: second })).toThrow("CONFLICT");
    expect(prepareQueueExecution(db, { lease, now: AT, execution: first })).toEqual(first);
    expect(prepareQueueExecution(db, { lease, now: AT, execution: first })).toEqual(first);
    expect(() => prepareQueueExecution(db, { lease, now: AT, execution: { ...first, targetRequestId: randomUUID() } })).toThrow("CONFLICT");
    expect(readQueueExecution(db, first.intentId)).toEqual(first);
    settleQueueIntent(db, { lease, now: AT, outcome: { status: "outcome_unknown", intentId: first.intentId, targetRequestId: first.targetRequestId, settledAt: AT } });
    expect(() => prepareQueueExecution(db, { lease, now: AT, execution: second })).toThrow("CONFLICT");
    expect(() => resolveTransition(db, { lease, now: AT, resolution: resolution(db, intent) })).toThrow("CONFLICT");
    expect(readTransitionQueue(db, intent.transitionId)).toEqual(original);
    expect(() => settleQueueIntent(db, { lease, now: AT, outcome: { status: "cancelled", intentId: first.intentId, settledAt: AT } })).toThrow("OUTCOME_UNKNOWN");
  });

  it("reports individual conflicts separately from successful transition completion and never overwrites terminal results", () => {
    const { db, intent } = fixture(); enqueueTransitionWrite(db, { admission: admission(intent), now: AT });
    const row = readTransitionQueue(db, intent.transitionId)[0]!; const { publish } = publishFixture(db, intent); db.transaction(publish);
    const lease = currentLease(db, intent);
    const outcome = { status: "conflict" as const, intentId: row.intentId, errorCode: "MEMORY_TRANSITION_CONFLICT" as const, settledAt: AT };
    settleQueueIntent(db, { lease, now: AT, outcome }); settleQueueIntent(db, { lease, now: AT, outcome });
    resolveTransition(db, { lease, now: AT, resolution: resolution(db, intent) });
    expect(readQueueOutcome(db, row.intentId)).toEqual(outcome);
    expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("terminal");
    expect(() => db.exec("UPDATE memory_transition_queue_results SET outcome_json='{}'")).toThrow("IMMUTABLE");
  });

  it("reopens unknown observations, reconciles the same target receipt and appends a new recovery resolution without rewriting history", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-transition-recover-")); dirs.push(dir); const path = join(dir, "db.sqlite");
    const seeded = fixture(transitionIntent(), path); let db = seeded.db; const intent = seeded.intent;
    enqueueTransitionWrite(db, { admission: { ...admission(intent), callerRequestId: "memory-branch:global:abc123" }, now: AT });
    const item = readTransitionQueue(db, intent.transitionId)[0]!; const { receipt, publish } = publishFixture(db, intent); db.transaction(publish);
    const execution = { intentId: item.intentId, replayId: item.replayId, targetRequestId: randomUUID(), targetEpochId: "new-epoch", targetBankId: "local-bank",
      targetLogicalId: "memory", expectedRevision: 1, mappingHash: HASH, preparedAt: AT };
    let lease = currentLease(db, intent); prepareQueueExecution(db, { lease, now: AT, execution });
    settleQueueIntent(db, { lease, now: AT, outcome: { status: "outcome_unknown", intentId: item.intentId, targetRequestId: execution.targetRequestId, settledAt: AT } });
    const oldResult = { kind: "transition" as const, transitionId: intent.transitionId, receiptId: receipt.receiptId, authorityCommitted: true,
      runtime: "unavailable" as const, queue: "unsettled" as const, outcome: "outcome_unknown" as const, errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" as const };
    settleTransition(db, { lease, now: AT, result: oldResult });
    createMemoryOperationRepo(db, () => AT).transition({ operationId: intent.operationId, expectedState: "running",
      patch: { state: "outcome_unknown", reason: "commitment_unknown", errorCode: oldResult.errorCode, result: oldResult } });
    const observations = db.prepare("SELECT * FROM memory_transition_queue_observations").all(); db.close();
    db = openDatabase({ path, migrations: MIGRATIONS }); opened.push(db);
    expect(readQueueOutcome(db, item.intentId)?.status).toBe("outcome_unknown"); expect(readQueueExecution(db, item.intentId)).toEqual(execution);
    const operationId = randomUUID(); const request = { ...intent.request, requestId: randomUUID(), recovery: { transitionId: intent.transitionId, expectedReceiptId: receipt.receiptId, expectedGeneration: 1 } };
    const ops = createMemoryOperationRepo(db, () => AT);
    db.transaction(() => {
      ops.insertAdmitted({ operationId, kind: request.kind, family: "memory-transition", authorityEpochId: "new-epoch", request,
        producer: { kind: "transition", transitionId: intent.transitionId, requestId: request.requestId }, bootId: "new" });
      admitTransitionRecovery(db, { version: 1, operationId, transitionId: intent.transitionId, request, actorId: "operator", admittedAt: AT });
    });
    ops.transition({ operationId, expectedState: "admitted", patch: { state: "running" } });
    const now = "2026-09-29T00:01:01.000Z";
    lease = claimTransition(db, { transitionId: intent.transitionId, operationId, ownerId: "recovery", now, leaseMs: 60_000 });
    expect(() => prepareQueueExecution(db, { lease, now, execution })).toThrow("CONFLICT");
    settleQueueIntent(db, { lease, now, outcome: { status: "completed", intentId: item.intentId, targetRequestId: execution.targetRequestId,
      receiptId: "same-target-factual-receipt", result: { kind: "mutation", memoryId: "memory", revision: 2 }, settledAt: now } });
    const resolved = resolution(db, intent); resolveTransition(db, { lease, now, resolution: resolved });
    expect(readTransitionResolution(db, operationId)).toEqual(resolved);
    expect(ops.get(intent.operationId)?.result).toEqual(oldResult);
    expect(db.prepare("SELECT * FROM memory_transition_queue_observations").all()).toEqual(observations);
    expect(readQueueExecution(db, item.intentId)).toEqual(execution);
    expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("terminal");
  });
});
