/** Actual boot readiness on a new committed corpus copy; retained v2 transport scheduling, no network/model. */
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
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { failingGenerateModel } from "../../../../packages/core/src/testing/mock-language-model.ts";
import { hindsightFixtureSecrets } from "../../../../packages/core/src/testing/hindsight-runtime-composition-fixtures.ts";

const source = resolve(process.argv[2]); const output = resolve(process.argv[3]);
const defaultConfig = process.argv[4] === "default-config";
if (existsSync(output)) throw new Error("OUTPUT_ALREADY_EXISTS");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const copyRoot = resolve(".trellis/.runtime", `w5-verified-observation-${randomUUID()}`);
mkdirSync(copyRoot); const destination = join(copyRoot, "application.sqlite");
const result = { sourceSha256Before: checksum(), copyRoot, modelCalls: 0, networkCalls: 0, polls: [], transportSteps: [],
  deadlineMs: 60_000, pollIntervalMs: 10_000, delayedEventLoopTurns: 3,
  mode: defaultConfig ? "default-config-positive-binding" : "controlled-draft-refusal-absent-binding" };
assert.equal(result.sourceSha256Before, "a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923");
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const db = openDatabase({ path: destination, migrations: [] });
const { logger, records } = createCaptureLogger();
const attempt = JSON.parse(db.prepare("SELECT attempt_json FROM memory_transition_attempts").get().attempt_json);
const observation = JSON.parse(db.prepare("SELECT body_json FROM memory_transition_native_observations ORDER BY sequence DESC LIMIT 1").get().body_json);
const response = { status: 200, body: JSON.stringify(observation.status) };
let started = performance.now(); let interval; let runtime; let service;
function poll() {
  const before = performance.now();
  const value = service.status(attempt.transitionId);
  const record = { durationMs: Math.round(performance.now() - before), elapsedMs: Math.round(performance.now() - started),
    phase: value.progress.phase, runtime: value.progress.runtime, nativeReleasePending: value.progress.nativeReleasePending };
  result.polls.push(record); console.log(JSON.stringify({ poll: record }));
  assert.equal(record.runtime, defaultConfig ? "ready" : "unavailable"); assert.equal(record.phase, "committed");
  if (result.polls.length >= 2) clearInterval(interval);
}
function client(delayed) {
  return createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => "diagnostic-only", transport: () => {
    if (!delayed) return Promise.resolve(response);
    return new Promise((resolve) => setImmediate(() => {
      result.transportSteps.push({ step: 1, elapsedMs: Math.round(performance.now() - started) });
      setImmediate(() => {
        result.transportSteps.push({ step: 2, elapsedMs: Math.round(performance.now() - started) });
        setImmediate(() => {
          result.transportSteps.push({ step: 3, elapsedMs: Math.round(performance.now() - started) }); resolve(response);
        });
      });
    }));
  } });
}
try {
  const construction = performance.now();
  const config = createConfigSource({ repo: createConfigRepo(db), env: { TAKI_HINDSIGHT_ENABLED: "true",
    TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:1", TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000" } });
  const secrets = hindsightFixtureSecrets().catalog;
  // In the absent-path mode only, this disposable input fails the Local draft before it creates any subsystem.
  // This yields the same absent current() condition as post-COMMIT/pre-bind, without editing committed evidence,
  // mocking readiness or altering the working copy. Default-config mode uses the ordinary published Local boot.
  runtime = composeMemoryRuntime({ db, dataDir: copyRoot, promptDir: join(copyRoot, "prompt"), bootId: randomUUID(),
    model: failingGenerateModel(new Error("UNEXPECTED_MODEL_CALL")), timeline: createTimelineRepo(db), summaries: createSummaryRepo(db),
    windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 },
    env: defaultConfig ? {} : { TAKI_MEMORY_STOPLIST: "diagnostic-invalid" }, logger,
    hindsight: { source: config, secrets, client: client(false) } });
  service = composeMemoryTransitions({ db, config, secrets, runtime, ownerId: "diagnostic-owner", actorId: "diagnostic-actor", logger, client: client(false) });
  result.compositionMs = Math.round(performance.now() - construction);
  assert.equal(runtime.hasPublishedBinding("local"), defaultConfig);
  if (!defaultConfig) assert(records.some((record) => record.obj?.code === "MEMORY_LOCAL_BINDING_UNAVAILABLE"));
  result.binding = defaultConfig ? "published-after-default-boot" : "absent-after-local-draft-refusal";
  const beginning = performance.now();
  const control = await client(false).transitionStatus({ bankId: observation.bankId, transitionId: attempt.transitionId, context: { timeoutMs: 60_000 } });
  result.bufferedControl = { ms: Math.round(performance.now() - beginning), phase: control.phase, generation: control.executor.generation };
  started = performance.now(); interval = setInterval(poll, 10_000);
  const pending = client(true).transitionStatus({ bankId: observation.bankId, transitionId: attempt.transitionId, context: { timeoutMs: 60_000 } });
  poll();
  try { await pending; result.pending = { outcome: "resolved", ms: Math.round(performance.now() - started) }; }
  catch (error) { result.pending = { outcome: "rejected", code: error.code ?? "UNCLASSIFIED", ms: Math.round(performance.now() - started) }; }
  // Retain one actual 10-second interval tick even though the repaired request already completed.
  while (result.polls.length < 2) await new Promise((resolve) => setTimeout(resolve, 50));
  clearInterval(interval);
  assert.equal(result.pending.outcome, "resolved");
  assert(result.pending.ms < 60_000);
  assert(result.polls.every((poll) => poll.durationMs < 10_000));
} catch (error) { result.failure = { code: error.code ?? "UNCLASSIFIED", stack: String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)) }; process.exitCode = 1; }
finally {
  clearInterval(interval); await service?.stop(); await runtime?.stop(); db.close();
  result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  if (!result.sourceUnchanged) process.exitCode = 1;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
}
