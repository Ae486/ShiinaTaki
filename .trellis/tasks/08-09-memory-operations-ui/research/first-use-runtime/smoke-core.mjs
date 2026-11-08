/**
 * INPUT:  a harness-owned Core data dir + credentials dir, the fake provider port and the native port
 * OUTPUT: runCoreChild() (in-process Core with a loopback-only socket guard), bootCore()/stopCore() over an IPC channel,
 *         openOperator() — a JSON-RPC operator client that also records every server notification
 * POS:    10-29-first-use-runtime (adapted from archived native-smoke) harness only; mirrors the archived Stage 2 isolated-process harness pattern
 */
import net from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lookup } from "node:dns/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as shared from "../../../../../packages/shared/src/index.ts";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const BOOT_MS = 120_000;
const RPC_MS = 60_000;

function connectTarget(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === "object") return { path: first.path, host: first.host ?? "localhost", port: Number(first.port) };
  return { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(first) };
}

/** Every Core socket (fetch/undici, node:http transport, ws) funnels through Socket#connect; refuse all non-loopback egress. */
function guardEgress(allowedPorts, modelAddress) {
  const counters = { allowed: {}, refused: [] };
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const target = connectTarget(args);
    if (typeof target.path === "string") return original.apply(this, args); // IPC/pipe, not TCP
    if ((LOOPBACK.has(target.host) && allowedPorts.includes(target.port))
      || (modelAddress?.hosts.has(target.host) && target.port === modelAddress.port)) {
      counters.allowed[target.port] = (counters.allowed[target.port] ?? 0) + 1;
      return original.apply(this, args);
    }
    counters.refused.push({ host: target.host, port: target.port, at: new Date().toISOString() });
    process.nextTick(() => this.destroy(new Error("SMOKE_EGRESS_REFUSED")));
    return this;
  };
  return counters;
}

export async function runCoreChild({ realEndpoint } = {}) {
  let modelAddress;
  if (realEndpoint) {
    const endpoint = new URL(realEndpoint);
    if (endpoint.protocol !== "https:") throw new Error("REAL_MODEL_HTTPS_REQUIRED");
    const addresses = await lookup(endpoint.hostname, { all: true });
    modelAddress = { hosts: new Set([endpoint.hostname, ...addresses.map(({ address }) => address)]), port: Number(endpoint.port || 443) };
  }
  const counters = guardEgress(process.env.TAKI_SMOKE_ALLOWED_PORTS.split(",").map(Number), modelAddress);
  process.on("message", (message) => {
    if (message === "probe") process.send?.({ kind: "probe", egress: counters });
    // Exercise Core's actual shutdown handler on Windows, where kill(SIGINT) is not graceful.
    if (message === "shutdown") process.emit("SIGINT");
  });
  await import(pathToFileURL(join(repository, "packages/core/src/main.ts")).href);
  process.send?.({ kind: "ready" });
}

