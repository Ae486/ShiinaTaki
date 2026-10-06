/** Actual W5 operation/runtime journey on the exclusively owned reused-corpus copy. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HindsightConnectionProjectionSchema } from "../../../../packages/shared/src/index.ts";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createConfigSource } from "../../../../packages/core/src/config/config-source.ts";
import { resolveHindsightConfig } from "../../../../packages/core/src/config/hindsight-config.ts";
import { createLogger } from "../../../../packages/core/src/logging/logger.ts";
import { createTimelineRepo } from "../../../../packages/core/src/db/timeline-repo.ts";
import { createSummaryRepo } from "../../../../packages/core/src/db/summary-repo.ts";
import { createHindsightConnectionRepo } from "../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { createHindsightBankSetupRepo } from "../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { hindsightHttpTransport } from "../../../../packages/core/src/memory/hindsight/hindsight-http-transport.ts";
import { createHindsightCompatibilityService, hindsightConnectionFingerprint } from "../../../../packages/core/src/memory/hindsight/hindsight-compatibility-service.ts";
import { createHindsightConnectionSecret } from "../../../../packages/core/src/memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightSetupService } from "../../../../packages/core/src/memory/hindsight/hindsight-setup-service.ts";
import { composeMemoryRuntime } from "../../../../packages/core/src/memory/runtime-composition.ts";
import { composeHindsightLifecycle } from "../../../../packages/core/src/boot/hindsight-lifecycle-boot.ts";
import { composeMemoryTransitions } from "../../../../packages/core/src/boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { readMemoryAuthoritySelection } from "../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import { readTransitionAttempt } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { readTransitionReceipt } from "../../../../packages/core/src/db/memory-transition-evidence-repo.ts";
import { readVerifiedTransitionCandidate } from "../../../../packages/core/src/memory/transitions/transition-final-mapping.ts";
import { readTransitionPreparation } from "../../../../packages/core/src/db/memory-transition-delta-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../../../packages/core/src/db/structured-memory-block-repo.ts";
import { failingGenerateModel } from "../../../../packages/core/src/testing/mock-language-model.ts";

const [directory, endpoint, mode = "run", stage = "all"] = process.argv.slice(2);
assert(["all", "return", "reentry"].includes(stage), "Unknown reviewed journey stage");
const root = resolve(directory);
assert.equal(root, resolve("H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97"));
assert.equal(endpoint, "http://127.0.0.1:18496");
const path = join(root, "application.sqlite");
const db = openDatabase({ path, migrations: MIGRATIONS });
const resultPath = join(root, "driver-result.json");
const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8"))
  : { completed: false, httpRequests: 0, conversionRequests: 0, steps: {}, localChanges: null };
delete result.errorType;
if (stage === "reentry") assert(result.returnCompleted, "Complete and review return before the separately bounded reentry");
const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
const logger = createLogger("warn"); const bootId = randomUUID();
const config = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true",
  TAKI_HINDSIGHT_DEPLOYMENT_MODE: "existing-instance", TAKI_HINDSIGHT_ENDPOINT: endpoint,
  TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "120000" } });
// The owned native fixture has its own HTTP credential. Its stable catalog identity survives restarts; no model
// credential is exposed to Core and the provider models still come from the supervisor's reviewed real custody.
const secrets = { health: () => "ok", resolve: () => "w5-owned-healthy-fixture",
  presence: (secretRef) => ({ secretRef, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-10-03T00:00:00.000Z" } }) };
const client = createHindsightClient({ endpoint, resolveApiKey: () => secrets.resolve(), transport: (url, init, maxBytes) => {
  const target = new URL(url); assert.equal(target.origin, endpoint);
  if (/\/retain(?:\/|$)|\/current-state(?:\/|$)|\/transfers(?:\/|$)/.test(target.pathname)) {
    result.conversionRequests++; save(); throw new Error("W5_CORPUS_RECONVERSION_REFUSED");
  }
  result.httpRequests++;
  return hindsightHttpTransport(url, init, { maxBytes, responseStatuses: [400, 404, 409, 410, 422, 503] });
} });
let runtime; let lifecycle; let transitions; let owner; let progressTimer;
try {
  await restoreHistoricalReviewedMode();
  runtime = composeMemoryRuntime({ db, dataDir: root, promptDir: join(root, "prompt"), bootId,
    model: failingGenerateModel(new Error("W5_CORE_UTILITY_MODEL_NOT_REQUESTED")), timeline: createTimelineRepo(db), summaries: createSummaryRepo(db),
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger,
    hindsight: { source: config, secrets, client } });
  lifecycle = composeHindsightLifecycle({ db, config, secrets, runtime, logger, client });
  transitions = composeMemoryTransitions({ db, config, secrets, runtime, ownerId: bootId, actorId: "w5-owned-operator", logger,
    client, maintenanceTimeoutMs: 7_200_000 });
  const setup = createHindsightSetupService({ config: () => resolveHindsightConfig(config), secret: createHindsightConnectionSecret(secrets),
    client: () => client, compatibility: createHindsightCompatibilityService(), connectionRepo: createHindsightConnectionRepo(db),
    bankRepo: createHindsightBankSetupRepo(db), authorityMode: () => readMemoryAuthoritySelection(db).mode });
  owner = createMemoryOperationService({ db, live: runtime.operations, setup, lifecycle, transition: transitions, bootId, logger,
    onChanged: (operation) => { result.latestOperation = { operationId: operation.operationId, kind: operation.kind, state: operation.state }; save(); } });
  // Revalidation is a genuine Core operation; no setup reset or forged runtime admission. Once a transition starts,
  // changing its immutable config revision would invalidate recovery, so the admitted copy keeps that exact review.
  if (!db.prepare("SELECT transition_id FROM memory_transition_intents LIMIT 1").get()) {
    const operation = owner.submit({ kind: "connection.revalidate", expectedEpochId: readMemoryAuthoritySelection(db).epochId });
    await owner.stop(); const settled = owner.status(operation.operationId);
    assert.equal(settled.state, "completed", JSON.stringify({ state: settled.state, errorCode: settled.errorCode }));
    result.revalidation = { operationId: settled.operationId, state: settled.state }; save();
  }
  if (mode === "connect") { result.connectionReady = true; save(); }
  else {
  runtime.start();
  const returned = await runDirection("transition.return-local", "return");
  const local = candidate(returned.transitionId);
  assert.equal(local.state.banks.length, 2); assert.equal(local.state.sources.length, 722);
  assert.equal(local.state.records.filter((row) => row.unit.state === "invalidated").length, 21);
  // Stop at a genuine return receipt before Local edits or reentry. This gives the parent a reviewable
  // boundary for the next finite model budget without discarding the original transition/attempt history.
  result.returnCompleted = true; save();
  if (stage !== "return") {
  if (!result.localChanges) {
    const row = local.state.records.find((record) => record.unit.state === "valid" && record.policy.visibility !== "hidden"); assert(row);
    const mutation = createCanonicalMemoryMaintenanceRepo(db).policyEdit({ epochId: local.targetEpochId,
      bankId: row.unit.bankId, memoryId: row.unit.memoryId, characterId: local.scopes.find((scope) => scope.localBankId === row.unit.bankId).scope.characterId,
      expectedRevision: row.unit.revision, requestId: "w5-real-policy-change", now: new Date().toISOString(),
      patch: { importance: row.policy.importance === 6 ? 7 : 6 } });
    const block = local.state.blocks.find((row) => row.writer === "user") ?? local.state.blocks[0]; assert(block);
    const changedBlock = createStructuredMemoryBlockRepo(db).replace({ blockId: block.block_id, scope: block.scope,
      content: `${block.content}\nW5 isolated healthy transition continuity check.`, expectedRevision: block.block_revision,
      actor: block.writer, expectedEpochId: local.targetEpochId });
    result.localChanges = { memoryId: row.unit.memoryId, bankId: row.unit.bankId, policyVersion: mutation.record.policy.policyVersion,
      importance: mutation.record.policy.importance, blockId: block.block_id, blockScope: block.scope, blockRevision: changedBlock.revision };
    save();
  }
  const entered = await runDirection("transition.reenter-hindsight", "reentry"); const final = candidate(entered.transitionId);
  assert.equal(final.state.sources.length, 722); assert.equal(final.scopes.length, 2);
  const oldSources = local.mappings.filter((row) => row.kind === "document");
  for (const old of oldSources) {
    const current = final.mappings.find((row) => row.kind === "document" && row.localBankId === old.localBankId && row.localId === old.localId);
    assert(current); assert.deepEqual(current.native, old.native); assert.deepEqual(current.application, old.application);
    assert.equal(current.applicationBodyHash, old.applicationBodyHash);
  }
  const preparations = db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:id").all({ id: entered.transitionId })
    .map((row) => readTransitionPreparation(db, String(row.id)));
  assert(preparations.every((row) => row.request.rows.documents.length === 0 && row.request.rows.memory_units.length === 0));
  const policy = final.state.records.find((row) => row.unit.memoryId === result.localChanges.memoryId && row.unit.bankId === result.localChanges.bankId)?.policy;
  assert.equal(policy?.importance, result.localChanges.importance);
  assert.equal(final.state.blocks.find((row) => row.block_id === result.localChanges.blockId && JSON.stringify(row.scope) === JSON.stringify(result.localChanges.blockScope))?.block_revision,
    result.localChanges.blockRevision);
  result.completed = true; result.preservedDocumentMappings = oldSources.length;
  result.final = { banks: final.scopes.length, documents: final.state.sources.length, units: final.state.records.length,
    invalidated: final.state.records.filter((row) => row.unit.state === "invalidated").length, blocks: final.state.blocks.length };
  result.delta = preparations.map((row) => ({ nativeReuse: row.request.native.filter((entry) => entry.disposition === "reuse").length,
    nativeUpsert: row.request.native.filter((entry) => entry.disposition === "upsert").length,
    applicationUpsert: row.request.application.filter((entry) => entry.disposition === "upsert").length }));
  assert.equal(result.conversionRequests, 0); save();
  }
  }
} catch (error) {
  result.errorType = error?.constructor?.name ?? "UnknownError";
  writeFileSync(join(root, "driver-failure.log"), String(error?.stack ?? error)); save();
} finally {
  clearInterval(progressTimer);
  await transitions?.stop(); await owner?.stop(); await lifecycle?.stop(); await runtime?.stop(); db.close(); save();
}
console.log(JSON.stringify({ completed: result.completed, httpRequests: result.httpRequests, errorType: result.errorType ?? null }));
process.exitCode = !result.errorType && (result.completed || mode === "connect" && result.connectionReady
  || stage === "return" && result.returnCompleted) ? 0 : 1;

function candidate(transitionId) {
  const row = db.prepare("SELECT id FROM memory_transition_candidates WHERE transition_id=:id AND slot='final'").get({ id: transitionId });
  assert(row); return readVerifiedTransitionCandidate(db, String(row.id));
}
async function runDirection(kind, name) {
  const prior = result.steps[name];
  if (prior?.operationId && owner.status(prior.operationId).state === "completed") return prior;
  const transitionId = prior?.transitionId;
  if (transitionId) {
    const attempt = readTransitionAttempt(db, transitionId);
    while (Date.parse(attempt.leaseUntil) > Date.now()) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const preview = await transitions.preview({ kind, ...(transitionId ? { recoveryTransitionId: transitionId } : {}) });
  const request = { kind, requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash,
    expected: preview.expected, confirmation: "healthy-switch", ...(preview.recovery ? { recovery: preview.recovery } : {}) };
  const operation = owner.submit(request); assert.equal(operation.producer.kind, "transition");
  result.steps[name] = { operationId: operation.operationId, transitionId: operation.producer.transitionId }; save();
  progressTimer = setInterval(() => {
    const value = transitions.status(operation.producer.transitionId);
    writeFileSync(join(root, "driver-progress.json"), JSON.stringify({ at: new Date().toISOString(), name, progress: value.progress, httpRequests: result.httpRequests }, null, 2) + "\n");
  }, 10_000);
  try { await owner.stop(); } finally { clearInterval(progressTimer); }
  const settled = owner.status(operation.operationId); result.steps[name].state = settled.state; save();
  assert.equal(settled.state, "completed", JSON.stringify({ state: settled.state, errorCode: settled.errorCode }));
  result.steps[name].receipt = readTransitionReceipt(db, operation.producer.transitionId); save();
  return result.steps[name];
}
async function restoreHistoricalReviewedMode() {
  const repo = createHindsightConnectionRepo(db); if (repo.reviewed().deploymentMode !== null) return;
  const history = JSON.parse(readFileSync("H:/TakiAgent/.trellis/.runtime/d78-real-data/654131f0175a/current-cutover-real-data-state.json", "utf8"));
  const connection = HindsightConnectionProjectionSchema.parse({ enabled: true, deploymentMode: "existing-instance", endpoint: history.endpoint,
    apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 120_000, setupTimeoutMs: 120_000,
    desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null, reflectModel: null,
      consolidationModel: null, embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null } });
  const previous = repo.read(createHindsightBankSetupRepo(db).list());
  assert.equal(hindsightConnectionFingerprint(connection, "owned-d78-real-data-654131f0175a"), previous.configFingerprint,
    "Historical deployment mode must be proven by the exact original reviewed fingerprint");
  repo.save({ ...previous, revision: previous.revision + 1, updatedAt: new Date().toISOString() }, previous.revision, connection.deploymentMode);
  result.historicalModeEvidence = { previousFingerprint: previous.configFingerprint, mode: connection.deploymentMode,
    metadataHash: createHash("sha256").update(readFileSync("H:/TakiAgent/.trellis/.runtime/d78-real-data/654131f0175a/current-cutover-real-data-state.json")).digest("hex") }; save();
}
