/** Full one-time renewal through actual admission on a fresh offline corpus derivative; never starts Native or dispatch. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { HINDSIGHT_TRANSITION_BUILD } from "../../../../packages/shared/src/index.ts";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { composeMemoryRuntime } from "../../../../packages/core/src/memory/runtime-composition.ts";
import { composeMemoryTransitions } from "../../../../packages/core/src/boot/memory-transition-boot.ts";
import { createConfigSource } from "../../../../packages/core/src/config/config-source.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createTimelineRepo } from "../../../../packages/core/src/db/timeline-repo.ts";
import { createSummaryRepo } from "../../../../packages/core/src/db/summary-repo.ts";
import { failingGenerateModel } from "../../../../packages/core/src/testing/mock-language-model.ts";
import { applicationTestCompatibility } from "../../../../packages/core/src/testing/hindsight-application-runtime-fixtures.ts";
import { atomicJson, decodeCheckpoint, openJourneyCheckpoint, sha256 } from "./w5-journey-checkpoint.mjs";
import { findSubmittedOperation } from "./w5-reentry-journey.mjs";
import { loadReentryRenewalApproval, renewUnadmittedReentry } from "./w5-reentry-renewal.mjs";

const research = resolve(".trellis/tasks/09-29-hindsight-transitions-emergency/research");
const evidence = resolve(".trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c");
const root = resolve(".trellis/.runtime", `w5-renewal-independent-${randomUUID()}`);
const inputManifest = JSON.parse(readFileSync(join(evidence, "copy-manifest.json"), "utf8"));
const delivery = JSON.parse(readFileSync(join(research, "w5-reentry-admission-source-manifest.json"), "utf8"));
const sourcePaths = Object.keys(delivery.files).filter((path) => path.endsWith(".ts") || path.endsWith(".mjs") || path.endsWith(".py"));
const sourceHashes = () => Object.fromEntries(sourcePaths.map((path) => [path, sha256(readFileSync(path))]));
const preservedInputs = () => Object.entries(inputManifest.files).every(([name, expected]) => {
  const bytes = readFileSync(join(evidence, name)); return bytes.length === expected.bytes && sha256(bytes) === expected.sha256;
});
assert(preservedInputs());
mkdirSync(root);
for (const name of Object.keys(inputManifest.files)) copyFileSync(join(evidence, name), join(root, name));
const checkpointPath = join(root, "journey-checkpoint.json");
const initialCheckpointBytes = readFileSync(checkpointPath);
const initial = decodeCheckpoint(checkpointPath);
const history = join(root, "journey-checkpoint-history"); mkdirSync(history);
const retainedCheckpoint = join(history, `${initial.envelope.sequence}-${initial.envelope.sha256}.json`);
writeFileSync(retainedCheckpoint, initialCheckpointBytes, { flag: "wx" });
const checkpoint = openJourneyCheckpoint(checkpointPath, join(root, "driver-result.json"));
const original = checkpoint.state.journey.submissions.at(-1);
const digest = (value) => sha256(JSON.stringify(value));
const approval = { version: 1, kind: "renew-unadmitted-reentry", renewalId: randomUUID(),
  requestId: original.request.requestId, previewId: original.preview.previewId,
  requestHash: digest(original.request), previewHash: digest(original.preview),
  returnAnchorHash: digest(checkpoint.state.journey.returnAnchor), localMutationHash: digest(checkpoint.state.journey.localMutation),
  localChangesHash: digest(checkpoint.state.localChanges), checkpoint: { sequence: initial.envelope.sequence,
    payloadSha256: initial.envelope.sha256, fileSha256: sha256(initialCheckpointBytes) } };
const approvalPath = join(root, "synthetic-renewal-approval.json"); atomicJson(approvalPath, approval);
const authorization = loadReentryRenewalApproval(approvalPath, checkpointPath);
const started = performance.now();
const report = { version: 1, root, preservedInput: evidence, launchHashes: sourceHashes(), syntheticApprovalOnly: true,
  clocks: [], events: [], syntheticCompatibilityCalls: 0, externalCalls: 0, modelCalls: 0, dispatchCalls: 0 };
const emit = (value) => { const event = { ...value, monotonicMs: performance.now() - started };
  report.events.push(event); console.log(JSON.stringify(event)); };
const now = () => { const stamp = new Date().toISOString();
  report.clocks.push({ stamp, monotonicMs: performance.now() - started }); return stamp; };
const db = openDatabase({ path: join(root, "application.sqlite"), migrations: MIGRATIONS });
const counts = () => db.prepare("SELECT (SELECT count(*) FROM memory_transition_intents) intents,(SELECT count(*) FROM memory_transition_attempts) attempts,(SELECT count(*) FROM memory_operations) operations").get();
const before = counts();
const transaction = db.transaction.bind(db); let admitting = false;
db.transaction = (run) => transaction(() => {
  run();
  if (admitting) {
    const inserted = db.prepare("SELECT count(*) n FROM memory_transition_intents WHERE request_id=:id").get({ id: report.replacementRequestId });
    assert.equal(inserted.n, 1); emit({ boundary: "actual-persistence-before-rollback" });
    throw new Error("W5_RENEWAL_ADMISSION_REACHED_ROLLBACK");
  }
});
let runtime; let service; let owner;
try {
  const { logger } = createCaptureLogger();
  const source = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true",
    TAKI_HINDSIGHT_DEPLOYMENT_MODE: "existing-instance", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18496",
    TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "120000" } });
  const secrets = { health: () => "ok", resolve: () => "w5-owned-healthy-fixture", presence: (secretRef) =>
    ({ secretRef, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-10-03T00:00:00.000Z" } }) };
  const anchor = checkpoint.state.journey.returnAnchor;
  const manifest = applicationTestCompatibility({ bankId: anchor.banks[0].nativeBankId,
    namespace: { provider_lineage: anchor.providerLineage, bank_generation: anchor.banks[0].nativeGeneration } });
  manifest.source_identity.compatibility_build = HINDSIGHT_TRANSITION_BUILD;
  const versioned = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
  manifest.contracts.transitions = versioned; manifest.contracts.transition_source_evidence = versioned;
  // Only compatibility is synthetic. No authority/proof/readiness verdict is substituted.
  const client = new Proxy({}, { get: (_, name) => name === "compatibility" ? async () => {
    report.syntheticCompatibilityCalls++; return structuredClone(manifest);
  } : () => { report.externalCalls++; throw new Error("W5_RENEWAL_EXTERNAL_REFUSED"); } });
  const model = failingGenerateModel(new Error("W5_RENEWAL_MODEL_REFUSED"));
  model.doGenerate = model.doStream = async () => { report.modelCalls++; throw new Error("W5_RENEWAL_MODEL_REFUSED"); };
  runtime = composeMemoryRuntime({ db, dataDir: root, promptDir: join(root, "prompt"), bootId: randomUUID(), model,
    timeline: createTimelineRepo(db), summaries: createSummaryRepo(db), windowStart: () => 1, estimatedTokens: () => 0,
    budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger,
    hindsight: { source, secrets, client } });
  runtime.start(); emit({ boundary: "runtime-started" });
  const snapshot = runtime.bindingSnapshot;
  runtime.bindingSnapshot = (...args) => {
    const start = performance.now(); const value = snapshot(...args);
    emit({ boundary: "actual-ready-snapshot", milliseconds: performance.now() - start,
      independentContext: !!args[0], lifetime: value.lifetime, binding: value.binding }); return value;
  };
  service = composeMemoryTransitions({ db, config: source, secrets, runtime, ownerId: "independent-renewal-probe",
    actorId: original.preview.actorId, logger, client, now });
  const plan = service.plan;
  service.plan = (...args) => { const start = performance.now(); emit({ boundary: "plan-start" });
    const value = plan(...args); emit({ boundary: "plan-end", milliseconds: performance.now() - start }); return value; };
  service.execute = async () => { report.dispatchCalls++; throw new Error("W5_RENEWAL_DISPATCH_REFUSED"); };
  owner = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), transition: service,
    bootId: "independent-renewal-probe", logger, now, onChanged: () => { throw new Error("W5_RENEWAL_COMMIT_FORBIDDEN"); } });
  emit({ boundary: "renewal-start" });
  let creationTick;
  const replacement = await renewUnadmittedReentry({ db, owner, state: checkpoint.state, authorization, now,
    save: () => { checkpoint.save(); atomicJson(join(root, "driver-result.json"), checkpoint.state); emit({ boundary: "replacement-append" }); },
    preview: async (params) => {
      emit({ boundary: "fresh-preview-start" }); const clockStart = report.clocks.length;
      const fresh = await service.preview(params);
      creationTick = report.clocks.slice(clockStart).find((row) => row.stamp === fresh.createdAt)?.monotonicMs;
      assert(Number.isFinite(creationTick));
      report.freshPreview = { previewId: fresh.previewId, createdAt: fresh.createdAt, expiresAt: fresh.expiresAt };
      assert.equal(Date.parse(fresh.expiresAt) - Date.parse(report.clocks.at(-1).stamp), 120_000);
      emit({ boundary: "fresh-preview-returned", creationTick }); return fresh;
    } });
  emit({ boundary: "renewal-returned" });
  assert.deepEqual(checkpoint.state.journey.submissions.slice(0, initial.state.journey.submissions.length), initial.state.journey.submissions);
  assert.equal(checkpoint.state.journey.submissions.length, initial.state.journey.submissions.length + 1);
  report.replacementRequestId = replacement.request.requestId;
  assert.equal(findSubmittedOperation(db, owner, replacement.request), null);
  emit({ boundary: "submit-start" }); admitting = true;
  try { assert.throws(() => owner.submit(replacement.request), /W5_RENEWAL_ADMISSION_REACHED_ROLLBACK/); }
  finally { admitting = false; }
  report.previewThroughRollbackMs = performance.now() - started - creationTick;
  report.previewWallAgeAtRollbackMs = Date.now() - Date.parse(replacement.preview.createdAt);
  emit({ boundary: "submit-rolled-back", previewThroughRollbackMs: report.previewThroughRollbackMs,
    previewWallAgeAtRollbackMs: report.previewWallAgeAtRollbackMs });
  assert(report.previewThroughRollbackMs < 120_000 && report.previewWallAgeAtRollbackMs < 120_000);
  assert.deepEqual(readFileSync(retainedCheckpoint), initialCheckpointBytes);
  assert.equal(report.dispatchCalls, 0); assert.equal(report.syntheticCompatibilityCalls, 1);
  report.success = true;
} catch (error) { report.error = String(error.stack); }
finally {
  await service?.stop(); await owner?.stop(); await runtime?.stop();
  report.before = before; report.after = counts();
  report.integrity = db.prepare("PRAGMA integrity_check").get();
  db.close(); report.endHashes = sourceHashes(); report.inputsPreserved = preservedInputs();
  report.retainedCheckpointHash = sha256(readFileSync(retainedCheckpoint));
  writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: join(root, "result.json"), success: report.success ?? false, error: report.error ?? null }));
}
assert.deepEqual(report.before, report.after); assert.deepEqual(report.launchHashes, report.endHashes);
assert(report.inputsPreserved && report.externalCalls === 0 && report.modelCalls === 0 && report.dispatchCalls === 0);
assert(report.success, report.error);
