/** Task-only explicit supersession of one reviewed expired, unadmitted reentry; never a producer recovery. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MemoryTransitionPreviewSchema, MemoryTransitionRequestSchema } from "../../../../packages/shared/src/index.ts";
import { readTransitionPreview } from "../../../../packages/core/src/db/memory-transition-preview-repo.ts";
import { readVerifiedTransitionCandidate } from "../../../../packages/core/src/memory/transitions/transition-final-mapping.ts";
import { readMemoryAuthoritySelection } from "../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { readCanonicalMaintenanceReceipt, decodeCanonicalMaintenanceMutation } from "../../../../packages/core/src/db/canonical-memory-maintenance-journal.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { anchorReturn, findSubmittedOperation } from "./w5-reentry-journey.mjs";
import { decodeCheckpoint, sha256, same } from "./w5-journey-checkpoint.mjs";

const digest = (value) => sha256(JSON.stringify(value));
const hash = (value) => assert(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "W5_RENEWAL_HASH");
const uuid = (value) => assert(typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value), "W5_RENEWAL_ID");

/** Approval references exact retained checkpoint bytes; current checkpoint changes cannot rewrite reviewed history. */
export function loadReentryRenewalApproval(path, checkpointPath) {
  const bytes = readFileSync(path); const approval = JSON.parse(bytes.toString("utf8"));
  assert.equal(approval.version, 1); assert.equal(approval.kind, "renew-unadmitted-reentry");
  uuid(approval.renewalId); uuid(approval.requestId); uuid(approval.previewId);
  for (const name of ["requestHash", "previewHash", "returnAnchorHash", "localMutationHash", "localChangesHash"]) hash(approval[name]);
  const expected = approval.checkpoint;
  assert(Number.isSafeInteger(expected?.sequence) && expected.sequence > 0, "W5_RENEWAL_CHECKPOINT");
  hash(expected.payloadSha256); hash(expected.fileSha256);
  const retained = join(dirname(checkpointPath), "journey-checkpoint-history", `${expected.sequence}-${expected.payloadSha256}.json`);
  const evidencePath = existsSync(retained) ? retained : checkpointPath;
  assert.equal(sha256(readFileSync(evidencePath)), expected.fileSha256, "W5_RENEWAL_CHECKPOINT_BYTES");
  const reviewed = decodeCheckpoint(evidencePath);
  assert.equal(reviewed.envelope.sequence, expected.sequence); assert.equal(reviewed.envelope.sha256, expected.payloadSha256);
  const original = reviewed.state.journey.submissions.filter((entry) => entry.request.requestId === approval.requestId);
  assert.equal(original.length, 1, "W5_RENEWAL_ORIGINAL_REQUEST");
  validateOriginal(approval, original[0]);
  validateReviewedState(approval, reviewed.state);
  assert(!original[0].operationId && !original[0].transitionId && !original[0].supersession, "W5_RENEWAL_NOT_UNADMITTED");
  return { approval, approvalHash: sha256(bytes), original: structuredClone(original[0]) };
}

function validateOriginal(approval, original) {
  assert.equal(original.name, "reentry");
  const request = MemoryTransitionRequestSchema.parse(original.request);
  const preview = MemoryTransitionPreviewSchema.parse(original.preview);
  same(request, original.request); same(preview, original.preview);
  assert.equal(request.kind, "transition.reenter-hindsight"); assert(!request.recovery && !preview.recovery);
  assert.equal(request.requestId, approval.requestId); assert.equal(request.previewId, approval.previewId);
  assert.equal(preview.previewId, approval.previewId); assert.equal(request.previewHash, preview.previewHash);
  same(request.expected, preview.expected); assert.equal(request.confirmation, "healthy-switch");
  // Schema parsing can reorder keys. The approval binds the retained serialization, never a reconstructed envelope.
  assert.equal(digest(original.request), approval.requestHash); assert.equal(digest(original.preview), approval.previewHash);
}
function validateReviewedState(approval, state) {
  assert(state.returnCompleted && state.journey.returnAnchor && state.journey.localMutation && state.localChanges, "W5_RENEWAL_REVIEW_REQUIRED");
  assert.equal(digest(state.journey.returnAnchor), approval.returnAnchorHash);
  assert.equal(digest(state.journey.localMutation), approval.localMutationHash);
  assert.equal(digest(state.localChanges), approval.localChangesHash);
}

