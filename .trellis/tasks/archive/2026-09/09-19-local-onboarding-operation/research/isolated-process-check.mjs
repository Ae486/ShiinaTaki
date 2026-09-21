/**
 * INPUT:  the current checkout and a fresh temporary directory; no private configuration
 * OUTPUT: real Core/WS onboarding and reopen assertions plus retained isolated evidence
 * POS:    task acceptance harness — blocks model/provider fetches; never opens user storage
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as shared from "../../../../packages/shared/src/index.ts";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const script = fileURLToPath(import.meta.url);
const terminal = new Set(shared.MEMORY_OPERATION_TERMINAL_STATES);
const budgetMs = 30_000;

async function runChild() {
  let attemptedFetches = 0;
  globalThis.fetch = async () => {
    attemptedFetches += 1;
    throw new Error("Isolated acceptance forbids model/provider fetches");
  };
  process.on("message", (message) => {
    if (message === "probe") process.send?.({ kind: "probe", attemptedFetches });
    // Exercise Core's actual shutdown handler on Windows, where kill(SIGINT) is not graceful.
    if (message === "shutdown") process.emit("SIGINT");
  });
  await import(pathToFileURL(join(repository, "packages/core/src/main.ts")).href);
  process.send?.({ kind: "ready" });
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function isolatedEnvironment(dataDir, port) {
  const allowed = new Set(["path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp"]);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
  return {
    ...environment, TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
    TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:1/v1", TAKI_PROVIDER_API_KEY: "isolated-fixture",
    TAKI_PROVIDER_MODEL: "isolated-no-model", TAKI_LOG_LEVEL: "info", TAKI_TRUST_LOOPBACK_OPERATOR: "true",
  };
}

function waitMessage(child, kind) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Core ${kind} deadline exceeded`)), budgetMs);
    const onMessage = (message) => { if (message?.kind === kind) finish(null, message); };
    const onExit = (code, signal) => finish(new Error(`Core exited before ${kind}: ${code}/${signal}`));
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", finish);
      if (error) reject(error); else resolve(value);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", finish);
  });
}

async function boot(dataDir, label) {
  const port = await freePort();
  const child = spawn(process.execPath, [script, "--core-child"], {
    cwd: dataDir, env: isolatedEnvironment(dataDir, port), windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const save = () => writeFile(join(dataDir, `${label}.log`), output, "utf8");
  try {
    await waitMessage(child, "ready");
  } catch (error) {
    const closed = once(child, "close");
    child.kill();
    await closed;
    await save();
    throw error;
  }
  return { child, port, save, log: () => output };
}

async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
    await instance.save();
    throw new Error("Core exited unexpectedly before graceful shutdown");
  }
  const probe = waitMessage(instance.child, "probe");
  instance.child.send("probe");
  let attempts;
  let probeError;
  try { attempts = (await probe).attemptedFetches; } catch (error) { probeError = error; }
  const exited = once(instance.child, "close");
  const timer = setTimeout(() => instance.child.kill(), budgetMs);
  instance.child.send("shutdown");
  try {
    const [code, signal] = await exited;
    assert.equal(signal, null, "shutdown must not need forced termination");
    assert.equal(code, 0, "Core shutdown must complete successfully");
  } finally {
    clearTimeout(timer);
    await instance.save();
  }
  if (probeError) throw probeError;
  assert.match(instance.log(), /ws server listening/, "real transport must be listening");
  assert.equal(attempts, 0, "no model/provider invocation is permitted");
}

async function openOperator(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const events = new EventEmitter();
  const pending = new Map();
  const observed = new Map();
  const notifications = [];
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const frame = JSON.parse(String(data));
    if (frame.id !== undefined) {
      const request = pending.get(frame.id);
      if (!request) return;
      pending.delete(frame.id);
      clearTimeout(request.timer);
      if (frame.error) request.reject(new Error(JSON.stringify(frame.error))); else request.resolve(frame.result);
    } else {
      notifications.push(frame.method);
      if (frame.method === shared.MEMORY_OPERATION_METHODS.changed) {
        const { operation } = shared.MemoryOperationChangedSchema.parse(frame.params);
        observed.set(operation.operationId, operation);
        events.emit("operation", operation);
      }
    }
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("WS closed")); }
    pending.clear();
    events.emit("retired");
  });
  await once(socket, "open", { signal: AbortSignal.timeout(budgetMs) });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC deadline: ${method}`)); }, budgetMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  const operator = { call, events, observed, notifications, socket };
  shared.ConnectResultSchema.parse(await call("connect", { deviceId: randomUUID(), deviceName: "S2a isolated acceptance", role: "operator" }));
  await call(shared.MEMORY_OPERATION_METHODS.subscribe, {});
  await call(shared.MEMORY_ONBOARDING_METHODS.subscribe, {});
  return operator;
}

function waitTerminal(operator, initial) {
  const current = operator.observed.get(initial.operationId) ?? initial;
  if (terminal.has(current.state)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Operation completion push deadline")), budgetMs);
    const onOperation = (operation) => {
      if (operation.operationId === initial.operationId && terminal.has(operation.state)) finish(null, operation);
    };
    const onRetired = () => finish(new Error("Client retired before completion"));
    const finish = (error, value) => {
      clearTimeout(timer);
      operator.events.off("operation", onOperation);
      operator.events.off("retired", onRetired);
      if (error) reject(error); else resolve(value);
    };
    operator.events.on("operation", onOperation);
    operator.events.once("retired", onRetired);
  });
}

async function submit(operator, request) {
  const { operation } = shared.MemoryOperationSubmitResultSchema.parse(
    await operator.call(shared.MEMORY_OPERATION_METHODS.submit, { request }),
  );
  const settled = await waitTerminal(operator, operation);
  assert.equal(settled.state, "completed", JSON.stringify(settled));
  return settled;
}

async function status(operator) {
  return shared.MemoryOnboardingStatusSchema.parse(await operator.call(shared.MEMORY_ONBOARDING_METHODS.status, {}));
}

async function firstJourney(operator) {
  const before = await status(operator);
  assert.equal(before.authority.mode, "legacy-markdown");
  assert.equal(before.run, null, "a read must not prepare or activate");
  const preview = shared.MemoryOnboardingPreviewResultSchema.parse(await operator.call(shared.MEMORY_ONBOARDING_METHODS.preview, {}));
  assert.equal((await status(operator)).run, null, "preview creates no producer");
  const prepared = await submit(operator, { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } });
  assert.equal(prepared.result?.outcome, "ready");
  const ready = await status(operator);
  assert.equal(ready.authority.mode, "legacy-markdown");
  assert.equal(ready.actions.activate, true);
  assert(ready.run);
  const activated = await submit(operator, { kind: "local.onboard.activate", runId: ready.run.runId });
  assert.equal(activated.result?.outcome, "activated");
  const active = await status(operator);
  assert.equal(active.authority.mode, "canonical-local");
  assert.equal(active.runtime.available, true);
  assert(active.run?.receipt);
  assert.equal(active.run.receipt.epochId, active.authority.epochId);
  await submit(operator, { kind: "local.onboard.activate", runId: active.run.runId });
  assert.deepEqual((await status(operator)).run?.receipt, active.run.receipt, "explicit repair cannot commit a second epoch");
  assert(operator.notifications.includes(shared.MEMORY_OPERATION_METHODS.changed));
  assert(operator.notifications.includes(shared.MEMORY_ONBOARDING_METHODS.changed));
  return active.run.receipt;
}

async function withCore(dataDir, label, action) {
  const instance = await boot(dataDir, label);
  let operator;
  try {
    operator = await openOperator(instance.port);
    return await action(operator);
  } finally {
    operator?.socket.close();
    await stop(instance);
  }
}

async function runAcceptance() {
  const dataDir = await mkdtemp(join(tmpdir(), "taki-s2a-process-"));
  console.log(`Isolated evidence: ${dataDir}`);
  const receipt = await withCore(dataDir, "first-boot", firstJourney);
  await withCore(dataDir, "reopen", async (operator) => {
    const reopened = await status(operator);
    assert.equal(reopened.authority.mode, "canonical-local");
    assert.equal(reopened.runtime.available, true);
    assert.deepEqual(reopened.run?.receipt, receipt);
    assert.equal(reopened.actions.prepare, false);
  });
  const result = { status: "passed", receipt, attemptedFetches: 0, cleanShutdowns: 2 };
  await writeFile(join(dataDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result));
}

if (process.argv.includes("--core-child")) await runChild(); else await runAcceptance();
