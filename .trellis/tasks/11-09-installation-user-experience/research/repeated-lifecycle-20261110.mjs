/** Isolated production-Core lifecycle observation, with a deterministic loopback provider. */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect as connectTcp } from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createMemoryStore } from "../../../../packages/core/src/memory/store.ts";
import { childEnv, getFreePort, killTree } from "../../../../e2e/src/fixture/procs.ts";
import { captureLines, jsonLine } from "../../../../e2e/src/fixture/line-buffer.ts";
import { openRpcSocket } from "../../../../e2e/src/fixture/rpc-socket.ts";
import { startScriptedProvider } from "../../../../e2e/src/fixture/scripted-provider.ts";

const root = process.cwd();
const mode = process.argv[2] ?? "chat-and-configuration";
assert.ok(["chat-and-configuration", "configuration-only"].includes(mode), "unsupported fixture mode");
const configurationOnly = mode === "configuration-only";
const measuredCycles = configurationOnly ? 90 : 30;
const blockSize = measuredCycles / 3;
const output = `G:/taki-native-flow-artifacts-20261110/repeated-lifecycle/${randomUUID()}`;
const dataDir = join(output, "profile");
mkdirSync(dataDir, { recursive: true });
createMemoryStore({ root: join(dataDir, "workspace", "memory") })
  .write({ layer: "profile", content: "The lifecycle fixture prefers quiet local tests.", importance: 5 });
const control = join(output, "sample-control.mjs");
writeFileSync(control, `process.on('message', (message) => {
  if (message.kind === 'sample') process.send({ id: message.id, cpu: process.cpuUsage(),
    memory: process.memoryUsage(), resources: process.getActiveResourcesInfo() });
  if (message.kind === 'stop') { process.disconnect(); process.emit('SIGTERM', 'SIGTERM'); }
});\n`);