/** Read-only: joins the actual policy receipt/snapshot/current record and exact Block. Never calls policyEdit/replace. */
export function verifyReentryRenewalLocalState(db, state) {
  const plan = state.journey.localMutation; assert(plan && state.localChanges, "W5_RENEWAL_LOCAL_CHANGES_REQUIRED");
  assert.equal(readMemoryAuthoritySelection(db).epochId, plan.policy.epochId);
  assert.equal(plan.block.expectedEpochId, plan.policy.epochId);
  const mutation = readCanonicalMaintenanceReceipt(db, plan.policy, { kind: "policy-edit",
    decode: (value) => decodeCanonicalMaintenanceMutation(db, plan.policy, value) });
  assert(mutation && mutation.outcome === "applied", "W5_RENEWAL_POLICY_RECEIPT_REQUIRED");
  const current = createCanonicalMemoryMaintenanceRepo(db).record(plan.policy); same(current, mutation.record);
  assert.equal(current.unit.revision, plan.policy.expectedRevision + 1);
  assert.equal(current.policy.importance, plan.policy.patch.importance);
  assert(current.policy.policyVersion > plan.originalPolicyVersion);
  const block = createStructuredMemoryBlockRepo(db).read(plan.block.blockId, plan.block.scope);
  assert.equal(block?.revision, plan.desiredBlockRevision); assert.equal(sha256(block.content), plan.desiredBlockHash);
  assert.equal(sha256(plan.block.content), plan.desiredBlockHash);
  const effects = { memoryId: current.unit.memoryId, bankId: current.unit.bankId, policyVersion: current.policy.policyVersion,
    importance: current.policy.importance, revision: current.unit.revision, blockId: block.blockId, blockScope: block.scope,
    blockRevision: block.revision, blockContentHash: sha256(block.content) };
  same(effects, state.localChanges); return effects;
}

function verifyCurrent(db, owner, state) {
  const anchor = state.journey.returnAnchor;
  const local = readVerifiedTransitionCandidate(db, anchor.candidateId);
  same(anchorReturn(db, owner, state.steps.return, local, anchor), anchor);
  assert.equal(readMemoryAuthoritySelection(db).epochId, anchor.localEpochId);
  verifyReentryRenewalLocalState(db, state);
}
function noAdmission(db, owner, original) {
  same(readTransitionPreview(db, original.preview.previewId), original.preview);
  const rows = db.prepare(`SELECT
    (SELECT count(*) FROM memory_operations WHERE json_extract(request_json,'$.requestId')=:id) operations,
    (SELECT count(*) FROM memory_transition_intents WHERE request_id=:id) intents,
    (SELECT count(*) FROM memory_transition_recoveries WHERE request_id=:id) recoveries`).get({ id: original.request.requestId });
  assert(rows.operations === 0 && rows.intents === 0 && rows.recoveries === 0, "W5_RENEWAL_ALREADY_ADMITTED");
  assert.equal(findSubmittedOperation(db, owner, original.request), null, "W5_RENEWAL_ALREADY_ADMITTED");
}

