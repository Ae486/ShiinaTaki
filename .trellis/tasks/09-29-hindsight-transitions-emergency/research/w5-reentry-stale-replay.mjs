/** DIAGNOSTIC ONLY: saved request replay on a fresh owned derivative; no real services/requests. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createHealthyTransitionService } from "../../../../packages/core/src/memory/transitions/transition-healthy-service.ts";
import { createMemoryOperationService } from "../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { readHealthyTransitionIdentity } from "../../../../packages/core/src/memory/transitions/transition-current-identity.ts";
import { transitionLocalHash } from "../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";
import { readTransitionPreview, assertTransitionPreviewRequest } from "../../../../packages/core/src/db/memory-transition-preview-repo.ts";

const evidence = resolve("H:/TakiAgent/.trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c");
const [mode = "expired"] = process.argv.slice(2);
assert(["expired", "fresh", "identity", "elapsed", "elapsed-full"].includes(mode));
const manifest = JSON.parse(readFileSync(join(evidence, "copy-manifest.json"), "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
assert.equal(hash(readFileSync(join(evidence, "application.sqlite"))), manifest.files["application.sqlite"].sha256);
const saved = JSON.parse(JSON.parse(readFileSync(join(evidence, "journey-checkpoint.json"), "utf8")).payloadJson);
const submission = saved.journey.submissions.at(-1);
const request = submission.request;
const root = resolve("H:/TakiAgent/.trellis/.runtime", `w5-stale-probe-${mode}-${randomUUID()}`);
mkdirSync(root); copyFileSync(join(evidence, "application.sqlite"), join(root, "application.sqlite"));
const report = { version: 1, mode, root, sourceEvidence: evidence, sourceHash: manifest.files["application.sqlite"].sha256,
  requestId: request.requestId, previewId: request.previewId, previewCreatedAt: submission.preview.createdAt,
  previewExpiresAt: submission.preview.expiresAt, events: [], innerErrors: [], queryCounts: {}, externalCalls: 0, modelCalls: 0 };
const emit = (event) => { report.events.push(event); console.log(JSON.stringify({ marker: "W5_STALE_DIAG", ...event })); };
const db = openDatabase({ path: join(root, "application.sqlite"), migrations: MIGRATIONS });
const originalPrepare = db.prepare.bind(db);
const originalTransaction = db.transaction.bind(db);
let admission = false;
db.transaction = (fn) => originalTransaction(() => {
  try { fn(); if (admission) throw new Error("W5_DIAGNOSTIC_ADMISSION_REACHED_ROLLBACK"); }
  catch (error) { report.innerErrors.push({ phase: admission ? "admission" : "other", stack: String(error.stack) }); throw error; }
});
db.prepare = (sql) => {
  const statement = originalPrepare(sql);
  const key = sql.replace(/\s+/g, " ").slice(0, 200);
  return Object.fromEntries(["run", "get", "all"].map((method) => [method, (...args) => {
    const start = performance.now();
    try { return statement[method](...args); }
    finally { const row = report.queryCounts[key] ??= { calls: 0, milliseconds: 0 }; row.calls++; row.milliseconds += performance.now() - start; }
  }]));
};
const before = db.prepare("SELECT (SELECT count(*) FROM memory_transition_intents) intents,(SELECT count(*) FROM memory_transition_attempts) attempts,(SELECT count(*) FROM memory_operations) operations").get();
const fingerprint = db.prepare("SELECT config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get().config_fingerprint;
const { logger } = createCaptureLogger();
let runtime;
let service;
let epochStart;
let nowCalls = 0;
const now = () => {
  const elapsed = performance.now() - epochStart;
  const value = mode === "expired" ? Date.parse(submission.preview.expiresAt) + 1
    : Date.parse(submission.preview.createdAt) + (mode.startsWith("elapsed") ? elapsed : 1);
  const stamp = new Date(value).toISOString();
  emit({ boundary: "clock", ordinal: ++nowCalls, value: stamp, elapsedMs: elapsed });
  return stamp;
};
const ready = (epochId, provider) => {
  const start = performance.now();
  let value = true;
  if (runtime) {
    if (!runtime.hasPublishedBinding(provider)) value = false;
    else {
      const snapshot = provider === "local" ? runtime.bindingSnapshot() : runtime.hindsightBindingSnapshot();
      value = snapshot.lifetime === "running" && snapshot.binding.kind === "published" && snapshot.binding.epochId === epochId;
    }
  }
  emit({ boundary: "ready", milliseconds: performance.now() - start, value });
  return value;
};

try {
  const preview = readTransitionPreview(db, request.previewId);
  assert.deepEqual(preview, submission.preview);
  report.previewGuardAtCreation = (() => {
    try { assertTransitionPreviewRequest(preview, { request, actorId: preview.actorId, now: preview.createdAt }); return "pass"; }
    catch (error) { return String(error.stack); }
  })();
  if (mode === "elapsed-full") {
    const start = performance.now();
    const { composeMemoryRuntime } = await import("../../../../packages/core/src/memory/runtime-composition.ts");
    const { createConfigSource } = await import("../../../../packages/core/src/config/config-source.ts");
    const { createConfigRepo } = await import("../../../../packages/core/src/db/config-repo.ts");
    const { createTimelineRepo } = await import("../../../../packages/core/src/db/timeline-repo.ts");
    const { createSummaryRepo } = await import("../../../../packages/core/src/db/summary-repo.ts");
    const { failingGenerateModel } = await import("../../../../packages/core/src/testing/mock-language-model.ts");
    const source = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true",
      TAKI_HINDSIGHT_DEPLOYMENT_MODE: "existing-instance", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18496",
      TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "120000" } });
    const secrets = { health: () => "ok", resolve: () => "w5-owned-healthy-fixture", presence: (secretRef) =>
      ({ secretRef, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-10-03T00:00:00.000Z" } }) };
    const client = new Proxy({}, { get: () => () => { report.externalCalls++; throw new Error("W5_DIAG_EXTERNAL_REFUSED"); } });
    const model = failingGenerateModel(new Error("W5_DIAG_MODEL_REFUSED"));
    model.doGenerate = async () => { report.modelCalls++; throw new Error("W5_DIAG_MODEL_REFUSED"); };
    model.doStream = async () => { report.modelCalls++; throw new Error("W5_DIAG_MODEL_REFUSED"); };
    runtime = composeMemoryRuntime({ db, dataDir: root, promptDir: join(root, "prompt"), bootId: randomUUID(),
      model, timeline: createTimelineRepo(db), summaries: createSummaryRepo(db),
      windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger,
      hindsight: { source, secrets, client } });
    runtime.start();
    emit({ boundary: "runtime-compose-start", milliseconds: performance.now() - start });
  }
  service = createHealthyTransitionService({ db, ownerId: "offline-diagnostic-owner", actorId: submission.preview.actorId,
    runtime: runtime?.transitions ?? {}, now, logger, requestTimeoutMs: 60_000, maintenanceTimeoutMs: 7_200_000,
    fingerprint: () => fingerprint, client: () => { report.externalCalls++; throw new Error("W5_DIAG_EXTERNAL_REFUSED"); }, ready });
  const plan = service.plan;
  service.plan = (value) => {
    const start = performance.now(); emit({ boundary: "plan-start" });
    try { const result = plan(value); emit({ boundary: "plan-complete", milliseconds: performance.now() - start }); return result; }
    catch (error) { emit({ boundary: "plan-error", milliseconds: performance.now() - start, stack: String(error.stack) }); throw error; }
  };
  epochStart = performance.now();
  if (mode === "identity") {
    const start = performance.now();
    const actual = readHealthyTransitionIdentity(db, { kind: request.kind, fingerprint, providerLineage: request.expected.targetLineageId });
    report.identity = { equal: transitionLocalHash(actual) === transitionLocalHash(request.expected),
      changedTopLevelKeys: Object.keys(actual).filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(request.expected[key])),
      milliseconds: performance.now() - start };
    emit({ boundary: "identity", ...report.identity });
  } else {
    const owner = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), transition: service,
      bootId: "offline-diagnostic-owner", logger, now, onChanged: () => undefined });
    epochStart = performance.now(); admission = true;
    try { owner.submit(request); throw new Error("W5_DIAG_UNEXPECTED_COMMIT"); }
    catch (error) { report.outerError = String(error.stack); emit({ boundary: "submit-result", message: error.message, milliseconds: performance.now() - epochStart }); }
    finally { admission = false; }
  }
} catch (error) { report.harnessError = String(error.stack); }
finally {
  await service?.stop(); await runtime?.stop();
  report.before = before;
  report.after = db.prepare("SELECT (SELECT count(*) FROM memory_transition_intents) intents,(SELECT count(*) FROM memory_transition_attempts) attempts,(SELECT count(*) FROM memory_operations) operations").get();
  assert.deepEqual(report.after, before);
  db.close();
  report.sourcePreserved = hash(readFileSync(join(evidence, "application.sqlite"))) === manifest.files["application.sqlite"].sha256;
  writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ marker: "W5_STALE_DIAG", result: join(root, "result.json"), sourcePreserved: report.sourcePreserved, harnessError: report.harnessError ?? null }));
}
assert(!report.harnessError, report.harnessError);
assert(report.sourcePreserved && report.externalCalls === 0);
