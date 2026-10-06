/** Parent-supervised one-shot actual emergency/restart; default inert, no Native/model service startup. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWithHeartbeat } from "./w6-owned-audit-boundary.mjs";

const args = process.argv.slice(2);
if (args.length === 0) { console.log(JSON.stringify({ executed: false, completed: false })); process.exit(0); }
assert([9, 11, 13].includes(args.length), "W6_EXPLICIT_OWNED_ARGUMENTS_REQUIRED");
assert.equal(args[0], "--run-owned-copy"); assert.equal(args[1], "--core-data-dir");
assert.equal(args[3], "--core-db-path"); assert.equal(args[5], "--result-path");
assert.equal(args[7], "--phase"); const runPhase = args[8]; assert(["emergency", "restart"].includes(runPhase));
const recoveryTransitionId = args.length >= 11 ? args[10] : undefined;
const recoveryEvidenceArgument = args.length === 13 ? args[12] : undefined;
if (args.length >= 11) {
  assert.equal(args[9], "--recovery-transition-id"); assert.equal(runPhase, "emergency");
  assert.match(recoveryTransitionId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
}
if (args.length === 13) { assert.equal(args[11], "--recovery-evidence-path"); assert(recoveryEvidenceArgument); }
const dataDir = realpathSync(args[2]); const dbPath = realpathSync(args[4]); const resultPath = resolve(args[6]);
const root = dirname(dataDir); const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const inside = (base, target) => { const part = relative(base, target); return part !== "" && !part.startsWith("..") && !isAbsolute(part); };
assert(inside(join(repo, ".trellis/.runtime/stage4-w6"), root), "W6_OWNED_ROOT_REQUIRED");
assert.equal(resolve(dataDir), join(root, "core")); assert.equal(resolve(dbPath), join(dataDir, "taki.db"));
assert(inside(join(root, "emergency-history"), realpathSync(dirname(resultPath))), "W6_RESULT_OWNERSHIP_REQUIRED");
assert(!existsSync(resultPath), "W6_RESULT_ALREADY_EXISTS");
const recoveryEvidencePath = recoveryEvidenceArgument ? realpathSync(recoveryEvidenceArgument) : undefined;
if (recoveryEvidencePath) assert(inside(join(root, "emergency-history"), recoveryEvidencePath), "W6_RECOVERY_EVIDENCE_OWNERSHIP_REQUIRED");
const checkpointPath = join(dataDir, "w6-emergency-checkpoint.json");
const checkpoint = runPhase === "restart" ? JSON.parse(readFileSync(checkpointPath, "utf8")) : null;
if (checkpoint) {
  assert.equal(checkpoint.version, 1); assert.equal(checkpoint.emergencyCompleted, true);
  assert.equal(createHash("sha256").update(readFileSync(dbPath)).digest("hex"), checkpoint.coreSha256, "W6_STOPPED_CORE_CHANGED");
} else assert(!existsSync(checkpointPath), "W6_PRIOR_ATTEMPT_REQUIRES_REVIEW");

const { openDatabase } = await import("../../../../packages/core/src/db/sqlite.ts");
const { MIGRATIONS } = await import("../../../../packages/core/src/db/migrations/index-list.ts");
const { createConfigRepo } = await import("../../../../packages/core/src/db/config-repo.ts");
const { createConfigSource } = await import("../../../../packages/core/src/config/config-source.ts");
const { loadMemoryConfig } = await import("../../../../packages/core/src/config/memory-config.ts");
const { createTimelineRepo } = await import("../../../../packages/core/src/db/timeline-repo.ts");
const { createSummaryRepo } = await import("../../../../packages/core/src/db/summary-repo.ts");
const { composeMemoryRuntime } = await import("../../../../packages/core/src/memory/runtime-composition.ts");
const { composeMemoryTransitions } = await import("../../../../packages/core/src/boot/memory-transition-boot.ts");
const { createMemoryOperationService } = await import("../../../../packages/core/src/memory/operations/memory-operation-service.ts");
const { createHindsightClient } = await import("../../../../packages/core/src/memory/hindsight/hindsight-client.ts");
const { createHindsightBackupService } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts");
const { createHindsightBackupStore } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-store.ts");
const { createUnavailableHindsightBackupRoute } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-route.ts");
const { readHindsightBackupCustody } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-custody.ts");
const { readMemoryAuthoritySelection } = await import("../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts");
const { readEmergencyCapture, readEmergencyIncident } = await import("../../../../packages/core/src/db/memory-transition-emergency-repo.ts");
const { readTransitionIntent, readTransitionAttempt } = await import("../../../../packages/core/src/db/memory-transition-repo.ts");
const { readTransitionReceipt } = await import("../../../../packages/core/src/db/memory-transition-evidence-repo.ts");
const { readVerifiedEmergencyPublication } = await import("../../../../packages/core/src/db/memory-transition-emergency-publication.ts");
const { readVerifiedEmergencyCandidate } = await import("../../../../packages/core/src/db/memory-transition-emergency-candidate.ts");
const { verifyInstalledTransitionLocal } = await import("../../../../packages/core/src/db/memory-transition-publication-repo.ts");
const { transitionLocalHash } = await import("../../../../packages/core/src/memory/transitions/transition-local-encoding.ts");
const { createCaptureLogger } = await import("../../../../packages/core/src/testing/capture-logger.ts");
const { failingGenerateModel } = await import("../../../../packages/core/src/testing/mock-language-model.ts");
const { fakeSetup } = await import("../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts");
const { auditLocalRetention } = await import("./w6-local-retention-audit.mjs");

const counters = checkpoint ? structuredClone(checkpoint.counters) : { nativeCalls: 0, transportCalls: 0, modelCalls: 0, nativeInFlight: 0, modelInFlight: 0 };
for (const value of Object.values(counters)) assert(Number.isSafeInteger(value) && value >= 0);
const initialCounters = structuredClone(counters);
const memoryEnv = {}; const memoryConfig = loadMemoryConfig(memoryEnv);
const result = { version: 1, phase: runPhase, processId: process.pid, executed: true, completed: false, counters, phases: [], timings: [] };
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
const phase = (name) => { result.phases.push({ name, at: new Date().toISOString() }); save(); };
const timing = (entry) => { result.timings.push(entry); save(); };
async function timed(name, run) {
  const started = performance.now(); let completed = false;
  try { const value = await run(); completed = true; return value; }
  finally { timing({ name, elapsedMs: performance.now() - started, completed, finishedAt: new Date().toISOString() }); }
}
const client = new Proxy(createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => null,
  transport: async () => { counters.transportCalls++; throw new Error("W6_NATIVE_TRANSPORT_FORBIDDEN"); } }), {
  get(target, key) { const value = target[key]; if (typeof value !== "function") return value;
    return async (...params) => { counters.nativeCalls++; counters.nativeInFlight++;
      try { return await value.apply(target, params); } finally { counters.nativeInFlight--; } }; },
});
const model = failingGenerateModel(new Error("W6_MODEL_FORBIDDEN"));
for (const method of ["doGenerate", "doStream"]) model[method] = async () => {
  counters.modelCalls++; counters.modelInFlight++;
  try { throw new Error("W6_MODEL_FORBIDDEN"); } finally { counters.modelInFlight--; }
};
const secrets = { health: () => "ok", resolve: () => null, list: () => ({ entries: [] }),
  presence: (secretRef) => ({ secretRef, present: false, health: "ok", provenance: null }) };
const { logger, records } = createCaptureLogger();
let db; let composed; let candidate;
const fileHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const unknownOperations = (transitionId) => db.prepare(`SELECT * FROM memory_operations WHERE state='outcome_unknown'
  AND json_extract(producer_json,'$.transitionId')=:id ORDER BY operation_id`).all({ id: transitionId })
  .map((row) => ({ operationId: row.operation_id, hash: transitionLocalHash(row) }));
const installationIdentity = (value) => ({ candidateId: value.candidateId, stateHash: value.stateHash, mappingHash: value.mappingHash,
  sources: value.state.sources.length, records: value.state.records.length, banks: value.state.banks.length, checkedBeforeLocalStartup: true });
function verifyRecoveryHistory(receipt) {
  assert(recoveryEvidencePath, "W6_COMMITTED_INSTALLATION_EVIDENCE_REQUIRED");
  const previous = JSON.parse(readFileSync(recoveryEvidencePath, "utf8"));
  assert(previous.version === 1 && previous.phase === "emergency" && previous.executed === true && previous.completed === false);
  assert.equal(previous.operation?.state, "outcome_unknown");
  assert.equal(previous.operation?.result?.transitionId, recoveryTransitionId);
  assert.equal(previous.operation?.result?.receiptId, receipt.receiptId);
  assert.equal(previous.operation?.result?.authorityCommitted, true);
  const row = db.prepare("SELECT state,result_json,producer_json FROM memory_operations WHERE operation_id=:id").get({ id: previous.operation.operationId });
  assert.equal(row?.state, "outcome_unknown"); assert.deepEqual(JSON.parse(row.result_json), previous.operation.result);
  const producer = JSON.parse(row.producer_json);
  assert(producer.kind === "transition" && producer.transitionId === recoveryTransitionId, "W6_PRIOR_OPERATION_IDENTITY_MISMATCH");
  assert(previous.phases.some((value) => value.name === "exact-installation-verified"), "W6_PRIOR_INSTALLATION_NOT_VERIFIED");
  assert.deepEqual(previous.installation, installationIdentity(candidate), "W6_PRIOR_INSTALLATION_MISMATCH");
  assert.deepEqual(previous.counters, { nativeCalls: 0, transportCalls: 0, modelCalls: 0, nativeInFlight: 0, modelInFlight: 0 });
  return { path: relative(root, recoveryEvidencePath), sha256: fileHash(recoveryEvidencePath),
    operationId: previous.operation.operationId, receiptId: receipt.receiptId, epochId: receipt.newEpochId,
    receiptHash: transitionLocalHash(receipt), installation: previous.installation };
}
function assertPreservedRecovery(value) {
  if (!value) return;
  const actual = unknownOperations(value.transitionId);
  for (const old of value.preservedUnknownOperations ?? []) assert(actual.some((row) => row.operationId === old.operationId && row.hash === old.hash), "W6_UNKNOWN_HISTORY_CHANGED");
  if (value.committed) {
    const receipt = readTransitionReceipt(db, value.transitionId);
    assert(transitionLocalHash(receipt) === value.committed.receiptHash, "W6_ORIGINAL_RECEIPT_CHANGED");
    const historyPath = realpathSync(join(root, value.committed.path));
    assert(inside(join(root, "emergency-history"), historyPath), "W6_RECOVERY_EVIDENCE_OWNERSHIP_REQUIRED");
    assert(fileHash(historyPath) === value.committed.sha256, "W6_ORIGINAL_INSTALLATION_HISTORY_CHANGED");
  }
}
function compose() {
  const bootId = randomUUID(); const config = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "false" } });
  const runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"), bootId, model,
    timeline: createTimelineRepo(db), summaries: createSummaryRepo(db), windowStart: () => 1, estimatedTokens: () => 0,
    budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: memoryEnv, logger,
    hindsight: { source: config, secrets, client } });
  const backup = createHindsightBackupService({ db, store: createHindsightBackupStore(dataDir), route: createUnavailableHindsightBackupRoute(),
    custody: () => readHindsightBackupCustody({ catalog: secrets, storeId: "w6-owned-offline" }), missingCredentials: () => [], logger });
  const transitions = composeMemoryTransitions({ db, config, secrets, runtime, ownerId: bootId, actorId: "w6-owned-operator", logger, client, backup });
  const owner = createMemoryOperationService({ db, live: runtime.operations, setup: fakeSetup(), transition: transitions, backup,
    bootId, logger, onChanged: () => undefined });
  return { runtime, backup, transitions, owner, stop: async () => { await transitions.stop(); await backup.stop(); await owner.stop(); await runtime.stop(); } };
}
try {
  phase("opening-owned-core"); db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  if (runPhase === "emergency") {
  const source = readMemoryAuthoritySelection(db);
  if (!recoveryTransitionId) {
    assert.equal(source.mode, "hindsight");
    assert.equal(db.prepare("SELECT count(*) AS n FROM memory_transition_incidents").get().n, 0, "W6_PRIOR_ATTEMPT_REQUIRES_REVIEW");
  }
  else {
    const original = readTransitionIntent(db, recoveryTransitionId); const capture = readEmergencyCapture(db, recoveryTransitionId);
    const incident = readEmergencyIncident(db, recoveryTransitionId); const attempt = readTransitionAttempt(db, recoveryTransitionId);
    assert(original && capture && incident && attempt, "W6_ORIGINAL_RECOVERY_EVIDENCE_REQUIRED");
    assert.equal(original.request.kind, "transition.emergency-local");
    const receipt = readTransitionReceipt(db, recoveryTransitionId);
    assert.equal(source.mode, receipt ? "canonical-local" : "hindsight");
    assert.equal(source.epochId, receipt?.newEpochId ?? capture.predecessorEpochId);
    assert(Date.parse(attempt.leaseUntil) <= Date.now(), "W6_ORIGINAL_EXECUTOR_STILL_LIVE");
    result.recovery = { transitionId: recoveryTransitionId, originalOperationId: original.operationId,
      captureId: capture.captureId, incidentId: incident.incidentId, incidentHash: transitionLocalHash(incident),
      preservedUnknownOperations: unknownOperations(recoveryTransitionId) };
    if (receipt) {
      const publication = readVerifiedEmergencyPublication(db, receipt.receiptId);
      candidate = readVerifiedEmergencyCandidate(db, publication.candidateId);
      assert.equal(candidate.targetEpochId, receipt.newEpochId);
      result.recovery.committed = verifyRecoveryHistory(receipt);
      result.priorRetention = auditLocalRetention(db, candidate, memoryConfig);
    } else assert(!recoveryEvidencePath, "W6_UNCOMMITTED_EVIDENCE_ARGUMENT_REFUSED");
  }
  composed = compose();
  if (result.recovery) {
    const original = composed.owner.status(result.recovery.originalOperationId);
    assert.equal(original.state, "outcome_unknown", "W6_ORIGINAL_UNKNOWN_OPERATION_REQUIRED");
    result.recovery.originalOperationHash = transitionLocalHash(original);
  }
  result.callsBeforeEmergency = structuredClone(counters);
  result.preexistingInFlight = { native: counters.nativeInFlight, model: counters.modelInFlight };
  const bind = composed.runtime.transitions.bind.bind(composed.runtime.transitions);
  composed.runtime.transitions.bind = async (transitionId) => {
    const receipt = readTransitionReceipt(db, transitionId); assert(receipt);
    const audit = (name, run) => auditWithHeartbeat({ db, transitionId, name, record: timing }, run);
    const publication = await audit("extra-publication-audit", () => readVerifiedEmergencyPublication(db, receipt.receiptId));
    candidate = await audit("extra-candidate-audit", () => readVerifiedEmergencyCandidate(db, publication.candidateId));
    if (result.recovery?.committed) {
      await audit("committed-retention-audit", () => { result.beforeBindRetention = auditLocalRetention(db, candidate, memoryConfig); });
      result.installation = result.recovery.committed.installation;
      result.installationEvidence = { fromPriorHistory: true, ...result.recovery.committed };
      phase("prior-installation-and-current-retention-verified");
    } else {
      await audit("extra-installed-row-audit", () => verifyInstalledTransitionLocal(db, candidate));
      result.installation = installationIdentity(candidate); phase("exact-installation-verified");
    }
    return timed("production-bind", () => bind(transitionId));
  };
  const executeIntents = composed.runtime.transitions.executeIntents.bind(composed.runtime.transitions);
  composed.runtime.transitions.executeIntents = (lease) => timed("production-settle-queue", () => executeIntents(lease));
  phase("offline-preview");
  const preview = await composed.transitions.preview({ kind: "transition.emergency-local", recoveryTransitionId });
  result.preview = { takeover: preview.takeover, inventory: preview.inventory, blocking: preview.blocking,
    banks: preview.banks.length, lastVerifiedBackupId: preview.lastVerifiedBackupId, backupAgeSeconds: preview.backupAgeSeconds,
    remoteHead: preview.remoteHead, remoteLoss: preview.remoteLoss };
  assert(preview.expected && preview.takeover === "eligible", "W6_PREVIEW_REFUSED");
  phase("submitting-emergency");
  const admitted = composed.owner.submit({ kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected, confirmation: "emergency-takeover",
    ...(preview.recovery ? { recovery: preview.recovery } : {}) });
  if (result.recovery) {
    assert.equal(admitted.producer?.transitionId, recoveryTransitionId);
    assert.notEqual(admitted.operationId, result.recovery.originalOperationId);
    result.recoveryOperationId = admitted.operationId;
  }
  await timed("operation-execution-and-settlement", () => composed.owner.stop());
  const settled = composed.owner.status(admitted.operationId);
  result.operation = { operationId: settled.operationId, state: settled.state, result: settled.result, errorCode: settled.errorCode }; save();
  assert.equal(settled.state, "completed", "W6_EMERGENCY_INCOMPLETE"); assert(candidate);
  const receipt = readTransitionReceipt(db, candidate.transitionId); const incident = readEmergencyIncident(db, candidate.transitionId);
  assert(receipt && incident); result.incident = { incidentId: incident.incidentId, factsHash: incident.transition.factsHash,
    coreSha256: incident.core.sha256, tableCount: incident.transition.tables.length, unknownEffects: incident.transition.unknownEffects.length };
  if (result.recovery) {
    assert.equal(candidate.transitionId, recoveryTransitionId);
    assert.equal(readEmergencyCapture(db, recoveryTransitionId).captureId, result.recovery.captureId);
    assert.equal(transitionLocalHash(incident), result.recovery.incidentHash);
    assert.equal(transitionLocalHash(composed.owner.status(result.recovery.originalOperationId)), result.recovery.originalOperationHash);
    assertPreservedRecovery(result.recovery);
  }
  result.retention = auditLocalRetention(db, candidate, memoryConfig);
  result.receiptId = receipt.receiptId; result.epochId = receipt.newEpochId;
  phase("stopping-before-reopen"); await composed.stop(); composed = undefined; db.close(); db = undefined;
  result.stoppedCoreSha256 = createHash("sha256").update(readFileSync(dbPath)).digest("hex");
  assert.deepEqual(counters, result.callsBeforeEmergency, "W6_NEW_NATIVE_OR_MODEL_DISPATCH");
  writeFileSync(checkpointPath, JSON.stringify({ version: 1, emergencyCompleted: true, coreSha256: result.stoppedCoreSha256,
    operationId: admitted.operationId, transitionId: candidate.transitionId, candidateId: candidate.candidateId,
    receiptId: receipt.receiptId, epochId: receipt.newEpochId, incidentHash: transitionLocalHash(incident), counters,
    processId: process.pid, installation: result.installation, ...(result.recovery ? { recovery: result.recovery } : {}) }, null, 2) + "\n", { flag: "wx" });
  result.emergencyCompleted = true;
  } else {
  phase("separate-process-recovery");
  assert.notEqual(process.pid, checkpoint.processId, "W6_DISTINCT_PROCESS_REQUIRED");
  const receipt = readTransitionReceipt(db, checkpoint.transitionId); assert(receipt);
  assert.equal(receipt.receiptId, checkpoint.receiptId); assert.equal(receipt.newEpochId, checkpoint.epochId);
  const publication = readVerifiedEmergencyPublication(db, receipt.receiptId);
  assert.equal(publication.candidateId, checkpoint.candidateId);
  candidate = readVerifiedEmergencyCandidate(db, publication.candidateId);
  assert.equal(transitionLocalHash(readEmergencyIncident(db, checkpoint.transitionId)), checkpoint.incidentHash);
  // Verify the old unknown outcomes and installation history before starting any Local producer.
  assertPreservedRecovery(checkpoint.recovery);
  composed = compose(); composed.runtime.start();
  assert.equal(readMemoryAuthoritySelection(db).epochId, checkpoint.epochId);
  assert(composed.runtime.hasPublishedBinding("local")); assert(!composed.runtime.hasPublishedBinding("hindsight"));
  await assert.rejects(() => composed.transitions.preview({ kind: "transition.reenter-hindsight" }));
  assert.equal(composed.owner.status(checkpoint.operationId).state, "completed");
  if (checkpoint.recovery) {
    assert.equal(checkpoint.transitionId, checkpoint.recovery.transitionId);
    assert.equal(readEmergencyCapture(db, checkpoint.transitionId).captureId, checkpoint.recovery.captureId);
    assert.equal(transitionLocalHash(readEmergencyIncident(db, checkpoint.transitionId)), checkpoint.recovery.incidentHash);
    assert.equal(transitionLocalHash(composed.owner.status(checkpoint.recovery.originalOperationId)), checkpoint.recovery.originalOperationHash);
    assertPreservedRecovery(checkpoint.recovery);
    result.recovery = checkpoint.recovery;
  }
  result.restartRetention = auditLocalRetention(db, candidate, memoryConfig);
  result.processRestart = true; result.epochId = receipt.newEpochId; result.receiptId = receipt.receiptId;
  result.callsBeforeRestart = initialCounters;
  result.foreignBranchHash = transitionLocalHash(db.prepare("SELECT * FROM memory_transition_foreign_branches").all());
  await composed.stop(); composed = undefined; db.close(); db = undefined;
  }
  assert.deepEqual(counters, initialCounters, "W6_NEW_NATIVE_OR_MODEL_DISPATCH");
  result.additionalDispatch = { native: counters.nativeCalls - initialCounters.nativeCalls,
    transport: counters.transportCalls - initialCounters.transportCalls, model: counters.modelCalls - initialCounters.modelCalls };
  result.completed = true; phase("completed");
} catch (error) {
  result.error = { code: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "W6_DRIVER_FAILED" };
  const code = (value) => typeof value === "string" && /^(?:MEMORY_|HINDSIGHT_|W6_)[A-Z0-9_]{1,96}$/.test(value) ? value : null;
  const phases = new Set(["admitted", "draining", "fenced", "proven", "committed", "binding", "settling", "terminal"]);
  result.diagnostics = records.flatMap((row) => code(row.obj?.code) ? [{ code: code(row.obj.code), cause: code(row.obj.cause),
    phase: phases.has(row.obj.phase) ? row.obj.phase : null }] : []);
  process.exitCode = 1;
} finally {
  if (composed) { try { await composed.stop(); } catch { result.cleanupFailed = true; process.exitCode = 1; } }
  db?.close(); save();
  console.log(JSON.stringify({ completed: result.completed, error: result.error ?? null, additionalDispatch: result.additionalDispatch ?? null }));
}
