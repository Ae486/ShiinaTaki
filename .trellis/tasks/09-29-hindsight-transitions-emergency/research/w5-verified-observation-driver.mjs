/** Complete actual Core recovery on a new committed corpus copy; synthetic Native transport, no HTTP/PG/model. */
import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { createTimelineRepo } from "../../../../packages/core/src/db/timeline-repo.ts";
import { createSummaryRepo } from "../../../../packages/core/src/db/summary-repo.ts";
import { createConfigRepo } from "../../../../packages/core/src/db/config-repo.ts";
import { createConfigSource } from "../../../../packages/core/src/config/config-source.ts";
import { composeMemoryRuntime } from "../../../../packages/core/src/memory/runtime-composition.ts";
import { composeMemoryTransitions } from "../../../../packages/core/src/boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { createHealthyTransitionTransport } from "../../../../packages/core/src/testing/memory-transition-healthy-transport.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { failingGenerateModel } from "../../../../packages/core/src/testing/mock-language-model.ts";

const source = resolve(process.argv[2]); const output = resolve(process.argv[3]);
assert(!existsSync(output), "OUTPUT_ALREADY_EXISTS");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const copyRoot = resolve(".trellis/.runtime", `w5-observed-driver-${randomUUID()}`);
mkdirSync(copyRoot); const destination = join(copyRoot, "application.sqlite");
const result = { sourceSha256Before: checksum(), copyRoot, modelCalls: 0, networkCalls: 0, syntheticNative: true,
  polls: [], boundaries: [], heartbeat: [], requestTimeoutMs: 60_000, pollIntervalMs: 10_000 };
assert.equal(result.sourceSha256Before, "a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923");
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const db = openDatabase({ path: destination, migrations: [] });
const { logger, records } = createCaptureLogger();
const attempt = JSON.parse(db.prepare("SELECT attempt_json FROM memory_transition_attempts").get().attempt_json);
// The existing deterministic native double operates on exact retained real evidence. Its outcomes are synthetic;
// this run proves Core scheduling/validation only and cannot certify a native retirement or real-data acceptance.
const evidence = db.prepare("SELECT body FROM memory_transition_native_evidence").all()
  .map((row) => JSON.parse(Buffer.from(row.body).toString("utf8")));
