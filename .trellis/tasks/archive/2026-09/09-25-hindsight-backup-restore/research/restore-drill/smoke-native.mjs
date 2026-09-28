/**
 * INPUT:  the read-only patched native checkout (H:/hindsight venv + bundled pg0), a harness-owned temp root, free ports
 * OUTPUT: owned pg0 instance start/verify/stop/remove, guarded native Hindsight start/health/stop (named, with the Taki
 *         backup flag/dir and worker id), guarded native admin CLI runs, read-only row census, isolation listings (pg0
 *         registry names, owner port comparison without disclosure, process and listener snapshots), access-log counts
 * POS:    09-25-hindsight-backup-restore W6 drill — copied from the archived native-smoke harness; never touches an
 *         instance, data dir or source it did not create
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
const LAUNCHER = fileURLToPath(new URL("./native_launcher.py", import.meta.url));
const ADMIN = fileURLToPath(new URL("./admin_launcher.py", import.meta.url));
const PROBE = fileURLToPath(new URL("./pg_probe.py", import.meta.url));
const TIKTOKEN_SOURCE = "H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911/tokenizer-cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4";
const PG0_REGISTRY = join(homedir(), ".pg0/instances");
const DB_USER = "taki_smoke";
const OS_KEYS = ["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];

function osEnvironment() {
  const allowed = new Set(OS_KEYS);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

/** The owner's native port is compared in-process only; the value is never returned or printed. */
function ownerNativePort() {
  const file = join(HINDSIGHT_ROOT, ".env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((entry) => /^\s*HINDSIGHT_API_PORT\s*=/.test(entry));
  const port = Number(line?.split("=")[1]?.trim().replace(/^["']|["']$/g, ""));
  return Number.isInteger(port) ? port : null;
}

export async function freePort(taken = []) {
  const owner = ownerNativePort();
  for (;;) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    await new Promise((done) => server.close(done));
    if (port !== 8974 && port !== 8888 && port !== owner && !taken.includes(port)) return port;
  }
}

export function portPolicy(ports) {
  const owner = ownerNativePort();
  return { ownerEnvPortPresent: owner !== null, anyEqualsOwner: ports.some((port) => port === owner),
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
  const name = `taki-drill-${randomBytes(6).toString("hex")}`;
  const instance = { name, root, dataDir: resolve(root, "pg-data"), registry: join(PG0_REGISTRY, name), started: false, port: null };
  if (existsSync(instance.registry)) throw new Error("pg0 identity collision");
  const status = pg0(instance, "start", ["--data-dir", instance.dataDir, "--username", DB_USER, "--password", DB_USER,
    "--database", DB_USER, "--port", String(port), "-c", "listen_addresses=127.0.0.1"]);
  instance.started = true;
  if (status !== 0) throw new Error("pg0 start failed; see pg0-start logs");
  const info = pg0Info(instance);
  if (resolve(info.data_dir) !== instance.dataDir) throw new Error("pg0 data_dir is not the owned temp path");
  instance.port = Number(info.port);
  instance.info = { port: instance.port, running: info.running, dataDirMatches: true };
  return instance;
}

function removeOwned(path) {
  if (!existsSync(path)) return "absent";
  if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing to remove a link: ${path}`);
  rmSync(path, { recursive: true, force: true });
  return existsSync(path) ? "still-present" : "removed";
}

export function removePg0(instance) {
  const stopped = pg0(instance, "stop");
  const info = pg0Info(instance);
  if (info.running !== false || resolve(info.data_dir) !== instance.dataDir) {
    throw new Error("refusing pg0 removal without a stopped instance at the owned data path");
  }
  return { stopExit: stopped, running: info.running, data: removeOwned(instance.dataDir), registry: removeOwned(instance.registry) };
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

/** The offline native environment shared by the API, the admin CLI and the census; never the owner's .env. */
function nativeEnv({ root, pgPort, apiKey, egressLog }) {
  const tiktoken = join(root, "tiktoken");
  mkdirSync(tiktoken, { recursive: true });
  copyFileSync(TIKTOKEN_SOURCE, join(tiktoken, "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"));
  return {
    ...osEnvironment(), PYTHON_DOTENV_DISABLED: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", UV_NO_ENV_FILE: "1",
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
    // LiteLLM otherwise fetches its model cost map from GitHub at import time (observed through the system proxy).
    LITELLM_LOCAL_MODEL_COST_MAP: "True", TIKTOKEN_CACHE_DIR: tiktoken,
    HINDSIGHT_API_DATABASE_URL: `postgresql://${DB_USER}:${DB_USER}@127.0.0.1:${pgPort}/${DB_USER}`,
    HINDSIGHT_API_LLM_PROVIDER: "mock", HINDSIGHT_API_LOG_LEVEL: "info",
    HINDSIGHT_API_TENANT_EXTENSION: "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_TENANT_API_KEY: apiKey, TAKI_SMOKE_EGRESS_LOG: egressLog,
  };
}

export function spawnNative({ root, name = "native", pgPort, port, apiKey, backupDir, workerId }) {
  const log = join(root, `${name}.log`);
  const egressLog = join(root, `${name}-egress.jsonl`);
  const stopFile = join(root, `${name}.stop`);
  const out = openSync(log, "w");
  const env = {
    ...nativeEnv({ root, pgPort, apiKey, egressLog }),
    TAKI_SMOKE_ALLOWED_PORTS: `${pgPort},${port}`,
    TAKI_SMOKE_NATIVE_PORT: String(port), TAKI_SMOKE_STOP_FILE: stopFile, TAKI_SMOKE_PARENT_PID: String(process.pid),
    ...(backupDir ? { HINDSIGHT_API_TAKI_BACKUP_ENABLED: "true", HINDSIGHT_API_TAKI_BACKUP_DIR: backupDir } : {}),
    ...(workerId ? { HINDSIGHT_API_WORKER_ID: workerId } : {}),
  };
  const child = spawn(PYTHON, [LAUNCHER], { cwd: root, env, stdio: ["ignore", out, out], windowsHide: true });
  closeSync(out);
  const native = { child, name, port, log, egressLog, stopFile, pid: child.pid, exit: null };
  child.once("exit", (code, signal) => { native.exit = { code, signal }; });
  return native;
}

export async function awaitNativeHealth(native) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (native.exit) throw new Error(`native exited during boot: ${JSON.stringify(native.exit)}`);
    if (await get(nativeUrl(native, "/health")) === 200) return Date.now();
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error("native /health deadline exceeded");
}

export async function stopNative(native) {
  if (native.exit) return { ...native.exit, forced: false };
  writeFileSync(native.stopFile, "stop", "utf8");
  const timer = setTimeout(() => {
    native.forced = true;
    spawnSync("taskkill", ["/PID", String(native.pid), "/T", "/F"], { windowsHide: true });
  }, 60_000);
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
  for (const call of calls) {
    const key = `${call.method} ${call.path} ${call.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { total: calls.length, counts };
}

export function nativeEgress(native) {
  return existsSync(native.egressLog) ? readFileSync(native.egressLog, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

/** One guarded `hindsight-admin` command against an owned instance; output goes to admin-<label>.log under `root`. */
export function runAdmin({ root, pgPort, apiKey, label, args }) {
  const log = join(root, `admin-${label}.log`);
  const out = openSync(log, "w");
  const started = Date.now();
  try {
    const env = { ...nativeEnv({ root, pgPort, apiKey, egressLog: join(root, "admin-egress.jsonl") }), TAKI_SMOKE_ALLOWED_PORTS: String(pgPort) };
    const result = spawnSync(PYTHON, [ADMIN, ...args], { cwd: root, env, stdio: ["ignore", out, out], windowsHide: true, timeout: 600_000 });
    return { label, args, status: result.status, signal: result.signal, ms: Date.now() - started, log };
  } finally {
    closeSync(out);
  }
}

export function adminLog(run) {
  return readFileSync(run.log, "utf8");
}

/** Read-only row census of an owned instance (one REPEATABLE READ snapshot). */
export function probeNative({ pgPort }) {
  const result = spawnSync(PYTHON, [PROBE, String(pgPort), DB_USER], { env: { ...osEnvironment(), PYTHONUTF8: "1" }, encoding: "utf8",
    windowsHide: true, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`pg probe failed: ${result.stderr.slice(-400)}`);
  return JSON.parse(result.stdout);
}
