/** Publish D77 originals on private copies using actual Core binding/sync; never reconvert native records. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../../../../packages/core/src/db/hindsight-application-replica-repo.ts";
import { createHindsightApplicationCommandRepo } from "../../../../packages/core/src/db/hindsight-application-command-repo.ts";
import { readHindsightApplicationBootstrapEvidence } from "../../../../packages/core/src/db/hindsight-application-bootstrap-evidence.ts";
import { readHindsightCurrentPreparation } from "../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../../../packages/core/src/db/hindsight-replica-scheduler-repo.ts";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { hindsightHttpTransport } from "../../../../packages/core/src/memory/hindsight/hindsight-http-transport.ts";
import { requireHindsightApplicationClient } from "../../../../packages/core/src/memory/hindsight/hindsight-application-capability.ts";
import { createHindsightApplicationWriter } from "../../../../packages/core/src/memory/hindsight/hindsight-application-writer.ts";
import { createHindsightApplicationCommandRunner } from "../../../../packages/core/src/memory/hindsight/hindsight-application-command-runner.ts";
import { createHindsightApplicationBindingRunner } from "../../../../packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts";
import { createHindsightApplicationSyncRunner } from "../../../../packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts";
import { createIntlSegmenterTokenizer } from "../../../../packages/core/src/memory/search-tokenizer.ts";

const [endpoint, directory, priorDatabase] = process.argv.slice(2);
assert.equal(new URL(endpoint).hostname, "127.0.0.1");
const root = resolve(directory);
assert(root.startsWith(resolve("H:/TakiAgent/.trellis/.runtime/stage4-conversion-native") + "\\"));
const source = resolve(priorDatabase ?? "H:/TakiAgent/.trellis/.runtime/stage4-conversion-source/proof-89f9a26b-f575-42a7-8984-d07e0e1dc1a5/validation.sqlite");
if (priorDatabase) {
  assert(source.startsWith(resolve("H:/TakiAgent/.trellis/.runtime/stage4-conversion-native") + "\\"));
  const previous = JSON.parse(readFileSync(join(source, "..", "result.json"), "utf8"));
  assert(previous.stopped && previous.sourceUnchanged, "only stopped, preserved owned runs may be resumed on a new copy");
}
assert(!existsSync(`${source}-wal`), "closed source SQLite required");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const before = hash(source);
const path = join(root, "application.sqlite");
assert(!existsSync(path));
copyFileSync(source, path);
const db = openDatabase({ path, migrations: [] });
const result = { completed: false, conversionExecuted: false, httpRequests: 0, banks: [], sourceUnchanged: false };
let sync;
let runner;
try {
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.authorityEpoch();
  assert.equal(epoch.providerId, "hindsight");
  const preparations = db.prepare("SELECT preparation_id FROM hindsight_current_preparations ORDER BY preparation_id").all()
    .map((row) => readHindsightCurrentPreparation(db, String(row.preparation_id)));
  const bankScope = (id) => { const value = preparations.find((row) => row.bankId === id); assert(value); return value.bankScope; };
  const client = requireHindsightApplicationClient(createHindsightClient({ endpoint,
    resolveApiKey: () => "stage4-private-application-reuse",
    transport: (url, init, maxBytes) => {
      const target = new URL(url);
      assert.equal(target.origin, new URL(endpoint).origin);
      assert(!/retain|reflect|transfer|current-state|transitions/.test(target.pathname), "no native conversion/model endpoint permitted");
      result.httpRequests++;
      return hindsightHttpTransport(url, init, { maxBytes, responseStatuses: [400, 404, 409, 410, 422, 503] });
    } }));
  const repo = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: [] }), bankScope });
  const commands = createHindsightApplicationCommandRepo({ db, assertActive(guard) {
    assert.equal(authority.authorityEpoch().epochId, epoch.epochId);
    assert.equal(guard.key.authorityEpochId, epoch.epochId);
    const checkpoint = repo.checkpoint(guard.key.bankId);
    assert(checkpoint && !checkpoint.bankDeleted);
    assert.deepEqual(checkpoint.namespace, guard.namespace);
    assert.deepEqual(checkpoint.bankScope, bankScope(guard.key.bankId));
  } });
  runner = createHindsightApplicationCommandRunner({ repo: commands, client });
  const writer = createHindsightApplicationWriter({ commands, runner, replica: repo });
  const bind = createHindsightApplicationBindingRunner({ repo, writer, client,
    bootstrap: (scope) => readHindsightApplicationBootstrapEvidence(db, scope) });
  sync = createHindsightApplicationSyncRunner({ client, repo, authority, bankScope, requestTimeoutMs: 60_000,
    deadlineMs: 3_600_000, bind });
  const scheduler = createHindsightReplicaSchedulerRepo(db);
  let originalSources = 0;
  let originalPolicies = 0;
  let originalInvalidated = 0;
  for (const prepared of preparations) {
    const bank = { bankId: prepared.bankId, scope: prepared.bankScope.kind, characterId: prepared.bankScope.characterId };
    scheduler.ensureBank({ bank });
    scheduler.recover(bank.bankId);
    const interrupted = scheduler.get(bank.bankId)?.run;
    if (interrupted) {
      assert(priorDatabase, "unexpected live run in first activation copy");
      assert.equal(interrupted.lease.ownerId, "real-corpus-d77-reuse");
      // The prior owned process/PG are verified stopped. Settle only that exact surviving live lease as cancelled;
      // no invented clock/expiry or new command identity is needed to continue its stored factual work.
      scheduler.fail({ run: interrupted, errorCode: "HINDSIGHT_CANCELLED" });
    }
    scheduler.requestManual({ bankId: bank.bankId, kind: "full" });
    const run = scheduler.claim({ bankId: bank.bankId, ownerId: "real-corpus-d77-reuse", leaseDurationMs: 3_600_000 });
    assert(run);
    console.log(JSON.stringify({ phase: "binding", bankOrdinal: result.banks.length + 1, at: new Date().toISOString() }));
    const synced = await sync.run({ bank, run, signal: new AbortController().signal });
    scheduler.succeed({ run, result: synced });
    const checkpoint = repo.checkpoint(bank.bankId);
    assert(checkpoint);
    const scope = { bankId: bank.bankId, namespace: checkpoint.namespace };
    const original = readHindsightApplicationBootstrapEvidence(db, { ...scope, bankScope: prepared.bankScope, authorityEpochId: epoch.epochId });
    assert(original);
    for (const [id, item] of original.sources) {
      const artifact = repo.latestArtifact({ ...scope, key: { artifact_kind: "source", artifact_id: id } });
      assert(artifact);
      const body = repo.body({ ...scope, bodyId: artifact.body_ref.body_id });
      assert.equal(body.content.body_schema, "application-source.v1");
      assert.deepEqual(body.content.value.original_source, item.value);
      originalSources++;
    }
    for (const [id, item] of original.memories) {
      const artifact = repo.latestArtifact({ ...scope, key: { artifact_kind: "memory", artifact_id: id } });
      assert(artifact);
      const body = repo.body({ ...scope, bodyId: artifact.body_ref.body_id });
      assert.equal(body.content.body_schema, "application-memory.v1");
      assert.deepEqual(body.content.value.original_record, item.value);
      assert.deepEqual(body.content.value.policy, item.value.policy);
      originalPolicies++;
      if (item.value.unit.state === "invalidated") originalInvalidated++;
    }
    assert.equal(repo.blockArtifacts(scope).length, original.blocks.length);
    result.banks.push({ checkpoint, sources: original.sources.size, policies: original.memories.size, blocks: original.blocks.length });
    writeFileSync(join(root, "application-progress.json"), JSON.stringify(result, null, 2) + "\n");
  }
  assert.equal(originalSources, 722);
  assert.equal(originalPolicies, 722);
  assert.equal(originalInvalidated, 21);
  Object.assign(result, { completed: true, originalSources, originalPolicies, originalInvalidated });
} catch (error) {
  result.errorType = error?.constructor?.name ?? "UnknownError";
  writeFileSync(join(root, "application-failure.log"), String(error?.stack ?? error));
} finally {
  sync?.stop();
  await sync?.settle();
  await runner?.stop();
  db.close();
  result.sourceUnchanged = hash(source) === before;
  writeFileSync(join(root, "application-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, banks: result.banks.length }));
}
process.exitCode = result.completed && result.sourceUnchanged ? 0 : 1;
