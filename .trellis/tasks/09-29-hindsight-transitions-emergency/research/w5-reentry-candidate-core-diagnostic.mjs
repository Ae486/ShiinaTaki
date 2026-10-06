/** Offline diagnostic only. Immutable input, fresh derivative, synthetic transport, no Native/model startup. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as turn } from "node:timers/promises";
import { HINDSIGHT_TRANSITION_BUILD } from "../../../../packages/shared/src/hindsight-transition-schema.ts";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { readTransitionPreparation } from "../../../../packages/core/src/db/memory-transition-delta-repo.ts";
import { readTransitionIntent, readTransitionAttempt, requireTransitionLease } from "../../../../packages/core/src/db/memory-transition-repo.ts";
import { executeTransitionDelta } from "../../../../packages/core/src/memory/transitions/transition-delta-execution.ts";
import { assertTransitionConfiguration } from "../../../../packages/core/src/memory/transitions/transition-current-identity.ts";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { applicationTestCompatibility } from "../../../../packages/core/src/testing/hindsight-application-runtime-fixtures.ts";

const evidence = resolve(".trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205");
const manifest = JSON.parse(readFileSync(join(evidence, "copy-manifest.json"), "utf8"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const verify = () => Object.entries(manifest.files).every(([name, item]) => {
  const data = readFileSync(join(evidence, name));
  return data.length === item.bytes && sha(data) === item.sha256;
});
assert(verify(), "INPUT_HASH_MISMATCH");
const root = resolve(".trellis/.runtime", `w5-candidate-core-diagnostic-${randomUUID()}`);
mkdirSync(root); copyFileSync(join(evidence, "application.sqlite"), join(root, "application.sqlite"));
const report = { version: 1, input: evidence, root, inputHash: manifest.files["application.sqlite"].sha256,
  meaning: "Offline elapsed-time probe; original request and lease bytes unchanged. One exact operation-state SELECT is answered as running to replay its pre-failure guard; fixed historical clock. No real network.",
  events: [], queryTimings: {}, networkCalls: 0, modelCalls: 0, syntheticTransportCalls: 0, runningStateReadOverrides: 0 };
const started = performance.now();
const emit = (event) => {
  const value = { elapsedMs: performance.now() - started, ...event };
  report.events.push(value); console.log(JSON.stringify({ marker: "W5_CANDIDATE_DIAG", ...value }));
};
const db = openDatabase({ path: join(root, "application.sqlite"), migrations: MIGRATIONS });
const rawPrepare = db.prepare.bind(db);
const transition = "6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53";
const attempt = readTransitionAttempt(db, transition);
const intent = readTransitionIntent(db, transition);
assert(attempt && intent);
const preparationRow = db.prepare("SELECT id,length(body) bytes FROM memory_transition_preparations WHERE transition_id=:id").get({ id: transition });
const fingerprint = db.prepare("SELECT config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get().config_fingerprint;
const originalState = db.prepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: attempt.operationId }).state;
assert.equal(originalState, "outcome_unknown");
report.originalState = originalState;
report.identity = { transition, operation: attempt.operationId, attempt: attempt.attemptId, preparation: preparationRow.id,
  leaseUntil: attempt.leaseUntil, historicalNow: "2026-10-04T12:57:01.828Z" };
db.prepare = (sql) => {
  const statement = rawPrepare(sql);
  return Object.fromEntries(["get", "all", "run"].map((method) => [method, (...args) => {
    const start = performance.now();
    try {
      if (sql === "SELECT state FROM memory_operations WHERE operation_id=:id" && method === "get"
        && args[0]?.id === attempt.operationId) { report.runningStateReadOverrides++; return { state: "running" }; }
      return statement[method](...args);
    } finally {
      const key = sql.replace(/\s+/g, " ").slice(0, 220);
      const stats = report.queryTimings[key] ??= { calls: 0, milliseconds: 0 };
      stats.calls++; stats.milliseconds += performance.now() - start;
    }
  }]));
};
const tally = (items, key) => Object.fromEntries([...new Set(items.map(key))].map((kind) => [kind, items.filter((item) => key(item) === kind).length]));
const now = report.identity.historicalNow;
const assertConfiguration = () => {
  requireTransitionLease(db, { lease: attempt, now });
  assertTransitionConfiguration(db, intent.request.expected, fingerprint);
};
let guardStarted;
const request = () => {
  const start = performance.now(); assertConfiguration();
  emit({ boundary: "request-context", milliseconds: performance.now() - start,
    sincePriorTransportMs: guardStarted === undefined ? null : performance.now() - guardStarted });
  return { timeoutMs: 60_000 };
};
try {
  const readStart = performance.now();
  const prepared = readTransitionPreparation(db, preparationRow.id);
  emit({ boundary: "read-preparation", milliseconds: performance.now() - readStart });
  report.preparation = { bytes: preparationRow.bytes, captureId: prepared.captureId, nativeBank: prepared.scope.nativeBankId,
    deltaOperation: prepared.request.operation_id, requestHash: prepared.request.request_hash,
    nativeDispositions: tally(prepared.request.native, (item) => item.disposition),
    applicationDispositions: tally(prepared.request.application, (item) => item.disposition),
    applicationBodyKinds: tally(prepared.request.application.filter((item) => item.body), (item) => item.body.artifact_kind),
    rowCounts: Object.fromEntries(Object.entries(prepared.request.rows).map(([key, value]) => [key, Array.isArray(value) ? value.length : value === null ? null : 1])) };
  const compatibility = applicationTestCompatibility();
  compatibility.source_identity.compatibility_build = HINDSIGHT_TRANSITION_BUILD;
  const support = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
  compatibility.contracts.transitions = support; compatibility.contracts.transition_source_evidence = support;
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => "diagnostic-synthetic-key", transport: async (url, init) => {
    report.syntheticTransportCalls++;
    const path = new URL(url).pathname;
    emit({ boundary: "transport-entry", path, method: init?.method ?? "GET", bytes: Buffer.byteLength(init?.body ?? "") });
    await turn();
    guardStarted = performance.now();
    if (path.endsWith(`/${transition}/delta`)) return { status: 200, body: "null" };
    if (path === "/ext/taki-memory/version") return { status: 200, body: JSON.stringify(compatibility) };
    if (path.endsWith("/executor/delta")) {
      report.postReached = true;
      const parseStart = performance.now(); const body = JSON.parse(init.body);
      emit({ boundary: "post-body-json-parse", milliseconds: performance.now() - parseStart });
      assert.equal(body.operation_id, prepared.request.operation_id); assert.equal(body.request_hash, prepared.request.request_hash);
      throw new Error("DIAGNOSTIC_POST_STOP_BEFORE_NATIVE");
    }
    throw new Error("UNEXPECTED_SYNTHETIC_REQUEST");
  } });
  const executeStart = performance.now();
  try {
    await executeTransitionDelta(db, { lease: attempt, now, assertConfiguration,
      preparationId: prepared.preparationId, executor: prepared.target.executor, client, request });
    throw new Error("UNEXPECTED_DELTA_SUCCESS");
  } catch (error) {
    report.executionError = error.message;
    emit({ boundary: "execute-stopped", milliseconds: performance.now() - executeStart, code: error.message });
    assert(report.postReached && error.message === "HINDSIGHT_UNREACHABLE");
  }
  assert.equal(db.prepare("SELECT count(*) n FROM memory_transition_delta_results WHERE transition_id=:id").get({ id: transition }).n, 0);
} catch (error) { report.harnessError = String(error.stack); }
finally {
  assert.equal(rawPrepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: attempt.operationId }).state, originalState);
  report.integrity = rawPrepare("PRAGMA integrity_check").get(); db.close();
  report.inputPreserved = verify();
  writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ marker: "W5_CANDIDATE_DIAG", result: join(root, "result.json"), inputPreserved: report.inputPreserved,
    harnessError: report.harnessError ?? null }));
}
assert(!report.harnessError, report.harnessError); assert(report.inputPreserved);
