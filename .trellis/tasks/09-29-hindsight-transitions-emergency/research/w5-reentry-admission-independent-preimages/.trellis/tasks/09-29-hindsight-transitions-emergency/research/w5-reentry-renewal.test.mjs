/** Synthetic real Core RETURN/preview/admission and immutable task checkpoint; no actual pair or model. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHealthyTransitionHarness } from "../../../../packages/core/src/testing/memory-transition-healthy-fixtures.ts";
import { readVerifiedTransitionCandidate } from "../../../../packages/core/src/memory/transitions/transition-final-mapping.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { createMemoryOperationRepo } from "../../../../packages/core/src/db/memory-operation-repo.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { atomicJson, decodeCheckpoint, openJourneyCheckpoint, sha256 } from "./w5-journey-checkpoint.mjs";
import { anchorReturn, buildLocalMutation, reconcileLocalMutation } from "./w5-reentry-journey.mjs";
import { loadReentryRenewalApproval, renewUnadmittedReentry, verifyReentryRenewalLocalState } from "./w5-reentry-renewal.mjs";

const digest = (value) => sha256(JSON.stringify(value));
async function fixture(context) {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00.000Z") });
  const h = await createHealthyTransitionHarness();
  const returned = h.owner.submit(await h.request()); await h.owner.stop();
  assert.equal(h.owner.status(returned.operationId).state, "completed");
  const step = { operationId: returned.operationId, transitionId: returned.producer.transitionId };
  const candidateId = h.db.prepare("SELECT id FROM memory_transition_candidates WHERE transition_id=:id AND slot='final'").get({ id: step.transitionId }).id;
  const local = readVerifiedTransitionCandidate(h.db, candidateId);
  const scope = { kind: "global", characterId: null };
  const block = createStructuredMemoryBlockRepo(h.db).replace({ blockId: "user-card", scope, content: "Renewal fixture.", actor: "user" });
  const plan = buildLocalMutation({ ...local, state: { ...local.state,
    blocks: [{ block_id: block.blockId, block_revision: block.revision, scope, content: block.content, writer: "user" }] } }, h.clock.value);
  const localChanges = reconcileLocalMutation(h.db, plan);
  const preview = await h.service.preview({ kind: "transition.reenter-hindsight" });
  const request = { kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected, confirmation: "healthy-switch" };
  const root = mkdtempSync(join(tmpdir(), "w5-renewal-"));
  const legacy = join(root, "legacy.json"); const path = join(root, "journey-checkpoint.json");
  atomicJson(legacy, { returnCompleted: true, steps: { return: step }, localChanges });
  const checkpoint = openJourneyCheckpoint(path, legacy);
  Object.assign(checkpoint.state.journey, { returnAnchor: anchorReturn(h.db, h.owner, step, local), localMutation: plan,
    submissions: [{ name: "reentry", preview, request }] });
  checkpoint.save();
  const envelope = decodeCheckpoint(path).envelope;
  const approval = { version: 1, kind: "renew-unadmitted-reentry", renewalId: randomUUID(),
    requestId: request.requestId, previewId: preview.previewId, requestHash: digest(request), previewHash: digest(preview),
    returnAnchorHash: digest(checkpoint.state.journey.returnAnchor), localMutationHash: digest(plan), localChangesHash: digest(localChanges),
    checkpoint: { sequence: envelope.sequence, payloadSha256: envelope.sha256, fileSha256: sha256(readFileSync(path)) } };
  const approvalPath = join(root, "approval.json"); atomicJson(approvalPath, approval);
  const authorization = loadReentryRenewalApproval(approvalPath, path);
  h.clock.value = "2026-10-01T00:02:00.001Z";
  const input = { db: h.db, owner: h.owner, state: checkpoint.state, save: checkpoint.save, authorization,
    preview: h.service.preview, now: () => h.clock.value };
  return { h, checkpoint, path, legacy, approval, approvalPath, authorization, request, input };
}

test("one explicit replacement survives append ACK loss/restart and reuses exact admitted request", async (context) => {
  const f = await fixture(context);
  try {
    const original = JSON.stringify(f.input.state.journey.submissions[0]);
    const mutationBefore = JSON.stringify(verifyReentryRenewalLocalState(f.h.db, f.input.state));
    await assert.rejects(renewUnadmittedReentry({ ...f.input, save: () => { f.checkpoint.save(); throw new Error("append ACK lost"); } }), /append ACK lost/);
    const restarted = openJourneyCheckpoint(f.path, f.legacy);
    const saved = restarted.state.journey.submissions[1]; assert(saved);
    const authorization = loadReentryRenewalApproval(f.approvalPath, f.path);
    const input = { ...f.input, state: restarted.state, save: restarted.save, authorization,
      preview: () => { throw new Error("replacement must not be minted again"); } };
    const reused = await renewUnadmittedReentry(input);
    assert.deepEqual(reused, saved); assert.notEqual(reused.request.requestId, f.request.requestId);
    await assert.rejects(renewUnadmittedReentry({ ...input, authorization: { ...authorization, approvalHash: "0".repeat(64) } }));
    assert.equal(JSON.stringify(restarted.state.journey.submissions[0]), original);
    assert.equal(JSON.stringify(verifyReentryRenewalLocalState(f.h.db, restarted.state)), mutationBefore);
    const admitted = f.h.owner.submit(reused.request); // Discard ACK identity from checkpoint, then recover the same row.
    assert.deepEqual(await renewUnadmittedReentry(input), reused);
    f.h.owner.cancel(admitted.operationId); await f.h.owner.stop();
    assert.deepEqual(await renewUnadmittedReentry(input), reused);
    assert.equal(restarted.state.journey.submissions.length, 2);
    assert.equal(f.h.db.prepare("SELECT count(*) n FROM memory_operations WHERE json_extract(request_json,'$.requestId')=:id").get({ id: f.request.requestId }).n, 0);
  } finally { await f.h.close(); }
});

test("a failure before append preserves old checkpoint and permits only the explicitly approved renewal", async (context) => {
  const f = await fixture(context);
  try {
    const original = readFileSync(f.path);
    await assert.rejects(renewUnadmittedReentry({ ...f.input, preview: () => { throw new Error("preview unavailable"); } }), /preview unavailable/);
    assert.deepEqual(readFileSync(f.path), original); assert.equal(f.input.state.journey.submissions.length, 1);
    const replacement = await renewUnadmittedReentry(f.input);
    f.h.clock.value = "2026-10-01T00:04:00.002Z";
    await assert.rejects(renewUnadmittedReentry(f.input), /REPLACEMENT_EXPIRED/);
    assert.equal(f.input.state.journey.submissions.length, 2);
    assert.equal(f.input.state.journey.submissions[1].request.requestId, replacement.request.requestId);
  } finally { await f.h.close(); }
});

for (const fault of ["requestId", "previewHash", "checkpoint", "anchor", "block", "receipt", "orphan", "admitted", "unknown", "during-preview"]) {
  test(`renewal refuses ${fault} without creating a replacement`, async (context) => {
    const f = await fixture(context);
    let admitted;
    try {
      if (["requestId", "previewHash", "checkpoint"].includes(fault)) {
        const approval = structuredClone(f.approval);
        if (fault === "requestId") approval.requestId = randomUUID();
        if (fault === "previewHash") approval.previewHash = "0".repeat(64);
        if (fault === "checkpoint") approval.checkpoint.fileSha256 = "0".repeat(64);
        atomicJson(f.approvalPath, approval);
        assert.throws(() => loadReentryRenewalApproval(f.approvalPath, f.path));
      } else {
        if (fault === "anchor") f.input.state.journey.returnAnchor.receiptId = "0".repeat(64);
        if (fault === "block") f.h.db.exec("UPDATE taki_memory_blocks SET revision=revision+1");
        if (fault === "receipt") {
          f.h.db.exec("DROP TRIGGER IF EXISTS canonical_memory_operation_receipts_immutable_delete");
          f.h.db.prepare("DELETE FROM canonical_memory_operation_receipts WHERE request_id=:id").run({ id: f.input.state.journey.localMutation.policy.requestId });
        }
        if (fault === "orphan") createMemoryOperationRepo(f.h.db, () => f.h.clock.value).insertAdmitted({ operationId: randomUUID(),
          kind: f.request.kind, family: "memory-transition", request: f.request, bootId: "orphan",
          authorityEpochId: f.request.expected.predecessorEpochId,
          producer: { kind: "transition", transitionId: randomUUID(), requestId: f.request.requestId } });
        const admitOld = () => {
          const now = f.h.clock.value; f.h.clock.value = "2026-10-01T00:00:00.001Z";
          admitted = f.h.owner.submit(f.request);
          if (fault !== "unknown") f.h.owner.cancel(admitted.operationId);
          f.h.clock.value = now;
        };
        if (fault === "admitted" || fault === "unknown") admitOld();
        if (fault === "unknown") {
          const restarted = createMemoryOperationService({ db: f.h.db, live: () => null, setup: fakeSetup(), transition: f.h.service,
            bootId: "renewal-foreign-boot", logger: createCaptureLogger().logger, onChanged: () => undefined });
          await f.h.owner.stop();
          assert.equal(restarted.status(admitted.operationId).state, "outcome_unknown");
          await restarted.stop();
        }
        const input = fault === "during-preview" ? { ...f.input, preview: async (params) => {
          const preview = await f.h.service.preview(params); admitOld(); return preview;
        } } : f.input;
        await assert.rejects(renewUnadmittedReentry(input));
      }
      assert.equal(f.input.state.journey.submissions.length, 1);
    } finally { await f.h.close(); }
  });
}