const evidence = {
  capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  output, mode, measuredCycles, scenarios: [], resourceSamples: [], idleWindows: [], iterations: [],
  limits: ["One isolated process and synthetic provider; no real-provider or native UI claim.",
    "Public getActiveResourcesInfo lists event-loop-retaining resource types, not all timers or JS references.",
    "No forced GC; heap/RSS fluctuations include allocator state and, in the chat cohort, accumulated history.",
    "Stable samples and retired-port refusal do not prove universal absence of leaks."],
};
const provider = await startScriptedProvider(() => ({ text: "Local lifecycle probe completed." }));
const firstPort = await getFreePort();
let otherPort = await getFreePort();
while (otherPort === firstPort) otherPort = await getFreePort();
let currentPort = firstPort;
const child = spawn(process.execPath, ["--import", pathToFileURL(control).href, "src/main.ts"], {
  cwd: join(root, "packages/core"), windowsHide: true,
  env: childEnv({ TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(firstPort),
    TAKI_LOG_LEVEL: "info", TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_SECRET_KEY_HELPER: "",
    TAKI_CREDENTIALS_DIRECTORY: join(dataDir, "absent-credentials"), CREDENTIALS_DIRECTORY: "",
    TAKI_HINDSIGHT_ENABLED: "false", TAKI_INITIATIVE_ENABLED: "false", TAKI_AMBIENT_SCREENSHOT: "false",
    TAKI_PROVIDER_CONTEXT_TOKENS: "128000", NODE_OPTIONS: "", NODE_ENV: "production" }),
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
const core = { child, stdout: captureLines(child.stdout), stderr: captureLines(child.stderr),
  exited: new Promise(resolve => child.once("close", resolve)) };
const deviceId = randomUUID();
let token;
let socket;
let initialDeviceHash;
const started = performance.now();

try {
  await core.stdout.waitFor(line => jsonLine(line)?.msg === "ws server listening", 30_000);
  evidence.pid = child.pid;
  evidence.startupMs = performance.now() - started;
  evidence.startupProviderCalls = provider.requests.length;
  assert.equal(evidence.startupProviderCalls, 0);
  socket = await connect(firstPort);
  initialDeviceHash = deviceHash();
  await applyProfile("utility", { mode: "disabled", baseUrl: "", model: "", auth: "none" });

  for (let index = 0; index < 3; index += 1) await cycle(index, true);
  await delay(6000);
  await sample("warmup-settled");
  await idleWindow("before", 30_000);
  for (let index = 0; index < measuredCycles; index += 1) {
    await cycle(index + 3, false);
    if ((index + 1) % blockSize !== 0) continue;
    await delay(6000);
    await sample(`after-${index + 1}-cycles`);
    persist();
    console.log(JSON.stringify({ phase: "cycle-block", completed: index + 1, output }));
  }
  await idleWindow("after", 30_000);
  assert.equal(deviceHash(), initialDeviceHash, "device identity/token storage changed during rebinds");
  evidence.deviceStorageUnchanged = true;
  evidence.providerRequests = provider.requests.map(request => ({ model: request.model, stream: request.stream }));
  assert.equal(evidence.providerRequests.length, configurationOnly ? 0 : measuredCycles + 3);
  assert.equal(provider.errors.length, 0);
  await assertIdle();
  evidence.scenarios = ["keyless-activation-and-model-switch",
    configurationOnly ? "configuration-does-not-dispatch-model" : "same-character-successive-runs",
    "duplicate-subscribe-single-notification", "stoplist-applied-after-each-rebuild",
    "listener-replacement-and-retired-port-refusal", "stable-identity-across-reconnects",
    "idle-run-and-maintenance-queues-after-cycles"];
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.failure = error instanceof Error ? error.message : String(error);
  evidence.failureStack = error instanceof Error ? error.stack : undefined;
  process.exitCode = 1;
} finally {
  socket?.close();
  if (child.connected) child.send({ kind: "stop" });
  let forced = false;
  const timer = setTimeout(() => { forced = true; killTree(core); }, 10_000);
  await core.exited;
  clearTimeout(timer);
  await provider.close();
  evidence.teardown = { forced, exitCode: child.exitCode, signal: child.signalCode,
    firstPortOpen: await portOpen(firstPort), otherPortOpen: await portOpen(otherPort) };
  if (forced || evidence.teardown.firstPortOpen || evidence.teardown.otherPortOpen || child.exitCode !== 0) {
    evidence.status = "failed";
    evidence.teardownFailure = true;
    process.exitCode = 1;
  }
  evidence.elapsedMs = performance.now() - started;
  writeFileSync(join(output, "core.stdout.log"), core.stdout.lines().join("\n") + "\n");
  writeFileSync(join(output, "core.stderr.log"), core.stderr.lines().join("\n") + "\n");
  persist();
  console.log(JSON.stringify({ status: evidence.status, output, elapsedMs: evidence.elapsedMs,
    measuredCycles: evidence.iterations.filter(row => !row.warmup).length, teardown: evidence.teardown,
    failure: evidence.failure }));
}

async function cycle(index, warmup) {
  const model = `lifecycle-model-${index % 2 === 0 ? "a" : "b"}`;
  const startedAt = performance.now();
  const beforeNotes = countNotes("config.modelProfilesChanged");
  const saved = await applyProfile("main", { mode: "configured", baseUrl: provider.baseUrl, model, auth: "none" });
  assert.equal(saved.active.model, model);
  assert.equal(countNotes("config.modelProfilesChanged") - beforeNotes, 1);
  const applyMs = performance.now() - startedAt;
  const priorRequests = provider.requests.length;
  const chatMs = configurationOnly ? null : await sendChat(index, model);
  assert.equal(provider.requests.length, priorRequests + (configurationOnly ? 0 : 1));

  const maxSteps = index % 2 === 0 ? 8 : 9;
  const scalarNotes = countNotes("config.changed", "TAKI_MAX_STEPS");
  await rpc("config.set", { key: "TAKI_MAX_STEPS", value: maxSteps });
  const scalarNotifications = countNotes("config.changed", "TAKI_MAX_STEPS") - scalarNotes;
  const stoplist = index % 2 === 0 ? "off" : "on";
  const searchStarted = performance.now();
  await rpc("config.set", { key: "TAKI_MEMORY_STOPLIST", value: stoplist });
  await until(async () => (await entries()).find(row => row.key === "TAKI_MEMORY_STOPLIST")
    ?.application.activeValue === stoplist);
  const indexMs = performance.now() - searchStarted;

  const oldPort = currentPort;
  const nextPort = currentPort === firstPort ? otherPort : firstPort;
  const rebindStarted = performance.now();
  await rpc("config.set", { key: "TAKI_WS_PORT", value: nextPort });
  socket.close();
  socket = undefined;
  await until(async () => {
    try { socket = await connect(nextPort); return true; } catch { return false; }
  });
  currentPort = nextPort;
  await until(async () => (await entries()).find(row => row.key === "TAKI_WS_PORT")?.application.state === "applied");
  await until(async () => !(await portOpen(oldPort)));
  assert.equal((await entries()).find(row => row.key === "TAKI_MAX_STEPS")?.application.activeValue, maxSteps);
  await assertIdle();
  evidence.iterations.push({ index, warmup, model, applyMs, chatMs, indexMs, scalarNotifications,
    reconnectMs: performance.now() - rebindStarted, totalMs: performance.now() - startedAt });
}

async function sendChat(index, model) {
  const chatStarted = performance.now();
  const chat = await rpc("chat.send", { characterId: "taki", message: `Synthetic lifecycle iteration ${index}.` });
  const completed = await socket.waitForNotification(note => ["chat.complete", "chat.error"].includes(note.method)
    && note.params?.messageId === chat.messageId);
  assert.equal(completed.method, "chat.complete");
  assert.equal(provider.requests.at(-1).model, model);
  return performance.now() - chatStarted;
}

async function connect(port) {
  const client = await openRpcSocket(`ws://127.0.0.1:${port}`);
  const response = await client.request("connect", { deviceId, deviceName: "Repeated lifecycle fixture",
    role: "operator", capabilities: [], ...(token ? { token } : {}) });
  if (response.error) { client.close(); throw new Error(`connect failed: ${response.error.code}`); }
  token ??= response.result.token;
  assert.ok(token, "fixture token not issued");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const method of ["config.subscribe", "config.modelProfilesSubscribe"]) {
      const subscribed = await client.request(method, {});
      assert.ok(!subscribed.error, `${method} rejected`);
    }
  }
  return client;
}

