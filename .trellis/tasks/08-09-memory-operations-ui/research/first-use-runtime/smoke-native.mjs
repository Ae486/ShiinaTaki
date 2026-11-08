/**
 * INPUT:  the read-only patched native checkout (H:/hindsight venv + bundled pg0), a harness-owned temp root, free ports
 * OUTPUT: owned pg0 instance start/verify/stop/remove, guarded native Hindsight start/health/stop, isolation listings
 *         (pg0 registry names, owner port comparison without disclosure, process and listener snapshots), access-log counts
 * POS:    10-29-first-use-runtime (adapted from archived native-smoke) harness only — never touches an instance, data dir or source it did not create
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HINDSIGHT_ROOT = "H:/hindsight";
const PYTHON = join(HINDSIGHT_ROOT, ".venv/Scripts/python.exe");
const PG0 = join(HINDSIGHT_ROOT, ".venv/Lib/site-packages/pg0/bin/pg0.exe");
const LAUNCHER = fileURLToPath(new URL("../../../archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py", import.meta.url));
const TIKTOKEN_SOURCE = "H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911/tokenizer-cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4";
const PG0_REGISTRY = join(homedir(), ".pg0/instances");
const DB_USER = "taki_smoke";
const OS_KEYS = ["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];

function osEnvironment() {
  const allowed = new Set(OS_KEYS);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

export async function freePort(taken = []) {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return taken.includes(port) || port === 8888 || port === 8974 ? freePort(taken) : port;
}

export function portPolicy(ports) {
  return { ephemeralLoopbackOnly: true, ownerConfigurationRead: false,
    anyEquals8974: ports.includes(8974), anyEquals8888: ports.includes(8888) };
}

export function listPg0Registry() {
  if (!existsSync(PG0_REGISTRY)) return [];
  return readdirSync(PG0_REGISTRY).sort().map((name) => ({ name, mtime: statSync(join(PG0_REGISTRY, name)).mtime.toISOString() }));
}

export function listOwnerTaki() {
  const dir = join(homedir(), ".takiagent");
  return existsSync(dir) ? { exists: true, mtime: statSync(dir).mtime.toISOString(),
    entries: readdirSync(dir).sort().map((name) => ({ name, mtime: statSync(join(dir, name)).mtime.toISOString() })) } : { exists: false };
}

export function processSnapshot() {
  const rows = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/);
  const wanted = new Set(["node.exe", "python.exe", "postgres.exe", "pg0.exe"]);
  return rows.map((row) => row.split('","').map((cell) => cell.replaceAll('"', "")))
    .filter(([name]) => wanted.has(name?.toLowerCase())).map(([name, pid]) => ({ name, pid: Number(pid) }));
}

export function listeners(ports) {
  const rows = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/);
  return rows.filter((row) => /LISTENING/.test(row)).map((row) => row.trim().split(/\s+/))
    .filter(([, local]) => ports.includes(Number(local.split(":").at(-1)))).map(([, local, , , pid]) => ({ local, pid: Number(pid) }));
}

/** Transitive children of `pid` (the venv python.exe is a redirector that spawns the base interpreter). */
export function descendants(pid) {
  const rows = spawnSync("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.Name)\" }"],
  { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean)
    .map((row) => row.split(",")).map(([id, parent, name]) => ({ pid: Number(id), parent: Number(parent), name }));
  const found = [];
  for (let frontier = [pid]; frontier.length > 0;) {
    const next = rows.filter((row) => frontier.includes(row.parent) && !found.some((entry) => entry.pid === row.pid));
    found.push(...next);
    frontier = next.map((row) => row.pid);
  }
  return found;
}

export function running(pids) {
  const rows = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/);
  const alive = new Set(rows.map((row) => Number(row.split('","')[1])));
  return pids.filter((pid) => alive.has(pid));
}