function waitMessage(child, kind, budget) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Core ${kind} deadline exceeded`)), budget);
    const onMessage = (message) => { if (message?.kind === kind) finish(null, message); };
    const onExit = (code, signal) => finish(new Error(`Core exited before ${kind}: ${code}/${signal}`));
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error); else resolve(value);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

export async function bootCore({ script, dataDir, credentialsDir, port, providerPort, nativePort, logFile, inspectorPort, realModels }) {
  const allowed = new Set(["path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp"]);
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
  const provider = `http://127.0.0.1:${providerPort}/v1`;
  const env = {
    ...base, TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port), TAKI_LOG_LEVEL: "info",
    TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_CREDENTIALS_DIRECTORY: credentialsDir,
    TAKI_PROVIDER_BASE_URL: provider, TAKI_PROVIDER_API_KEY: "smoke-fixture", TAKI_PROVIDER_MODEL: "smoke-main",
    TAKI_UTILITY_BASE_URL: provider, TAKI_UTILITY_API_KEY: "smoke-fixture", TAKI_UTILITY_MODEL: "smoke-utility",
    TAKI_SMOKE_ALLOWED_PORTS: `${providerPort},${nativePort}`,
  };
  // Real-model callers install their own task-only egress/observation before runCoreChild(). Controlled defaults stay exact.
  if (realModels) Object.assign(env, {
    TAKI_PROVIDER_BASE_URL: realModels.baseUrl, TAKI_PROVIDER_API_KEY: realModels.apiKey, TAKI_PROVIDER_MODEL: realModels.model,
    TAKI_UTILITY_BASE_URL: realModels.baseUrl, TAKI_UTILITY_API_KEY: realModels.apiKey, TAKI_UTILITY_MODEL: realModels.model,
    TAKI_PROVIDER_INCLUDE_USAGE: "true", TAKI_REAL_OBSERVATIONS: realModels.observationFile,
    TAKI_REAL_ADMISSION_STOP: realModels.admissionStopFile,
    TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: "240000",
    NO_PROXY: `${new URL(realModels.baseUrl).hostname},127.0.0.1,localhost,::1`,
  });
  const profile = process.env.TAKI_FIRST_USE_CPU_PROFILE === "1" ? ["--cpu-prof", "--cpu-prof-interval=10000", `--cpu-prof-dir=${dataDir}`] : [];
  // Task-only remote sampling can stop before an unresponsive Core requires forced teardown.
  const inspector = inspectorPort === undefined ? [] : [`--inspect=127.0.0.1:${inspectorPort}`];
  const child = spawn(process.execPath, [...profile, ...inspector, script, "--core-child"], { cwd: dataDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const core = { child, port, pid: child.pid, log: () => output, save: () => writeFileSync(logFile, output, "utf8") };
  try {
    await waitMessage(child, "ready", BOOT_MS);
  } catch (error) {
    const closed = once(child, "close");
    child.kill();
    await closed;
    core.save();
    throw error;
  }
  return core;
}

export async function stopCore(core, { budgetMs = 60_000 } = {}) {
  if (core.child.exitCode !== null || core.child.signalCode !== null) {
    core.save();
    return { code: core.child.exitCode, signal: core.child.signalCode, egress: null, forced: false, unexpected: true };
  }
  const probe = waitMessage(core.child, "probe", RPC_MS);
  core.child.send("probe");
  const egress = await probe.then((message) => message.egress, () => null);
  const closed = once(core.child, "close");
  let forced = false;
  const timer = setTimeout(() => { forced = true; core.child.kill(); }, budgetMs);
  core.child.send("shutdown");
  const [code, signal] = await closed;
  clearTimeout(timer);
  core.save();
  return { code, signal, egress, forced };
}

export function appliedMigrations(core) {
  return JSON.parse(core.log().match(/"applied":(\[[^\]]*\])/)?.[1] ?? "null");
}

export async function openOperator(port, deviceName) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map();
  const notifications = [];
  const waiters = new Set();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const frame = JSON.parse(String(data));
    if (frame.id === undefined || frame.id === null) {
      const note = { method: frame.method, params: frame.params, at: Date.now() };
      notifications.push(note);
      for (const waiter of waiters) waiter(note);
      return;
    }
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    if (frame.error) request.reject(Object.assign(new Error(`${request.method}: ${JSON.stringify(frame.error)}`), { rpc: frame.error }));
    else request.resolve(frame.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("WS closed")); }
    pending.clear();
  });
  await once(socket, "open", { signal: AbortSignal.timeout(RPC_MS) });
  const call = (method, params = {}, budget = RPC_MS) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC deadline: ${method}`)); }, budget);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  const waitNotification = (predicate, budget) => new Promise((resolve, reject) => {
    const found = notifications.find(predicate);
    if (found) { resolve(found); return; }
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error("notification deadline")); }, budget);
    const check = (note) => { if (predicate(note)) { clearTimeout(timer); waiters.delete(check); resolve(note); } };
    waiters.add(check);
  });
  shared.ConnectResultSchema.parse(await call("connect", { deviceId: randomUUID(), deviceName, role: "operator" }));
  return { call, socket, notifications, waitNotification, close: () => socket.close() };
}
