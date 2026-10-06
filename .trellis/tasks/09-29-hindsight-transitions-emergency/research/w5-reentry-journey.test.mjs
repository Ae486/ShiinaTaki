/** Fresh synthetic SQLite only; never opens the real corpus or dispatches a model. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { seedLocalB2CoverageFixture } from "../../../../packages/core/src/db/hindsight-local-coverage-fixtures.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { createMemoryOperationRepo } from "../../../../packages/core/src/db/memory-operation-repo.ts";
import { readVerifiedTransitionCandidate } from "../../../../packages/core/src/memory/transitions/transition-final-mapping.ts";
import { createHealthyTransitionHarness } from "../../../../packages/core/src/testing/memory-transition-healthy-fixtures.ts";
import { HindsightTransitionRefusal } from "../../../../packages/core/src/memory/hindsight/hindsight-transition-client.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { atomicJson, decodeCheckpoint, openJourneyCheckpoint } from "./w5-journey-checkpoint.mjs";
import { anchorReturn, buildLocalMutation, findSubmittedOperation, reconcileLocalMutation, waitForExpiredAttempt } from "./w5-reentry-journey.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "w5-reentry-helper-"));
function checkpointFixture(root = temp()) {
  const legacy = join(root, "legacy.json");
  atomicJson(legacy, { completed: false, returnCompleted: true, steps: { return: { operationId: "synthetic-operation", transitionId: "synthetic-transition" } } });
  return { root, legacy, path: join(root, "journey-checkpoint.json") };
}
function mutationFixture() {
  const root = temp(); const path = join(root, "synthetic.sqlite");
  const db = openDatabase({ path, migrations: MIGRATIONS });
  const source = seedLocalB2CoverageFixture(db);
  const scope = { kind: "global", characterId: null };
  const block = createStructuredMemoryBlockRepo(db).replace({ blockId: "user-card", scope, actor: "user", content: "Synthetic original." });
  const local = { candidateId: "a".repeat(64), targetEpochId: source.epochId,
    scopes: [{ localBankId: source.bankId, scope }],
    state: { records: [source.record], blocks: [{ block_id: block.blockId, block_revision: block.revision, content: block.content, scope, writer: "user" }] } };
  return { db, path, root, plan: buildLocalMutation(local) };
}

test("atomic checkpoint survives lost result ACK; malformed/hash-mismatched state fails closed", () => {
  const fixture = checkpointFixture();
  const first = openJourneyCheckpoint(fixture.path, fixture.legacy);
  first.state.journey.localMutation = { exact: "preserved 中文" }; first.save();
  const preserved = readFileSync(fixture.path);
  // A torn uncommitted temporary write is not selected and cannot erase the verified current state.
  writeFileSync(fixture.path + ".torn.next", "{");
  const restart = openJourneyCheckpoint(fixture.path, fixture.legacy);
  assert.deepEqual(restart.state.journey.localMutation, { exact: "preserved 中文" });
  restart.save();
  const history = readdirSync(join(fixture.root, "journey-checkpoint-history"));
  assert.equal(history.filter((name) => /^\d+-/.test(name)).length, 2);
  assert.deepEqual(readFileSync(join(fixture.root, "journey-checkpoint-history", history.find((name) => name.startsWith("legacy-")))), readFileSync(fixture.legacy));
  writeFileSync(fixture.path, "{");
  assert.throws(() => openJourneyCheckpoint(fixture.path, fixture.legacy));
  writeFileSync(fixture.path, preserved);
  const envelope = JSON.parse(preserved); envelope.payloadJson += " "; atomicJson(fixture.path, envelope);
  assert.throws(() => decodeCheckpoint(fixture.path), /CHECKPOINT_HASH/);
  assert.deepEqual(JSON.parse(readFileSync(fixture.legacy)), { completed: false, returnCompleted: true,
    steps: { return: { operationId: "synthetic-operation", transitionId: "synthetic-transition" } } });
});

test("missing checkpoint never initializes from an incomplete legacy RETURN", () => {
  const fixture = checkpointFixture(); atomicJson(fixture.legacy, { completed: false, steps: {} });
  assert.throws(() => openJourneyCheckpoint(fixture.path, fixture.legacy), /RETAINED_RETURN/);
});

for (const fault of ["policy-ack", "block-ack", "checkpoint-ack"]) {
  test(`Local ${fault} loss reconciles original receipts after real SQLite reopen`, () => {
    const fixture = mutationFixture(); const { plan } = fixture;
    const saved = checkpointFixture(fixture.root); const checkpoint = openJourneyCheckpoint(saved.path, saved.legacy);
    checkpoint.state.journey.localMutation = plan; checkpoint.save();
    const maintenance = createCanonicalMemoryMaintenanceRepo(fixture.db);
    maintenance.policyEdit(plan.policy);
    if (fault !== "policy-ack") createStructuredMemoryBlockRepo(fixture.db).replace(plan.block);
    const effects = fault === "checkpoint-ack" ? reconcileLocalMutation(fixture.db, plan) : null;
    fixture.db.close();
    const db = openDatabase({ path: fixture.path, migrations: MIGRATIONS });
    try {
      const restored = openJourneyCheckpoint(saved.path, saved.legacy).state.journey.localMutation;
      const reconciled = reconcileLocalMutation(db, restored);
      if (effects) assert.deepEqual(reconciled, effects);
      assert.deepEqual(reconcileLocalMutation(db, restored), reconciled);
      assert.equal(reconciled.blockRevision, plan.desiredBlockRevision);
      assert.equal(reconciled.revision, plan.policy.expectedRevision + 1);
      assert.equal(reconciled.policyVersion, plan.originalPolicyVersion + 1);
    } finally { db.close(); }
  });
}

test("same Block revision with different content refuses instead of incrementing expected revision", () => {
  const fixture = mutationFixture();
  try {
    createStructuredMemoryBlockRepo(fixture.db).replace({ ...fixture.plan.block, content: "Unrelated edit" });
    assert.throws(() => reconcileLocalMutation(fixture.db, fixture.plan), /BLOCK_CONFLICT/);
    assert.equal(createStructuredMemoryBlockRepo(fixture.db).read("user-card", fixture.plan.block.scope).content, "Unrelated edit");
  } finally { fixture.db.close(); }
});

test("wait refreshes a renewed and then replaced attempt rather than caching old lease", async () => {
  const attempts = [{ leaseUntil: new Date(2000).toISOString() }, { leaseUntil: new Date(5000).toISOString() },
    { leaseUntil: new Date(7000).toISOString(), attemptId: "replacement" }, { leaseUntil: new Date(100).toISOString() }];
  let reads = 0; let waits = 0;
  await waitForExpiredAttempt(() => attempts[reads++], async () => { waits++; }, () => 1000);
  assert.equal(reads, 4); assert.equal(waits, 3);
});

test("lost submit ACK recovers exact real admission; completed RETURN remains verified after reopen", async (context) => {
  // Existing synthetic snapshots have a fixed clock; keep that fixture clock, never change production TTLs.
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00.000Z") });
  const h = await createHealthyTransitionHarness();
  let reopened;
  try {
    const request = await h.request();
    // Save the full request before real submit, then intentionally discard the returned operation identity.
    const persisted = structuredClone(request);
    h.owner.submit(request);
    const found = findSubmittedOperation(h.db, h.owner, persisted); assert(found);
    const mismatch = { ...persisted, confirmation: "different" };
    assert.throws(() => findSubmittedOperation(h.db, h.owner, mismatch));
    await h.owner.stop();
    assert.equal(h.owner.status(found.operationId).state, "completed");
    const step = { operationId: found.operationId, transitionId: found.producer.transitionId };
    const id = h.db.prepare("SELECT id FROM memory_transition_candidates WHERE transition_id=:id AND slot='final'").get({ id: step.transitionId }).id;
    const local = readVerifiedTransitionCandidate(h.db, String(id));
    const anchor = anchorReturn(h.db, h.owner, step, local);
    assert.throws(() => anchorReturn(h.db, h.owner, step, local, { receiptId: "wrong" }));
    await h.stop();
    // New read connection to the fresh synthetic fixture; no live pair or model is involved.
    reopened = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
    const repo = createMemoryOperationRepo(reopened);
    const owner = { status: (id) => repo.get(id) };
    assert.deepEqual(anchorReturn(reopened, owner, step, local, anchor), anchor);
    assert.equal(findSubmittedOperation(reopened, owner, persisted).operationId, found.operationId);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM memory_transition_intents").get().n, 1);
  } finally { reopened?.close(); await h.close(); }
});

test("real Core reentry pauses A then B, explicit recovery keeps one transition and reuses completed A", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00.000Z") });
  const h = await createHealthyTransitionHarness();
  try {
    const returned = h.owner.submit(await h.request()); await h.owner.stop();
    assert.equal(h.owner.status(returned.operationId).state, "completed");
    const verify = h.remote.client.verifyTransition;
    const allow = new Set(); const paused = []; const executed = [];
    h.remote.client.verifyTransition = async (input) => {
      if (!allow.has(input.bankId)) {
        paused.push(input.bankId);
        throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "native_maintenance_incomplete" });
      }
      executed.push(input.bankId); return verify(input);
    };
    const initialRequest = await h.request(undefined, "transition.reenter-hindsight");
    h.owner.submit(initialRequest); // Intentional ACK loss; reconcile only the exact persisted request.
    const initial = findSubmittedOperation(h.db, h.owner, initialRequest); await h.owner.stop();
    const transitionId = initial.producer.transitionId;
    const originalOutcome = structuredClone(h.owner.status(initial.operationId));
    assert.equal(originalOutcome.state, "outcome_unknown"); assert.equal(executed.length, 0);
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_preparations WHERE transition_id=:id").get({ id: transitionId }).n, 1);
    allow.add(paused[0]); h.clock.value = "2026-10-01T00:06:00.000Z";
    const firstRecoveryRequest = await h.request(transitionId, "transition.reenter-hindsight");
    h.owner.submit(firstRecoveryRequest);
    const firstRecovery = findSubmittedOperation(h.db, h.owner, firstRecoveryRequest); await h.owner.stop();
    assert.equal(h.owner.status(firstRecovery.operationId).state, "outcome_unknown");
    assert.deepEqual(executed, [paused[0]]); assert.equal(paused.length, 2);
    const completedA = structuredClone(h.remote.maintenance.get(JSON.stringify([paused[0], transitionId])));
    allow.add(paused[1]); h.clock.value = "2026-10-01T00:12:00.000Z";
    const finalRequest = await h.request(transitionId, "transition.reenter-hindsight");
    const final = h.owner.submit(finalRequest); await h.owner.stop();
    assert.equal(h.owner.status(final.operationId).state, "completed");
    assert.equal(final.producer.transitionId, transitionId);
    assert.deepEqual(executed, paused);
    assert.deepEqual(h.remote.maintenance.get(JSON.stringify([paused[0], transitionId])), completedA);
    assert.deepEqual(h.owner.status(initial.operationId), originalOutcome);
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_intents").get().n, 2); // RETURN + one reentry.
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_recoveries WHERE transition_id=:id").get({ id: transitionId }).n, 2);
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_native_commands WHERE transition_id=:id AND slot LIKE 'abort:%'")
      .get({ id: transitionId }).n, 0);
  } finally { await h.close(); }
});

test("admission-before-first-claim is recovered by identity but unsupported producer recovery fails closed", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00.000Z") });
  const h = await createHealthyTransitionHarness();
  try {
    const request = await h.request();
    const admitted = h.owner.submit(request);
    // Synchronous boot reconstruction wins before the original owner's setImmediate claim callback.
    const restarted = createMemoryOperationService({ db: h.db, live: () => null, setup: fakeSetup(), transition: h.service,
      bootId: "synthetic-restart-before-claim", logger: createCaptureLogger().logger, onChanged: () => undefined });
    await h.owner.stop();
    const recovered = findSubmittedOperation(h.db, restarted, request);
    assert.equal(recovered.operationId, admitted.operationId);
    assert.equal(recovered.state, "outcome_unknown");
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_attempts").get().n, 0);
    await assert.rejects(h.request(recovered.producer.transitionId), /MEMORY_TRANSITION_STALE/);
    assert.equal(h.remote.calls.acquire, 0);
    assert.equal(h.db.prepare("SELECT count(*) n FROM memory_transition_intents").get().n, 1);
  } finally { await h.close(); }
});
