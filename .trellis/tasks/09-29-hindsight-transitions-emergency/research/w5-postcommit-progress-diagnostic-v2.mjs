/** Read-only production status on a fresh corpus copy, with bounded injected (zero-network) transport scheduling. */
import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { createLocalRuntimeBinding } from "../../../../packages/core/src/memory/local-runtime-binding.ts";
import { readHealthyTransitionStatus } from "../../../../packages/core/src/memory/transitions/transition-healthy-status.ts";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";

const source = resolve(process.argv[2]); const output = resolve(process.argv[3]);
if (existsSync(output)) throw new Error("OUTPUT_ALREADY_EXISTS");
const checksum = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const copyRoot = resolve(".trellis/.runtime", `w5-postcommit-progress-${randomUUID()}`);
mkdirSync(copyRoot); const destination = join(copyRoot, "application.sqlite");
const result = { sourceSha256Before: checksum(), copyRoot, modelCalls: 0, networkCalls: 0, polls: [], transportSteps: [] };
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const db = openDatabase({ path: destination, migrations: [] });
const logger = { warn() {}, error() {} };
const binding = createLocalRuntimeBinding({ db, logger, construct() { throw new Error("UNEXPECTED_CONSTRUCTOR"); } });
const attempt = JSON.parse(db.prepare("SELECT attempt_json FROM memory_transition_attempts").get().attempt_json);
const observation = JSON.parse(db.prepare("SELECT body_json FROM memory_transition_native_observations ORDER BY sequence DESC LIMIT 1").get().body_json);
const response = { status: 200, body: JSON.stringify(observation.status) };
let started = performance.now(); let interval;
function poll() {
  const before = performance.now();
  const value = readHealthyTransitionStatus(db, { transitionId: attempt.transitionId, now: new Date().toISOString(),
    ready(epochId) { const value = binding.snapshot(); return value.lifetime === "running" && value.binding.kind === "published" && value.binding.epochId === epochId; } });
  const record = { durationMs: Math.round(performance.now() - before), elapsedMs: Math.round(performance.now() - started),
    phase: value.progress.phase, runtime: value.progress.runtime, nativeReleasePending: value.progress.nativeReleasePending };
  result.polls.push(record); console.log(JSON.stringify({ poll: record }));
  if (result.polls.length >= 2) clearInterval(interval);
}
function client(delayed) {
  return createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => "diagnostic-only", transport: () => {
    if (!delayed) return Promise.resolve(response);
    // A real socket response can require more than one event-loop turn. Inject that scheduling only;
    // bytes are already buffered, no server/HTTP/model exists, and the request deadline is unchanged.
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
  const beginning = performance.now();
  const control = await client(false).transitionStatus({ bankId: observation.bankId, transitionId: attempt.transitionId, context: { timeoutMs: 60_000 } });
  result.bufferedControl = { ms: Math.round(performance.now() - beginning), phase: control.phase, generation: control.executor.generation };
  const asynchronous = client(true);
  started = performance.now();
  interval = setInterval(poll, 10_000);
  const pending = asynchronous.transitionStatus({ bankId: observation.bankId, transitionId: attempt.transitionId, context: { timeoutMs: 60_000 } });
  // One overdue progress callback is ready when the synchronous COMMIT yields to native finalization.
  poll();
  try { await pending; result.pending = { outcome: "resolved", ms: Math.round(performance.now() - started) }; }
  catch (error) { result.pending = { outcome: "rejected", code: error.code ?? "UNCLASSIFIED", ms: Math.round(performance.now() - started) }; }
  clearInterval(interval);
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
} catch (error) { result.failure = { code: error.code ?? "UNCLASSIFIED", stack: String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)) }; process.exitCode = 1; }
finally {
  clearInterval(interval); db.close(); result.sourceSha256After = checksum(); result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
}
