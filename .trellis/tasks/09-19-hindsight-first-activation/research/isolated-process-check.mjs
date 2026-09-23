/**
 * INPUT:  the current checkout and a fresh temporary directory; no private configuration, provider fetches blocked
 * OUTPUT: real Core boot on a free non-default port: migrations through the head, operator authentication,
 *         memory.activation.status + memory.authority.status answered, hindsight.activate registered (refused, not unknown),
 *         SIGINT clean exit; retained isolated evidence (logs + result.json)
 * POS:    Stage 2b wave B acceptance harness — never opens user storage, never contacts a model or Hindsight
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as shared from "../../../../packages/shared/src/index.ts";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const script = fileURLToPath(import.meta.url);
const budgetMs = 30_000;
const DEFAULT_PORT = 8974;

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
  for (;;) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (port !== DEFAULT_PORT) return port;
  }
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
  return { child, port, save, log: () => output, pid: child.pid };
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
  let exit;
  try {
    const [code, signal] = await exited;
    exit = { code, signal };
    assert.equal(signal, null, "shutdown must not need forced termination");
    assert.equal(code, 0, "Core shutdown must complete successfully");
  } finally {
    clearTimeout(timer);
    await instance.save();
  }
  if (probeError) throw probeError;
  assert.match(instance.log(), /ws server listening/, "real transport must be listening");
  assert.equal(attempts, 0, "no model/provider invocation is permitted");
  return exit;
}

async function openOperator(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const frame = JSON.parse(String(data));
    if (frame.id === undefined) return;
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    if (frame.error) request.reject(Object.assign(new Error(JSON.stringify(frame.error)), { rpc: frame.error })); else request.resolve(frame.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("WS closed")); }
    pending.clear();
  });
  await once(socket, "open", { signal: AbortSignal.timeout(budgetMs) });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC deadline: ${method}`)); }, budgetMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  shared.ConnectResultSchema.parse(await call("connect", { deviceId: randomUUID(), deviceName: "S2b isolated acceptance", role: "operator" }));
  return { call, socket };
}

async function journey(operator) {
  const activation = shared.MemoryActivationStatusSchema.parse(await operator.call(shared.MEMORY_ACTIVATION_METHODS.status, {}));
  assert.equal(activation.authority.mode, "legacy-markdown");
  assert.equal(activation.run, null);
  assert.deepEqual(activation.actions, { activate: false, resume: false, recoverBinding: false, cancelOperationId: null });
  const authority = shared.MemoryAuthorityStatusSchema.parse(await operator.call(shared.MEMORY_AUTHORITY_METHODS.status, {}));
  assert.equal(authority.authority.mode, "legacy-markdown");
  assert.equal(authority.runtime.available, true);
  // A registered kind refuses at admission (closed reason); an unregistered one would fail request validation instead.
  const request = { kind: "hindsight.activate", source: { mode: "new", setupRevision: 0, expectedEpochId: "no-such-epoch" } };
  const refusal = await operator.call(shared.MEMORY_OPERATION_METHODS.submit, { request }).then(() => null, (error) => error.rpc);
  assert(refusal, "wrong-marker activation must be refused");
  assert.equal(refusal.data?.code, "MEMORY_OPERATION_REFUSED", JSON.stringify(refusal));
  assert.equal(refusal.data?.details?.reason ?? refusal.data?.reason, "MEMORY_OPERATION_UNSUPPORTED", JSON.stringify(refusal));
  const after = shared.MemoryActivationStatusSchema.parse(await operator.call(shared.MEMORY_ACTIVATION_METHODS.status, {}));
  assert.equal(after.operation, null, "a refused submit leaves no row");
  return { activation, authority, refusal };
}

async function runAcceptance() {
  const dataDir = await mkdtemp(join(tmpdir(), "taki-s2b-process-"));
  console.log(`Isolated evidence: ${dataDir}`);
  const instance = await boot(dataDir, "boot");
  let operator; let evidence; let exit;
  try {
    operator = await openOperator(instance.port);
    evidence = await journey(operator);
  } finally {
    operator?.socket.close();
    exit = await stop(instance);
  }
  const log = instance.log();
  const applied = JSON.parse(log.match(/"applied":(\[[^\]]*\])/)?.[1] ?? "[]");
  assert.equal(applied.at(-1), 49, `head migration must be applied: ${JSON.stringify(applied)}`);
  const result = { status: "passed", port: instance.port, pid: instance.pid, migrations: `${applied[0]}..${applied.at(-1)} (${applied.length})`, exit, attemptedFetches: 0,
    methodsAnswered: [shared.MEMORY_ACTIVATION_METHODS.status, shared.MEMORY_AUTHORITY_METHODS.status, shared.MEMORY_OPERATION_METHODS.submit],
    refusal: evidence.refusal };
  await writeFile(join(dataDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result));
}

if (process.argv.includes("--core-child")) await runChild(); else await runAcceptance();
