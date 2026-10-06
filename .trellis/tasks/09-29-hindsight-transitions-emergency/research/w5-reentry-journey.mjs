/** Task-only exact RETURN/mutation/submission reconciliation using the existing Core producers. */
import assert from "node:assert/strict";
import { readTransitionReceipt } from "../../../../packages/core/src/db/memory-transition-evidence-repo.ts";
import { readTransitionByRequest, readTransitionIntent } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { findTransitionRecovery } from "../../../../packages/core/src/db/memory-transition-recovery-repo.ts";
import { readVerifiedTransitionPublication } from "../../../../packages/core/src/db/memory-transition-publication-reader.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { readMemoryAuthoritySelection } from "../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import { sha256, same } from "./w5-journey-checkpoint.mjs";

export function anchorReturn(db, owner, step, local, expected) {
  const operation = owner.status(step.operationId);
  assert.equal(operation.state, "completed");
  assert.equal(operation.kind, "transition.return-local");
  assert.equal(operation.producer?.kind, "transition");
  assert.equal(operation.producer.transitionId, step.transitionId);
  const receipt = readTransitionReceipt(db, step.transitionId); assert(receipt);
  assert.equal(operation.result?.receiptId, receipt.receiptId);
  assert.equal(operation.result?.outcome, "completed");
  assert.equal(receipt.newEpochId, local.targetEpochId);
  assert.equal(receipt.mappingHash, local.mappingHash);
  const publication = readVerifiedTransitionPublication(db, receipt.receiptId);
  assert.equal(publication.candidateId, local.candidateId);
  const anchor = { operationId: step.operationId, transitionId: step.transitionId, receiptId: receipt.receiptId,
    candidateId: local.candidateId, localEpochId: local.targetEpochId, baselineId: publication.baselineId,
    providerLineage: receipt.identity.sourceLineageId,
    banks: local.scopes.map(({ scope, localBankId, nativeBankId, nativeGeneration }) =>
      ({ scope, localBankId, nativeBankId, nativeGeneration })).sort((a, b) => a.nativeBankId.localeCompare(b.nativeBankId)) };
  for (const [key, value] of Object.entries(expected ?? {})) same(anchor[key], value);
  return anchor;
}

export function buildLocalMutation(local, now = new Date().toISOString()) {
  const row = local.state.records.find((record) => record.unit.state === "valid" && record.policy.visibility !== "hidden");
  const block = local.state.blocks.find((entry) => entry.writer === "user") ?? local.state.blocks[0];
  assert(row && block, "W5_LOCAL_MUTATION_INPUTS");
  const characterId = local.scopes.find((scope) => scope.localBankId === row.unit.bankId)?.scope.characterId;
  assert(characterId !== undefined);
  const content = `${block.content}\nW5 isolated healthy transition continuity check.`;
  return { version: 1, candidateId: local.candidateId,
    policy: { epochId: local.targetEpochId, bankId: row.unit.bankId, memoryId: row.unit.memoryId, characterId,
      expectedRevision: row.unit.revision, requestId: "w5-real-policy-change", now,
      patch: { importance: row.policy.importance === 6 ? 7 : 6 } },
    originalPolicyVersion: row.policy.policyVersion,
    block: { blockId: block.block_id, scope: block.scope, content, expectedRevision: block.block_revision,
      actor: block.writer, expectedEpochId: local.targetEpochId, now },
    originalBlockHash: sha256(block.content), desiredBlockHash: sha256(content), desiredBlockRevision: block.block_revision + 1 };
}

export function reconcileLocalMutation(db, plan) {
  assert.equal(plan.version, 1);
  assert.equal(readMemoryAuthoritySelection(db).epochId, plan.policy.epochId);
  assert.equal(plan.block.expectedEpochId, plan.policy.epochId);
  assert.equal(sha256(plan.block.content), plan.desiredBlockHash);
  const maintenance = createCanonicalMemoryMaintenanceRepo(db);
  // Same exact stable request replays its actual immutable policy receipt, including after ACK loss.
  const mutation = maintenance.policyEdit(plan.policy);
  const current = maintenance.record(plan.policy); assert(current);
  same(current, mutation.record);
  assert.equal(current.policy.importance, plan.policy.patch.importance);
  assert(current.policy.policyVersion > plan.originalPolicyVersion);
  assert.equal(current.unit.revision, plan.policy.expectedRevision + 1);
  const blocks = createStructuredMemoryBlockRepo(db);
  let block = blocks.read(plan.block.blockId, plan.block.scope); assert(block);
  if (block.revision === plan.block.expectedRevision && sha256(block.content) === plan.originalBlockHash) {
    blocks.replace(plan.block);
    block = blocks.read(plan.block.blockId, plan.block.scope);
  }
  // A lost Block ACK is reconciled only by this exact desired revision AND body. Never bump CAS on retry.
  assert.equal(block?.revision, plan.desiredBlockRevision, "W5_BLOCK_CONFLICT");
  assert.equal(sha256(block.content), plan.desiredBlockHash, "W5_BLOCK_CONFLICT");
  return { memoryId: current.unit.memoryId, bankId: current.unit.bankId, policyVersion: current.policy.policyVersion,
    importance: current.policy.importance, revision: current.unit.revision, blockId: block.blockId, blockScope: block.scope,
    blockRevision: block.revision, blockContentHash: sha256(block.content) };
}

export function findSubmittedOperation(db, owner, request) {
  const original = readTransitionByRequest(db, request.requestId);
  const recovery = findTransitionRecovery(db, request.requestId);
  assert(!(original && recovery), "W5_AMBIGUOUS_REQUEST");
  const rows = db.prepare("SELECT operation_id FROM memory_operations WHERE json_extract(request_json,'$.requestId')=:id")
    .all({ id: request.requestId });
  assert(rows.length <= 1, "W5_AMBIGUOUS_OPERATION");
  const evidence = original ?? recovery;
  if (!evidence) { assert.equal(rows.length, 0, "W5_ORPHAN_OPERATION"); return null; }
  same(evidence.request, request);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation_id, evidence.operationId);
  const operation = owner.status(evidence.operationId);
  same(operation.request, request);
  assert.equal(operation.producer?.kind, "transition");
  assert.equal(operation.producer.transitionId, evidence.transitionId);
  assert.equal(operation.producer.requestId, request.requestId);
  return operation;
}

export async function waitForExpiredAttempt(read, pause = () => new Promise((resolve) => setTimeout(resolve, 1000)), now = Date.now) {
  // Another process can renew or replace the owner. Refresh the actual attempt after every ordinary wait.
  for (;;) {
    const current = read();
    if (!current || Date.parse(current.leaseUntil) <= now()) return current;
    await pause();
  }
}

export function assertReentryIdentity(db, step, anchor) {
  const intent = readTransitionIntent(db, step.transitionId); assert(intent);
  const expected = intent.request.expected;
  assert.equal(intent.request.kind, "transition.reenter-hindsight");
  assert.equal(expected.predecessorEpochId, anchor.localEpochId);
  assert.equal(expected.baselineHash, anchor.baselineId);
  assert.equal(expected.baselineReceiptId, anchor.receiptId);
  assert.equal(expected.targetLineageId, anchor.providerLineage);
  same(expected.banks.map((b) => ({ scope: b.scope, localBankId: b.sourceBankId,
    nativeBankId: b.nativeBankId, nativeGeneration: b.nativeGeneration })).sort((a, b) => a.nativeBankId.localeCompare(b.nativeBankId)), anchor.banks);
}