async function applyProfile(slot, profile) {
  const before = (await rpc("config.modelProfiles", {})).profiles.find(row => row.slot === slot);
  const saved = await rpc("config.modelProfileSave", { slot, expectedRevision: before.revision, action: "apply", profile });
  const current = saved.profiles.find(row => row.slot === slot);
  assert.equal(current.applicationState, "applied");
  return current;
}

async function rpc(method, params) {
  const response = await socket.request(method, params);
  assert.ok(!response.error, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}

async function entries() { return (await rpc("config.list", {})).entries; }

function countNotes(method, key) {
  return socket.notifications().filter(note => note.method === method && (key === undefined || note.params?.key === key)).length;
}

async function assertIdle() {
  await until(async () => {
    const queue = await rpc("run.queue", { limit: 100 });
    const operations = await rpc("memory.operations.list", { includeTerminal: false, limit: 50 });
    return queue.entries.length === 0 && !queue.nextCursor && operations.operations.length === 0;
  });
}

async function sample(label) {
  const id = randomUUID();
  const values = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.off("message", receive); reject(new Error("sample deadline")); }, 5000);
    function receive(message) {
      if (message.id !== id) return;
      clearTimeout(timeout); child.off("message", receive); resolve(message);
    }
    child.on("message", receive); child.send({ kind: "sample", id });
  });
  const resourceCounts = {};
  for (const type of values.resources) resourceCounts[type] = (resourceCounts[type] ?? 0) + 1;
  const row = { label, elapsedMs: performance.now() - started, cpu: values.cpu, memory: values.memory, resourceCounts };
  evidence.resourceSamples.push(row);
  return row;
}

async function idleWindow(label, durationMs) {
  const before = await sample(`${label}-idle-start`);
  for (let index = 1; index <= 3; index += 1) {
    await delay(durationMs / 3);
    await sample(`${label}-idle-${index}`);
  }
  const after = evidence.resourceSamples.at(-1);
  evidence.idleWindows.push({ label, wallMs: after.elapsedMs - before.elapsedMs,
    cpuMs: (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000,
    rssBefore: before.memory.rss, rssAfter: after.memory.rss,
    heapUsedBefore: before.memory.heapUsed, heapUsedAfter: after.memory.heapUsed });
}

async function until(check) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error("observation deadline exceeded");
}

function portOpen(port) {
  return new Promise(resolve => {
    const client = connectTcp({ host: "127.0.0.1", port });
    let settled = false;
    const finish = value => { if (settled) return; settled = true; client.destroy(); resolve(value); };
    client.setTimeout(1000, () => finish(true));
    client.once("connect", () => finish(true));
    client.once("error", error => {
      if (error.code !== "ECONNREFUSED") evidence.unexpectedPortError = error.code;
      finish(error.code !== "ECONNREFUSED");
    });
  });
}

function deviceHash() { return createHash("sha256").update(readFileSync(join(dataDir, "devices.json"))).digest("hex"); }
function persist() { writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n"); }