function pg0(instance, action, extra = []) {
  // Files, not pipes: PostgreSQL grandchildren inherit handles and would keep a captured pipe open on Windows.
  const out = openSync(join(instance.root, `pg0-${action}.stdout.log`), "w");
  const err = openSync(join(instance.root, `pg0-${action}.stderr.log`), "w");
  try {
    return spawnSync(PG0, [action, "--name", instance.name, ...extra], { env: osEnvironment(), stdio: ["ignore", out, err],
      windowsHide: true, timeout: 90_000 }).status;
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

function pg0Info(instance) {
  if (pg0(instance, "info", ["--output", "json"]) !== 0) throw new Error("pg0 info failed for the owned instance");
  return JSON.parse(readFileSync(join(instance.root, "pg0-info.stdout.log"), "utf8"));
}

export function startPg0(root, port) {
  const name = `taki-smoke-${randomBytes(6).toString("hex")}`;
  const instance = { name, root, dataDir: resolve(root, "pg-data"), registry: join(PG0_REGISTRY, name), started: false, port: null };
  if (existsSync(instance.registry)) throw new Error("pg0 identity collision");
  try {
  const status = pg0(instance, "start", ["--data-dir", instance.dataDir, "--username", DB_USER, "--password", DB_USER,
    "--database", DB_USER, "--port", String(port), "-c", "listen_addresses=127.0.0.1"]);
  instance.started = true;
  if (status !== 0) throw new Error("pg0 start failed; see pg0-start logs");
  const info = pg0Info(instance);
  if (resolve(info.data_dir) !== instance.dataDir) throw new Error("pg0 data_dir is not the owned temp path");
  instance.port = Number(info.port);
  instance.info = { port: instance.port, running: info.running, dataDirMatches: true };
  } catch (error) { error.ownedPg = instance; throw error; }
  return instance;
}

function removeOwned(path) {
  if (!existsSync(path)) return "absent";
  if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing to remove a link: ${path}`);
  rmSync(path, { recursive: true, force: true });
  return existsSync(path) ? "still-present" : "removed";
}

export function removePg0(instance, { retain = false } = {}) {
  if (resolve(instance.dataDir) !== resolve(instance.root, "pg-data")
    || resolve(instance.registry) !== resolve(PG0_REGISTRY, instance.name)
    || !instance.name.startsWith("taki-smoke-")) throw new Error("owned pg0 paths do not match");
  const stopped = pg0(instance, "stop");
  const info = pg0Info(instance);
  if (info.running !== false || resolve(info.data_dir) !== instance.dataDir) {
    throw new Error("refusing pg0 removal without a stopped instance at the owned data path");
  }
  return { stopExit: stopped, running: info.running, data: retain ? "retained" : removeOwned(instance.dataDir),
    registry: retain ? "retained" : removeOwned(instance.registry) };
}

export function nativeUrl(native, path) {
  return `http://127.0.0.1:${native.port}${path}`;
}

function get(url) {
  return new Promise((done) => {
    const req = httpGet(url, { timeout: 2_000 }, (res) => { res.resume(); done(res.statusCode); });
    req.on("error", () => done(null));
    req.on("timeout", () => req.destroy());
  });
}

export function spawnNative({ root, pgPort, port, apiKey, realModels }) {
  const tiktoken = join(root, "tiktoken");
  const backups = join(root, "native-backups");
  mkdirSync(tiktoken, { recursive: true });
  mkdirSync(backups, { recursive: true });
  copyFileSync(TIKTOKEN_SOURCE, join(tiktoken, "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"));
  const log = join(root, "native.log");
  const egressLog = join(root, "native-egress.jsonl");
  const stopFile = join(root, "native.stop");
  const out = openSync(log, "w");
  const env = {
    ...osEnvironment(), PYTHON_DOTENV_DISABLED: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", UV_NO_ENV_FILE: "1",
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
    // LiteLLM otherwise fetches its model cost map from GitHub at import time (observed through the system proxy).
    LITELLM_LOCAL_MODEL_COST_MAP: "True", TIKTOKEN_CACHE_DIR: tiktoken,
    HINDSIGHT_API_DATABASE_URL: `postgresql://${DB_USER}:${DB_USER}@127.0.0.1:${pgPort}/${DB_USER}`,
    HINDSIGHT_API_LLM_PROVIDER: "mock", HINDSIGHT_API_LOG_LEVEL: "info",
    HINDSIGHT_API_TENANT_EXTENSION: "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_TENANT_API_KEY: apiKey,
    HINDSIGHT_API_TAKI_BACKUP_ENABLED: "true", HINDSIGHT_API_TAKI_BACKUP_DIR: backups,
    TAKI_SMOKE_ALLOWED_PORTS: `${pgPort},${port}`, TAKI_SMOKE_EGRESS_LOG: egressLog,
    TAKI_SMOKE_NATIVE_PORT: String(port), TAKI_SMOKE_STOP_FILE: stopFile, TAKI_SMOKE_PARENT_PID: String(process.pid),
  };
  if (realModels) Object.assign(env, {
    HINDSIGHT_API_LLM_PROVIDER: "openai", HINDSIGHT_API_LLM_API_KEY: realModels.apiKey,
    HINDSIGHT_API_LLM_MODEL: realModels.model, HINDSIGHT_API_LLM_BASE_URL: realModels.baseUrl,
    HINDSIGHT_API_LLM_TIMEOUT: "240",
    // OckQlQ reached the Windows registry proxy at 127.0.0.1:7890: httpx discovered it despite the clean env.
    // Bypass that proxy only for the approved model and owned loopback endpoints; retain the exact socket guard.
    NO_PROXY: `${new URL(realModels.baseUrl).hostname},127.0.0.1,localhost,::1`,
    TAKI_REAL_OBSERVATIONS: realModels.observationFile, TAKI_REAL_ADMISSION_STOP: realModels.admissionStopFile,
  });
  const launcher = realModels ? fileURLToPath(new URL("./real-model-native-launcher.py", import.meta.url)) : LAUNCHER;
  const child = spawn(PYTHON, [launcher], { cwd: root, env, stdio: ["ignore", out, out], windowsHide: true });
  closeSync(out);
  const native = { child, port, log, egressLog, stopFile, pid: child.pid, exit: null };
  child.once("exit", (code, signal) => { native.exit = { code, signal }; });
  return native;
}

export async function awaitNativeHealth(native, { budgetMs = 240_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (native.exit) throw new Error(`native exited during boot: ${JSON.stringify(native.exit)}`);
    if (await get(nativeUrl(native, "/health")) === 200) return Date.now();
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error("native /health deadline exceeded");
}

export async function stopNative(native, { budgetMs = 60_000 } = {}) {
  if (native.exit) return { ...native.exit, forced: false };
  writeFileSync(native.stopFile, "stop", "utf8");
  const timer = setTimeout(() => {
    native.forced = true;
    spawnSync("taskkill", ["/PID", String(native.pid), "/T", "/F"], { windowsHide: true });
  }, budgetMs);
  if (!native.exit) await once(native.child, "exit");
  clearTimeout(timer);
  return { ...native.exit, forced: native.forced === true };
}

export function nativeLogSize(native) {
  return statSync(native.log).size;
}

/** Access-log lines appended since `offset`, grouped by method + path with numeric/uuid-like segments kept verbatim. */
export function nativeCalls(native, offset = 0) {
  const text = readFileSync(native.log).subarray(offset).toString("utf8");
  const calls = [...text.matchAll(/"(GET|POST|PUT|PATCH|DELETE) ([^ ?"]+)(?:\?[^ "]*)? HTTP\/1\.1" (\d{3})/g)]
    .map(([, method, path, status]) => ({ method, path, status: Number(status) }));
  const counts = {};
  const classes = { operationPolls: 0, applicationBodyGets: 0, healthVersion: 0, commitsBodyWrites: 0, other: 0 };
  for (const call of calls) {
    const key = `${call.method} ${call.path} ${call.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    const group = call.method === "GET" && /\/operations\/[^/]+(?:\/|$)/.test(call.path) ? "operationPolls"
      : call.method === "GET" && /\/application-state\/bodies(?:\/|$)/.test(call.path) ? "applicationBodyGets"
      : call.method === "GET" && ["/health", "/version", "/ext/taki-memory/version"].includes(call.path) ? "healthVersion"
      : ["POST", "PUT", "PATCH"].includes(call.method) && /\/application-state\/(?:commits|bodies)(?:\/|$)/.test(call.path) ? "commitsBodyWrites" : "other";
    classes[group] += 1;
  }
  return { total: calls.length, counts, classes };
}

export function nativeEgress(native) {
  return existsSync(native.egressLog) ? readFileSync(native.egressLog, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}