const remote = createHealthyTransitionTransport(evidence, db);
for (const value of evidence) {
  const key = JSON.stringify([value.status.bank_id, attempt.transitionId]);
  remote.evidence.set(key, value); remote.status.set(key, structuredClone(value.status));
}
let started = performance.now(); let interval; let runtime; let service; let owner;
const elapsed = () => Math.round(performance.now() - started);
const log = (record) => console.log(JSON.stringify(record));
function boundary(name, original) {
  return (...args) => {
    const startMs = elapsed(); const value = original(...args);
    const done = () => { const entry = { name, startMs, ms: elapsed() - startMs }; result.boundaries.push(entry); log({ boundary: entry }); };
    if (value && typeof value.then === "function") return value.finally(done);
    done(); return value;
  };
}
let releaseResolve;
const heartbeatStarted = new Promise((resolve) => { releaseResolve = resolve; });
const resolveNative = remote.client.resolveTransition; let awaitedHeartbeat = false;
remote.client.resolveTransition = async (input) => {
  if (!awaitedHeartbeat) {
    awaitedHeartbeat = true;
    // Keep a real Core heartbeat pending through finalization/bind. Only the injected Native response is held;
    // the production heartbeat interval, request deadline, observer polling and full validation remain intact.
    log({ stage: "waiting-for-production-heartbeat", ms: elapsed() }); await heartbeatStarted;
  }
  return resolveNative(input);
};
remote.client.renewTransition = async (input) => {
  const startMs = elapsed(); const status = structuredClone(remote.status.get(JSON.stringify([input.bankId, input.request.transition_id])));
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => "diagnostic-only",
    transport: () => new Promise((resolve) => setImmediate(() => setImmediate(() => setImmediate(() => {
      resolve({ status: 200, body: JSON.stringify(status) });
    })))) });
  const pending = client.renewTransition({ ...input, context: input.context });
  releaseResolve();
  try {
    const value = await pending; result.heartbeat.push({ outcome: "resolved", startMs, ms: elapsed() - startMs }); return value;
  } catch (error) {
    result.heartbeat.push({ outcome: "rejected", code: error.code ?? "UNCLASSIFIED", startMs, ms: elapsed() - startMs }); throw error;
  }
};
try {
  const composition = performance.now(); const bootId = randomUUID();
  // Exact prior Core connection identity; these are fixture transport credentials, never model credentials.
  const config = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true",
    TAKI_HINDSIGHT_DEPLOYMENT_MODE: "existing-instance", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18496",
    TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "120000" } });
  const secrets = { health: () => "ok", resolve: () => "w5-owned-healthy-fixture",
    presence: (secretRef) => ({ secretRef, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1,
      updatedAt: "2026-10-03T00:00:00.000Z" } }) };
  runtime = composeMemoryRuntime({ db, dataDir: copyRoot, promptDir: join(copyRoot, "prompt"), bootId,
    model: failingGenerateModel(new Error("UNEXPECTED_MODEL_CALL")), timeline: createTimelineRepo(db), summaries: createSummaryRepo(db),
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 },
    env: {}, logger, hindsight: { source: config, secrets, client: remote.client } });
  for (const name of ["nativeOutcome", "bind", "executeIntents", "nativeRelease"]) {
    runtime.transitions[name] = boundary(name, runtime.transitions[name]);
  }
  runtime.bindingSnapshot = boundary("full-Local-readiness", runtime.bindingSnapshot);
  service = composeMemoryTransitions({ db, config, secrets, runtime, ownerId: bootId, actorId: "owned-observed-driver",
    logger, client: remote.client });
  owner = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), transition: service,
    bootId, logger, onChanged: () => undefined });
  runtime.start(); result.compositionMs = Math.round(performance.now() - composition);
  started = performance.now();
  const preview = await service.preview({ kind: "transition.return-local", recoveryTransitionId: attempt.transitionId });
  const operation = owner.submit({ kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected, confirmation: "healthy-switch", recovery: preview.recovery });
  result.operationId = operation.operationId; result.transitionId = operation.producer.transitionId;
  interval = setInterval(() => {
    const begin = performance.now();
    try {
      const value = service.status(attempt.transitionId);
      const record = { ms: Math.round(performance.now() - begin), elapsedMs: elapsed(), phase: value.progress.phase, runtime: value.progress.runtime };
      result.polls.push(record); log({ poll: record });
    } catch (error) { result.polls.push({ error: error.code ?? "UNCLASSIFIED", elapsedMs: elapsed() }); }
  }, 10_000);
  await owner.stop(); clearInterval(interval);
  const settled = owner.status(operation.operationId); result.operationState = settled.state; result.operationErrorCode = settled.errorCode;
  result.driverMs = elapsed();
  result.diagnostics = records.filter((record) => record.obj?.stage).map((record) => record.obj);
  result.finalPhase = JSON.parse(db.prepare("SELECT attempt_json FROM memory_transition_attempts").get().attempt_json).phase;
  assert(result.heartbeat.length > 0, "PRODUCTION_HEARTBEAT_WAS_NOT_EXERCISED");
  assert.equal(settled.state, "completed");
} catch (error) {
  result.failure = { code: error.code ?? "UNCLASSIFIED", stack: String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)) };
  process.exitCode = 1;
} finally {
  clearInterval(interval); releaseResolve(); await service?.stop(); await owner?.stop(); await runtime?.stop(); db.close();
  result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  if (!result.sourceUnchanged) process.exitCode = 1;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); log(result);
}
