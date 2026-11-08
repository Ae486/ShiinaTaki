/**
 * INPUT:  the stopped, generated journey15 state; current Core/Native source and controlled providers
 * OUTPUT: one fresh copied-instance ordinary recall replay, bounded CPU profile, exact outcomes and owned cleanup
 * POS:    task-only diagnostic; no original owner data, history rewriting, product fixes or paid model calls
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { registerHooks } from "node:module";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as shared from "../../../../../packages/shared/src/index.ts";
import { createLogger } from "../../../../../packages/core/src/logging/logger.ts";
import { createSecretCatalogService } from "../../../../../packages/core/src/secrets/secret-catalog-service.ts";
import { resolveMasterKeySource } from "../../../../../packages/core/src/secrets/master-key.ts";
import { bootCore, openOperator, runCoreChild, stopCore } from "./smoke-core.mjs";
import { awaitNativeHealth, descendants, freePort, listeners, nativeCalls, nativeEgress, removePg0, running, spawnNative, startPg0, stopNative } from "./smoke-native.mjs";
import { startFakeProvider } from "../../../archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs";
import { installQuiescenceProbe, probeBackupAfterRecall } from "./backup-quiescence-probe.mjs";
import { startMaintenanceObservation } from "./maintenance-observation.mjs";
import { metadataReplay, spawnObservedNative, startObservedProvider } from "./maintenance-observation-adapters.mjs";

const SOURCE = "G:/taki-first-use-9LeODa";
const SOURCE_RESULT = fileURLToPath(new URL("./results/2026-11-05T13-51-32.888Z/result.json", import.meta.url));
const SCRIPT = fileURLToPath(import.meta.url);
const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const PYTHON = "H:/hindsight/.venv/Scripts/python.exe";
const PG0 = "H:/hindsight/.venv/Lib/site-packages/pg0/bin/pg0.exe";
const CHAT_MS = 180_000;
const PROFILE_MS = 60_000;
const OBSERVE_MAINTENANCE = process.argv.includes("--observe-maintenance");
const EXPECTED = "The user said: My isolated roundtrip keeps a copper compass.";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const json = (path, value) => writeFileSync(path, JSON.stringify(OBSERVE_MAINTENANCE && path.endsWith("replay-result.json") ? metadataReplay(value) : value, null, 2), "utf8");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function installProviderFailureTrace() {
  // Observe the existing error adapter on this generated-data replay only; do not change its returned category.
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/hindsight-memory-provider-context.ts")) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const anchor = "const code = hindsightMemoryErrorCode(input.error);";
    assert(source.includes(anchor), "provider diagnostic anchor changed");
    const trace = `console.error(JSON.stringify({ diagnostic: "post-reentry-provider-failure", code,
      name: input.error instanceof Error ? input.error.name : typeof input.error,
      causeCode: input.error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(input.error.message) ? input.error.message : null,
      frames: input.error instanceof Error ? input.error.stack?.split("\\n").filter((line) => line.trimStart().startsWith("at ")) : [] }));`;
    return { ...loaded, source: source.replace(anchor, `${anchor}\n${trace}`) };
  } });
}

function sourceBaseline(cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const sources = [...new Set((git("diff", "--name-only", "HEAD") + git("ls-files", "--others", "--exclude-standard")).split(/\r?\n/))]
    .filter((name) => /^(packages\/|apps\/desktop\/src\/|hindsight-api-slim\/)/.test(name) && /\.(ts|tsx|py|json)$/.test(name));
  return { head: git("rev-parse", "HEAD").trim(), changedSource: sources.map((name) => ({ name,
    sha256: existsSync(join(cwd, name)) ? hash(join(cwd, name)) : null })) };
}

function sourceHashes() {
  const paths = [];
  const walk = (directory) => {
    for (const entry of readdirSync(join(SOURCE, directory), { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), "source fixture must not contain a symlink");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path); else paths.push(path);
    }
  };
  for (const directory of ["core-data", "credentials", "pg-data"]) walk(directory);
  return Object.fromEntries(paths.sort().map((path) => [path, hash(join(SOURCE, path))]));
}

function assertSourceStopped() {
  const info = JSON.parse(execFileSync(PG0, ["info", "--name", "taki-smoke-507093501f2f", "--output", "json"],
    { encoding: "utf8", windowsHide: true }));
  assert.equal(resolve(info.data_dir), resolve(SOURCE, "pg-data"));
  assert.equal(info.running, false);
  assert(!existsSync(join(SOURCE, "pg-data/postmaster.pid")));
  assert.deepEqual(listeners([12306, 12307, Number(info.port)]), [], "source fixture ports must be free");
  return { name: info.name, port: info.port, dataDir: info.data_dir, running: info.running };
}

function prepare() {
  const stopped = assertSourceStopped();
  const sourceBefore = sourceHashes();
  const root = mkdtempSync("G:/taki-post-reentry-");
  const dataDir = join(root, "core-data");
  mkdirSync(dataDir);
  mkdirSync(join(root, "credentials"));
  mkdirSync(join(root, "sqlite-input"));
  // Copy WAL with its database, then use SQLite backup on the copy so even SHM updates cannot touch the source.
  for (const name of ["taki.db", "taki.db-wal", "taki.db-shm"]) {
    if (existsSync(join(SOURCE, "core-data", name))) copyFileSync(join(SOURCE, "core-data", name), join(root, "sqlite-input", name));
  }
  for (const entry of readdirSync(join(SOURCE, "core-data"))) {
    if (!entry.startsWith("taki.db")) cpSync(join(SOURCE, "core-data", entry), join(dataDir, entry), { recursive: true, errorOnExist: true, force: false });
  }
  copyFileSync(join(SOURCE, "credentials/taki-secret-catalog-master-key"), join(root, "credentials/taki-secret-catalog-master-key"));
  const backup = ["import sqlite3,sys,pathlib,json", "source=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
    "target=sqlite3.connect(sys.argv[2])", "source.backup(target)", "print(json.dumps({'sourceMode':'ro','backup':'sqlite3.Connection.backup','integrity':target.execute('PRAGMA integrity_check').fetchone()[0]}))",
    "target.close()", "source.close()"].join("\n");
  const sqlite = JSON.parse(execFileSync(PYTHON, ["-c", backup, join(root, "sqlite-input/taki.db"), join(dataDir, "taki.db")], { encoding: "utf8", windowsHide: true }));
  assert.equal(sqlite.integrity, "ok");
  cpSync(join(SOURCE, "pg-data"), join(root, "pg-data"), { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(sourceHashes(), sourceBefore, "source changed during preparation");
  const original = JSON.parse(readFileSync(SOURCE_RESULT, "utf8"));
  const authority = original.steps.at(-1).observed.authority;
  assert.equal(authority.mode, "hindsight");
  const manifest = { root, source: SOURCE, sourceResult: SOURCE_RESULT, sourceBefore, stopped, sqlite, authority, preparedAt: new Date().toISOString() };
  json(join(root, "replay-input.json"), manifest);
  console.log(JSON.stringify({ prepared: root, core: dataDir, pg: join(root, "pg-data"), credentials: join(root, "credentials"), nativePort: 12306, sqlite }));
}

async function openProfiler(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) }).then((reply) => reply.json());
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await once(socket, "open", { signal: AbortSignal.timeout(10_000) });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const frame = JSON.parse(String(data));
    const request = pending.get(frame.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(frame.id);
    if (frame.error) request.reject(new Error(JSON.stringify(frame.error))); else request.resolve(frame.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector deadline: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  let beforeStart;
  let afterStart;
  try {
    await call("Profiler.enable");
    await call("Profiler.setSamplingInterval", { interval: 1_000 });
    beforeStart = Date.now();
    await call("Profiler.start");
    afterStart = Date.now();
  } catch (error) { socket.close(); throw error; }
  return { call, close: () => socket.close(), started: { before: beforeStart, after: afterStart } };
}

function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const key = (id) => { const frame = nodes.get(id).callFrame; return JSON.stringify([frame.functionName, frame.url, frame.lineNumber + 1]); };
  const self = new Map();
  const inclusive = new Map();
  for (const id of profile.samples ?? []) {
    self.set(key(id), (self.get(key(id)) ?? 0) + 1);
    const seen = new Set();
    for (let ancestor = id; ancestor; ancestor = parents.get(ancestor)) {
      if (nodes.get(ancestor).callFrame.url.includes("/packages/core/src/memory/")) seen.add(key(ancestor));
    }
    for (const frame of seen) inclusive.set(frame, (inclusive.get(frame) ?? 0) + 1);
  }
  const top = (counts) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([frame, samples]) => ({
    frame: JSON.parse(frame), samples, percent: Math.round(samples / profile.samples.length * 1_000) / 10 }));
  return { durationMs: (profile.endTime - profile.startTime) / 1_000, samples: profile.samples?.length ?? 0,
    self: top(self), memoryInclusive: top(inclusive) };
}

async function recall(operator, observed, observation) {
  const started = Date.now();
  observed.startedAt = new Date(started).toISOString();
  observation?.submit();
  try {
    // Preserve native-smoke chat() budgets and order, but retain each completed boundary on failure.
    const sent = shared.ChatSendResultSchema.parse(await operator.call(shared.CHAT_METHODS.send, { characterId: "taki", message: "[recall] copper compass" }, CHAT_MS));
    Object.assign(observed, sent, { ackMs: Date.now() - started });
    console.log(JSON.stringify({ boundary: "chat-admitted", ackMs: observed.ackMs }));
    const note = await operator.waitNotification((entry) => [shared.CHAT_METHODS.complete, shared.CHAT_METHODS.error].includes(entry.method)
      && entry.params?.messageId === sent.messageId, CHAT_MS);
    observed.outcome = note.method;
    if (observation) { observed.completedAt = note.at; observation.chatComplete(note.at); }
    observed.notificationMs = Date.now() - started;
    console.log(JSON.stringify({ boundary: observed.outcome, notificationMs: observed.notificationMs }));
    observed.error = note.method === shared.CHAT_METHODS.error ? { code: note.params.code, message: note.params.message } : null;
    for (const deadline = Date.now() + CHAT_MS; Date.now() < deadline; await sleep(200)) {
      observed.run = shared.RunStatusResultSchema.parse(await operator.call(shared.RUN_METHODS.status, { runId: sent.runId })).run;
      if (["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(observed.run.state)) break;
    }
  } finally {
    observed.totalMs = Date.now() - started;
    observed.reply = operator.notifications.filter((entry) => entry.method === shared.CHAT_METHODS.delta && entry.params?.messageId === observed.messageId)
      .map((entry) => entry.params.delta).join("");
  }
}

function checkMemory(provider, observed, epochId) {
  assert.equal(observed.outcome, shared.CHAT_METHODS.complete, "memory chat did not complete");
  assert.equal(observed.run?.state, "completed", "memory Run did not settle successfully");
  const calls = provider.log.slice(observed.providerOffset ?? 0).filter((entry) => entry.kind === "main-after-tool");
  assert.equal(calls.length, 1, "memory chat must produce exactly one tool result; generic text is failure");
  const text = calls[0].toolResult;
  assert.equal(typeof text, "string");
  const result = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
  observed.toolResult = result;
  assert.equal(result.ok, true); assert.equal(result.providerId, "hindsight"); assert.equal(result.authorityEpochId, epochId);
  assert.equal(result.data.partial, false);
  observed.exactMatches = result.data.hits.filter((hit) => hit.record.unit.text === EXPECTED).length;
  assert.equal(observed.exactMatches, 1, "recall must return the preserved fact exactly once");
}

async function run(root) {
  assert(resolve(root).startsWith(resolve("G:/taki-post-reentry-")), "only a fresh prepared owned replay root is accepted");
  const input = JSON.parse(readFileSync(join(root, "replay-input.json"), "utf8"));
  assert.equal(resolve(root), resolve(input.root));
  assert(!existsSync(join(root, "replay-result.json")), "never reuse a mutated replay clone");
  assertSourceStopped(); assert.deepEqual(sourceHashes(), input.sourceBefore);
  const dataDir = join(root, "core-data");
  const credentialsDir = join(root, "credentials");
  const ctx = { ownedPids: [] };
  const result = { root, source: SOURCE, startedAt: new Date().toISOString(), status: "fixture-failed", phase: "bootstrap", chat: {}, teardown: {} };
  json(join(root, "replay-result.json"), result);
  let sampling;
  let observation;
  try {
    const { hostId } = JSON.parse(readFileSync(join(dataDir, "host-identity.json"), "utf8"));
    const catalog = await createSecretCatalogService({ filePath: join(dataDir, "secret-catalog.bin"), storeId: hostId,
      keySource: resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: credentialsDir }), logger: createLogger("silent") });
    const apiKey = catalog.resolve("memory.hindsight.connection.api-key");
    assert.equal(catalog.health(), "ok"); assert(apiKey, "copied generated Native key unavailable");
    ctx.provider = await (OBSERVE_MAINTENANCE ? startObservedProvider : startFakeProvider)({ watch: ["copper compass"], toolResultLimit: 1_048_576 });
    const ports = { provider: ctx.provider.port, native: 12306 };
    ports.core = await freePort(Object.values(ports)); ports.pg = await freePort(Object.values(ports)); ports.inspector = await freePort(Object.values(ports));
    assert.deepEqual(listeners([ports.native, ports.core, ports.pg, ports.inspector]), []);
    result.ports = ports;
    result.build = { node: process.version, harnessSha256: hash(SCRIPT),
      quiescenceProbeSha256: hash(fileURLToPath(new URL("./backup-quiescence-probe.mjs", import.meta.url))),
      providerFailureTrace: "closed-code-and-stack-only",
      taki: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY, encoding: "utf8" }).trim(),
      native: execFileSync("git", ["rev-parse", "HEAD"], { cwd: "H:/hindsight", encoding: "utf8" }).trim() };
    result.build.currentSource = { taki: sourceBaseline(REPOSITORY), native: sourceBaseline("H:/hindsight") };
    if (OBSERVE_MAINTENANCE) result.build.observation = Object.fromEntries([
      "maintenance-observation.mjs", "maintenance-observation-child.mjs", "maintenance-observation-adapters.mjs",
      "maintenance-native-launcher.py", "analyze-maintenance.mjs", "maintenance-profile-analysis.mjs", "maintenance-journal.mjs",
    ].map((name) => [name, hash(fileURLToPath(new URL(name, import.meta.url)))]));
    const baseline = JSON.parse(readFileSync(SOURCE_RESULT, "utf8")).baseline;
    result.build.sourceComparedWithJourney15 = Object.fromEntries([["taki", REPOSITORY], ["native", "H:/hindsight"]].map(([name, directory]) =>
      [name, baseline[name].changedSource.map((entry) => ({ name: entry.name, sha256: hash(join(directory, entry.name)),
        matches: hash(join(directory, entry.name)) === entry.sha256 }))]));
    json(join(root, "replay-result.json"), result);
    console.log(JSON.stringify({ heavyRun: "one copied-instance replay", root, dataDir, credentialsDir, pgData: join(root, "pg-data"), ports }));
    if (process.argv.includes("--wait-start")) {
      assert.equal(String((await once(process.stdin, "data"))[0]).trim(), "start", "explicit harness start token required");
      process.stdin.pause();
    }
    ctx.pg = startPg0(root, ports.pg);
    result.pg = { name: ctx.pg.name, dataDir: ctx.pg.dataDir, ...ctx.pg.info };
    for (const listener of listeners([ports.pg])) ctx.ownedPids.push(listener.pid, ...descendants(listener.pid).map((entry) => entry.pid));
    ctx.native = OBSERVE_MAINTENANCE
      ? await spawnObservedNative({ root, pgPort: ctx.pg.port, port: ports.native, apiKey })
      : spawnNative({ root, pgPort: ctx.pg.port, port: ports.native, apiKey });
    ctx.ownedPids.push(ctx.native.pid);
    await awaitNativeHealth(ctx.native);
    ctx.ownedPids.push(...descendants(ctx.native.pid).map((entry) => entry.pid));
    const coreScript = OBSERVE_MAINTENANCE ? fileURLToPath(new URL("./maintenance-observation-child.mjs", import.meta.url)) : SCRIPT;
    ctx.core = await bootCore({ script: coreScript, dataDir, credentialsDir, port: ports.core, providerPort: ports.provider,
      nativePort: ports.native, inspectorPort: ports.inspector, logFile: join(root, "core.log") });
    ctx.ownedPids.push(ctx.core.pid);
    if (!OBSERVE_MAINTENANCE) {
      ctx.profiler = await openProfiler(ports.inspector);
      sampling = (async () => {
        await sleep(PROFILE_MS);
        try {
          const { profile } = await ctx.profiler.call("Profiler.stop");
          json(join(root, "recall.cpuprofile"), profile);
          result.profile = summarizeProfile(profile);
          console.log(JSON.stringify({ profileSaved: join(root, "recall.cpuprofile"), samples: result.profile.samples }));
        } catch (error) { result.profileError = error.message; }
        finally { ctx.profiler.close(); }
      })();
    }
    ctx.operator = await openOperator(ports.core, "post-reentry copied replay");
    if (OBSERVE_MAINTENANCE) {
      ctx.profiler = await openProfiler(ports.inspector);
      observation = await startMaintenanceObservation({ root, core: ctx.core, profiler: ctx.profiler });
    }
    result.phase = "ordinary-chat";
    result.chat.providerOffset = ctx.provider.log.length;
    console.log("[replay] ordinary copper-compass recall started");
    try { await recall(ctx.operator, result.chat, observation); } catch (error) { result.chat.failure = error.message; }
    try { checkMemory(ctx.provider, result.chat, input.authority.epochId); } catch (error) { result.memoryFailure = error.message; }
    result.status = result.chat.failure || result.memoryFailure ? "product-failed" : "passed";
    console.log(JSON.stringify({ boundary: "recall-checked", status: result.status, totalMs: result.chat.totalMs,
      failure: OBSERVE_MAINTENANCE ? (result.status === "passed" ? null : "RECALL_FAILED") : result.chat.failure ?? result.memoryFailure ?? null }));
    if (observation) {
      result.maintenance = await observation.finish();
      if (result.maintenance.status !== "fence-free" || result.maintenance.profileError || result.maintenance.eventLoop.incomplete) result.status = "observation-incomplete";
    }
    if ((OBSERVE_MAINTENANCE || process.argv.includes("--with-backup")) && result.status === "passed") {
      result.phase = "backup-after-recall"; result.status = "backup-failed"; result.backup = {};
      await probeBackupAfterRecall({ operator: ctx.operator, core: ctx.core, epochId: input.authority.epochId, observed: result.backup,
        firstAttemptOnly: OBSERVE_MAINTENANCE });
      result.status = "passed";
    }
  } catch (error) {
    if (error.ownedPg) ctx.pg = error.ownedPg;
    result.failure = error.message;
  } finally {
    if (observation && !result.maintenance) result.maintenance = await observation.finish();
    if (sampling) await sampling;
    ctx.profiler?.close(); ctx.operator?.close();
    const attempt = async (key, action) => { try { result.teardown[key] = await action(); } catch (error) { result.teardown[key] = { error: error.message }; } };
    if (ctx.core) await attempt("core", () => stopCore(ctx.core));
    if (ctx.native) await attempt("native", () => stopNative(ctx.native));
    if (ctx.pg) await attempt("pg", () => removePg0(ctx.pg, { retain: true }));
    if (ctx.provider) { result.provider = ctx.provider.log; await attempt("provider", async () => { await ctx.provider.close(); return "closed"; }); }
    result.nativeCalls = ctx.native && !OBSERVE_MAINTENANCE ? nativeCalls(ctx.native) : null;
    result.nativeEgress = ctx.native ? nativeEgress(ctx.native) : null;
    result.teardown.ownedPids = [...new Set(ctx.ownedPids)];
    result.teardown.stillRunning = running(result.teardown.ownedPids);
    result.teardown.listeners = result.ports ? listeners(Object.values(result.ports)) : [];
    result.sourceUnchanged = JSON.stringify(sourceHashes()) === JSON.stringify(input.sourceBefore);
    if (result.status === "passed" && (result.teardown.core?.code !== 0 || result.teardown.core?.forced
      || result.teardown.native?.code !== 0 || result.teardown.native?.forced || result.teardown.pg?.stopExit !== 0
      || result.teardown.pg?.running !== false || result.teardown.provider !== "closed")) result.status = "cleanup-failed";
    result.finishedAt = new Date().toISOString();
    json(join(root, "replay-result.json"), result);
    console.log(JSON.stringify({ result: join(root, "replay-result.json"), status: result.status,
      chat: OBSERVE_MAINTENANCE ? metadataReplay(result).chat : result.chat,
      memoryFailure: OBSERVE_MAINTENANCE ? metadataReplay(result).memoryFailure : result.memoryFailure,
      sourceUnchanged: result.sourceUnchanged, teardown: result.teardown }));
  }
  process.exitCode = result.status === "passed" && result.sourceUnchanged && result.teardown.stillRunning.length === 0 && result.teardown.listeners.length === 0 ? 0 : 1;
}

if (process.argv.includes("--core-child")) { installProviderFailureTrace(); installQuiescenceProbe({ observeMaintenance: OBSERVE_MAINTENANCE }); await runCoreChild(); }
else if (process.argv[2] === "--check-quiescence-probe") {
  installQuiescenceProbe();
  const { createCanonicalLocalWriteFence } = await import("../../../../../packages/core/src/memory/canonical-local-write-fence.ts");
  const fence = createCanonicalLocalWriteFence(); let release;
  const work = fence.admit(() => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(fence.quiesce({ timeoutMs: 5 }), { message: "MEMORY_QUIESCENCE_TIMEOUT" });
  release(); await work; await fence.quiesce({ timeoutMs: 5 }); fence.release();
  assert.equal(fence.writable(), true);
}
else if (process.argv[2] === "--check-provider-trace") {
  installProviderFailureTrace();
  const { hindsightProviderError } = await import("../../../../../packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts");
  const result = hindsightProviderError({ context: { requestId: "trace-check", authorityEpochId: "trace-check" },
    capabilities: null, error: new Error("HINDSIGHT_TIMEOUT") });
  assert.equal(result.ok, false); assert.equal(result.error.code, "MEMORY_PROVIDER_UNAVAILABLE");
  console.log("provider failure trace preserved the existing error result");
}
else if (process.argv[2] === "--prepare") prepare();
else if (process.argv[2] === "--run" && process.argv[3]) await run(process.argv[3]);
else if (process.argv[2] === "--summarize" && process.argv[3]) {
  const summary = summarizeProfile(JSON.parse(readFileSync(process.argv[3], "utf8")));
  json(`${process.argv[3]}.summary.json`, summary);
  console.log(JSON.stringify(summary));
}
else throw new Error("Usage: node post-reentry-replay.mjs --prepare | --run G:/taki-post-reentry-<fresh-clone> [--observe-maintenance]");
