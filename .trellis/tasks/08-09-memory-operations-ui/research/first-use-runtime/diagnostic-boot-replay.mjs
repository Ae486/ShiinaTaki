/**
 * INPUT: a fresh post-reentry prepared copy of the generated fixture, with its original source hash manifest
 * OUTPUT: real Core diagnostic boot after selected historical proof damage, explicit data refusal and owned cleanup
 * POS: task-only fault acceptance; no original data, Native/PG process, paid model or production repair mechanism
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as shared from "../../../../../packages/shared/src/index.ts";
import { bootCore, openOperator, runCoreChild, stopCore } from "./smoke-core.mjs";
import { freePort, listeners, running } from "./smoke-native.mjs";
import { startFakeProvider } from "../../../archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2), "utf8");

function unchanged(input) {
  return Object.entries(input.sourceBefore).every(([path, digest]) => hash(join(input.source, path)) === digest);
}

function sourceBaseline() {
  const git = (...args) => execFileSync("git", args, { cwd: REPOSITORY, encoding: "utf8", windowsHide: true });
  const paths = [...new Set((git("diff", "--name-only", "HEAD") + git("ls-files", "--others", "--exclude-standard")).split(/\r?\n/))]
    .filter((name) => /^(packages\/|apps\/desktop\/src\/)/.test(name) && /\.(ts|tsx|json)$/.test(name));
  return { head: git("rev-parse", "HEAD").trim(), node: process.version, harnessSha256: hash(SCRIPT),
    changedSource: paths.map((name) => ({ name, sha256: existsSync(join(REPOSITORY, name)) ? hash(join(REPOSITORY, name)) : null })) };
}

function damageSelectedProof(dataDir) {
  const db = new DatabaseSync(join(dataDir, "taki.db"));
  try {
    const row = db.prepare(`SELECT p.candidate_id, c.body FROM memory_authority_selection s
      JOIN memory_transition_publications p ON p.receipt_id=s.transition_receipt_id
      JOIN memory_transition_candidates c ON c.id=p.candidate_id WHERE s.singleton=1`).get();
    assert(row?.body instanceof Uint8Array, "prepared fixture needs a selected transition candidate");
    const value = JSON.parse(Buffer.from(row.body).toString("utf8"));
    value.mappingHash = "0".repeat(64);
    // Only the disposable copy loses its immutable-update trigger; preserve FK, marker and schema shapes.
    db.exec("BEGIN");
    try {
      db.exec("DROP TRIGGER memory_transition_candidates_immutable_update");
      db.prepare("UPDATE memory_transition_candidates SET body=? WHERE id=?")
        .run(Buffer.from(JSON.stringify(value)), row.candidate_id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { candidateId: row.candidate_id, damage: "valid-shaped candidate mappingHash mismatch", sqlite: db.prepare("PRAGMA integrity_check").get() };
  } finally { db.close(); }
}

async function run(root) {
  assert(resolve(root).startsWith(resolve("G:/taki-post-reentry-")), "diagnosis accepts only prepared owned copies");
  const input = JSON.parse(readFileSync(join(root, "replay-input.json"), "utf8"));
  assert.equal(resolve(input.root), resolve(root));
  assert(unchanged(input), "original fixture changed before diagnostic");
  assert(!existsSync(join(root, "replay-result.json")) && !existsSync(join(root, "diagnostic-result.json")), "never reuse an exercised copy");
  const result = { root, startedAt: new Date().toISOString(), status: "failed", source: input.source,
    build: sourceBaseline(), teardown: {} };
  json(join(root, "diagnostic-result.json"), result);
  const owned = {};
  try {
    result.damage = damageSelectedProof(join(root, "core-data"));
    owned.provider = await startFakeProvider({ watch: [] });
    const corePort = await freePort([12306, owned.provider.port]);
    result.ports = { core: corePort, provider: owned.provider.port, absentNative: 12306 };
    assert.deepEqual(listeners([corePort, 12306]), [], "Core and absent Native ports must be free");
    owned.core = await bootCore({ script: SCRIPT, dataDir: join(root, "core-data"), credentialsDir: join(root, "credentials"),
      port: corePort, providerPort: owned.provider.port, nativePort: 12306, logFile: join(root, "core-diagnostic.log") });
    owned.operator = await openOperator(corePort, "invalid proof diagnostic replay");
    const status = shared.MemoryAuthorityStatusSchema.parse(await owned.operator.call(shared.MEMORY_AUTHORITY_METHODS.status));
    assert.equal(status.authority.mode, input.authority.mode);
    assert.equal(status.authority.epochId, input.authority.epochId);
    assert.equal(status.runtime.available, false);
    assert.equal(status.runtime.unavailableReason, "authority_invalid");
    assert.equal(status.replica, null); assert.equal(status.pending, null);
    result.authority = status;
    result.operations = await owned.operator.call(shared.MEMORY_OPERATION_METHODS.list, { includeTerminal: true, limit: 50 });
    result.setup = await owned.operator.call(shared.HINDSIGHT_METHODS.status);
    assert(status.hindsight?.backup, "backup inventory must remain represented in diagnostics");
    const before = owned.provider.log.length;
    try {
      const sent = await owned.operator.call(shared.CHAT_METHODS.send, { characterId: "taki", message: "[recall] copper compass" });
      result.chat = { admitted: true, sent };
      assert.fail("known-invalid authority must not admit an ordinary memory-unavailable Run");
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
      assert.equal(error.rpc?.code, -32603, "require the server's explicit admission refusal");
      assert.equal(error.rpc.message, "MEMORY_AUTHORITY_INVALID", "a transport or unrelated handler failure is not authority refusal");
      result.chat = { admitted: false, rpcCode: error.rpc.code, code: error.rpc.message };
    }
    assert.equal(owned.provider.log.length, before);
    assert.equal(owned.provider.log.length, 0, "diagnostic boot/refusal must not invoke a model");
    result.status = "passed";
  } catch (error) { result.failure = error.message; }
  finally {
    owned.operator?.close();
    if (owned.core) {
      try { result.teardown.core = await stopCore(owned.core); }
      catch (error) { result.teardown.core = { error: error.message }; }
    }
    if (owned.provider) {
      result.providerCalls = owned.provider.log.length;
      try { await owned.provider.close(); result.teardown.provider = "closed"; }
      catch (error) { result.teardown.provider = { error: error.message }; }
    }
    result.teardown.stillRunning = running(owned.core ? [owned.core.pid] : []);
    result.teardown.listeners = result.ports ? listeners([result.ports.core, result.ports.provider]) : [];
    result.sourceUnchanged = unchanged(input);
    if (result.status === "passed" && (result.teardown.core?.code !== 0 || result.teardown.core?.forced
      || result.teardown.provider !== "closed" || result.teardown.stillRunning.length || result.teardown.listeners.length || !result.sourceUnchanged)) result.status = "cleanup-failed";
    result.finishedAt = new Date().toISOString();
    json(join(root, "diagnostic-result.json"), result);
    console.log(JSON.stringify({ result: join(root, "diagnostic-result.json"), status: result.status,
      failure: result.failure, sourceUnchanged: result.sourceUnchanged, teardown: result.teardown }));
  }
  process.exitCode = result.status === "passed" ? 0 : 1;
}

if (process.argv.includes("--core-child")) await runCoreChild();
else if (process.argv[2]) await run(resolve(process.argv[2]));
else throw new Error("Usage: node diagnostic-boot-replay.mjs G:/taki-post-reentry-<fresh-prepared-copy>");