/** Returns one checkpointed replacement; caller submits it normally. It never dispatches or changes old bytes. */
export async function renewUnadmittedReentry({ db, owner, state, save, authorization, preview, now = () => new Date().toISOString() }) {
  const { approval, approvalHash, original } = authorization;
  validateOriginal(approval, original); validateReviewedState(approval, state);
  const originals = state.journey.submissions.filter((entry) => entry.request.requestId === approval.requestId);
  assert.equal(originals.length, 1); same(originals[0], original);
  validateOriginal(approval, originals[0]);
  noAdmission(db, owner, original);
  assert(Date.parse(now()) >= Date.parse(original.preview.expiresAt), "W5_RENEWAL_NOT_EXPIRED");
  const successors = state.journey.submissions.filter((entry) => entry.supersession?.requestId === approval.requestId);
  assert(successors.length <= 1, "W5_RENEWAL_AMBIGUOUS_SUCCESSOR");
  if (successors.length) {
    const saved = successors[0]; const link = saved.supersession;
    assert.equal(link.renewalId, approval.renewalId); assert.equal(link.approvalHash, approvalHash);
    assert.equal(link.requestHash, approval.requestHash); assert.equal(link.previewHash, approval.previewHash);
    assert.equal(link.previewId, approval.previewId); same(link.checkpoint, approval.checkpoint);
    assert.equal(link.replacementRequestHash, digest(saved.request)); assert.equal(link.replacementPreviewHash, digest(saved.preview));
    validateReplacement(original, saved);
    same(readTransitionPreview(db, saved.preview.previewId), saved.preview);
    // An ACK loss reuses this exact already admitted replacement, regardless of its outcome. Never renew it.
    if (findSubmittedOperation(db, owner, saved.request)) return saved;
    assert(Date.parse(now()) < Date.parse(saved.preview.expiresAt), "W5_RENEWAL_REPLACEMENT_EXPIRED");
    verifyCurrent(db, owner, state);
    assert(Date.parse(now()) < Date.parse(saved.preview.expiresAt), "W5_RENEWAL_REPLACEMENT_EXPIRED");
    return saved;
  }
  assert.equal(state.journey.submissions.at(-1), originals[0], "W5_RENEWAL_NOT_PENDING_LEAF");
  assert(!state.steps.reentry, "W5_RENEWAL_EXISTING_TRANSITION");
  verifyCurrent(db, owner, state);
  // Expensive anchor/receipt validation precedes preview timestamp creation. The actual preview validates current identity.
  const fresh = await preview({ kind: "transition.reenter-hindsight" });
  noAdmission(db, owner, original); validateReviewedState(approval, state);
  same(state.journey.submissions.at(-1), original);
  const request = { kind: fresh.kind, requestId: randomUUID(), previewId: fresh.previewId,
    previewHash: fresh.previewHash, expected: fresh.expected, confirmation: "healthy-switch" };
  const replacement = { name: "reentry", preview: fresh, request };
  validateReplacement(original, replacement);
  assert(Date.parse(now()) < Date.parse(fresh.expiresAt), "W5_RENEWAL_REPLACEMENT_EXPIRED");
  replacement.supersession = { version: 1, reason: "expired-unadmitted-preview", renewalId: approval.renewalId, approvalHash,
    requestId: approval.requestId, previewId: approval.previewId, requestHash: approval.requestHash, previewHash: approval.previewHash,
    checkpoint: approval.checkpoint, replacementRequestHash: digest(request), replacementPreviewHash: digest(fresh), recordedAt: now() };
  state.journey.submissions.push(replacement);
  save(); // Lost ACK reloads the exact append from immutable checkpoint history before normal owner.submit.
  return replacement;
}
function validateReplacement(original, replacement) {
  const request = MemoryTransitionRequestSchema.parse(replacement.request);
  const preview = MemoryTransitionPreviewSchema.parse(replacement.preview);
  same(request, replacement.request); same(preview, replacement.preview);
  assert.equal(replacement.name, "reentry"); assert.equal(request.kind, original.request.kind);
  assert.equal(preview.kind, original.preview.kind); assert.equal(preview.actorId, original.preview.actorId);
  assert(!request.recovery && !preview.recovery); assert.equal(request.confirmation, "healthy-switch");
  assert.notEqual(request.requestId, original.request.requestId); assert.notEqual(preview.previewId, original.preview.previewId);
  assert.equal(request.previewId, preview.previewId); assert.equal(request.previewHash, preview.previewHash);
  same(request.expected, preview.expected); same(preview.expected, original.request.expected);
}
