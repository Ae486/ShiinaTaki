/** Task-only D91 adapter: frozen first-use pair -> owned Native target -> current immutable Core preflight. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, stopNative } from "./smoke-native.mjs";

const script = fileURLToPath(import.meta.url);
const python = "H:/hindsight/.venv/Scripts/python.exe";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const osKeys = new Set(["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA"]);
const osEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase())));

function fixtureRoot(path) {
  const root = realpathSync(path);
  assert.equal(resolve(root, ".."), resolve("G:/"), "PAIRED_RESTORE_OWNED_ROOT_REQUIRED");
  assert.match(basename(root), /^taki-first-use-[A-Za-z0-9]+$/);
  return root;
}

function owned(root, path) {
  const value = realpathSync(path); const part = relative(root, value);
  assert(part !== "" && !part.startsWith("..") && !isAbsolute(part), "PAIRED_RESTORE_PATH_NOT_OWNED");
  return value;
}

function start(command, args, env, directory, name, apiKey) {
  const child = spawn(command, args, { cwd: directory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const handle = { child, pid: child.pid, exit: null, stopFile: join(directory, `${name}.stop`) };
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  handle.closed = new Promise((done) => {
    child.once("error", (error) => { handle.exit = { code: null, signal: null, error: error.code }; });
    child.once("exit", (code, signal) => { handle.exit = { code, signal }; });
    child.once("close", (code, signal) => {
      handle.exit ??= { code, signal };
      writeFileSync(join(directory, `${name}.log`), output.replaceAll(apiKey, "[REDACTED]"), "utf8");
      done(handle.exit);
    });
  });
  return handle;
}

async function waitReady(native, path) {
  for (const deadline = Date.now() + 600_000; Date.now() < deadline; await sleep(100)) {
    if (existsSync(path)) return read(path);
    if (native.exit) throw new Error("PAIRED_RESTORE_NATIVE_FAILED");
  }
  throw new Error("PAIRED_RESTORE_NATIVE_DEADLINE");
}

/** Caller must stop its Core/Native writers first and keep its owned PG alive until this promise settles. */
export async function runPairedRestore({ ownedRoot, pairDir, nativeArchivePath, pgPort, sourceDatabase = "taki_smoke",
  custodyDataDir, credentialsDir, apiKey }) {
  const root = fixtureRoot(ownedRoot);
  assert.equal(sourceDatabase, "taki_smoke", "PAIRED_RESTORE_FIXTURE_DATABASE_REQUIRED");
  assert(Number.isInteger(pgPort) && pgPort > 0 && pgPort < 65536 && ![8888, 8974].includes(pgPort));
  assert(typeof apiKey === "string" && apiKey.length > 0, "PAIRED_RESTORE_FIXTURE_KEY_REQUIRED");
  const plan = { ownedRoot: root, pairDir: owned(root, pairDir), nativeArchivePath: owned(root, nativeArchivePath), pgPort, sourceDatabase,
    custodyDataDir: owned(root, custodyDataDir), credentialsDir: owned(root, credentialsDir), observationPort: await freePort([pgPort]) };
  const preserved = [join(plan.pairDir, "core.sqlite"), join(plan.pairDir, "manifest.json"), plan.nativeArchivePath,
    join(plan.custodyDataDir, "secret-catalog.bin"), join(plan.custodyDataDir, "host-identity.json")].map((path) => owned(root, path));
  owned(root, join(plan.credentialsDir, "taki-secret-catalog-master-key"));
  const hashes = preserved.map(sha);
  const { HindsightBackupManifestSchema } = await import("../../../../../packages/shared/src/index.ts");
  const manifest = HindsightBackupManifestSchema.parse(read(preserved[1]));
  assert.equal(manifest.version, 2, "PAIRED_RESTORE_V2_REQUIRED");
  assert(manifest.verifiedAt, "PAIRED_RESTORE_VERIFIED_PAIR_REQUIRED");
  assert.equal(sha(plan.nativeArchivePath), manifest.native.proof.zipSha256, "PAIRED_RESTORE_ARCHIVE_DIGEST_MISMATCH");
  assert.equal(readFileSync(plan.nativeArchivePath).byteLength, manifest.native.proof.zipBytes, "PAIRED_RESTORE_ARCHIVE_SIZE_MISMATCH");
  const directory = mkdtempSync(join(root, "paired-restore-"));
  const planPath = join(directory, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
  const env = { ...osEnvironment(), PYTHON_DOTENV_DISABLED: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", UV_NO_ENV_FILE: "1",
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
    LITELLM_LOCAL_MODEL_COST_MAP: "True", TIKTOKEN_CACHE_DIR: join(root, "tiktoken"),
    HINDSIGHT_API_LLM_PROVIDER: "mock", HINDSIGHT_API_TENANT_API_KEY: apiKey,
    HINDSIGHT_API_TENANT_EXTENSION: "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS: "0", HINDSIGHT_API_AUDIT_LOG_RETENTION_DAYS: "0",
    HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS: "0", HINDSIGHT_API_OPERATION_RETENTION_DAYS: "0", HINDSIGHT_API_LLM_TRACE_ENABLED: "false",
    TAKI_SMOKE_ALLOWED_PORTS: `${pgPort},${plan.observationPort}`, TAKI_SMOKE_EGRESS_LOG: join(directory, "native-egress.jsonl"),
    TAKI_SMOKE_PARENT_PID: String(process.pid) };
  const result = { completed: false, directory, backupId: manifest.backupId, coreStarted: false,
    artifacts: { corePath: preserved[0], manifestPath: preserved[1], nativeArchivePath: plan.nativeArchivePath,
      coreSha256: hashes[0], manifestSha256: hashes[1], nativeZipSha256: hashes[2], nativeZipBytes: manifest.native.proof.zipBytes } };
  let native;
  let failure;
  try {
    native = start(python, ["-B", fileURLToPath(new URL("./paired-restore.py", import.meta.url)), "--run-owned-restore", "--plan", planPath],
      env, directory, "native", apiKey);
    const ready = await waitReady(native, join(directory, "native-ready.json"));
    assert.equal(ready.endpoint, `http://127.0.0.1:${plan.observationPort}`, "PAIRED_RESTORE_ENDPOINT_MISMATCH");
    const core = start(process.execPath, ["--experimental-transform-types", script, "--core-preflight", planPath],
      osEnvironment(), directory, "core", apiKey);
    const timer = setTimeout(() => core.child.kill(), 120_000);
    try {
      const exit = await core.closed;
      result.core = existsSync(join(directory, "core-result.json")) ? read(join(directory, "core-result.json")) : null;
      assert(exit.code === 0 && result.core?.completed === true, "PAIRED_RESTORE_CORE_PREFLIGHT_FAILED");
    } finally { clearTimeout(timer); }
  } catch (error) { failure = error; }
  finally {
    if (native) {
      try { result.nativeStop = await stopNative(native); await native.closed; }
      catch (error) { failure ??= error; }
      if (existsSync(join(directory, "native-result.json"))) {
        const { tables, ...summary } = read(join(directory, "native-result.json"));
        result.native = summary;
      }
    }
    result.inputsUnchanged = preserved.every((path, index) => existsSync(path) && sha(path) === hashes[index]);
    const egressPath = join(directory, "native-egress.jsonl");
    result.refusedEgress = existsSync(egressPath) ? readFileSync(egressPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length : 0;
    result.completed = !failure && result.inputsUnchanged && result.refusedEgress === 0 && result.nativeStop?.code === 0
      && !result.nativeStop.forced && result.native?.completed === true && result.native.sourceUnchanged === true
      && result.native.restoredDatabaseDropped === true;
    if (!result.completed) result.error = failure?.message ?? result.native?.error ?? "PAIRED_RESTORE_CLEANUP_OR_INPUT_CHECK_FAILED";
    writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  }
  if (!result.completed) throw Object.assign(new Error(result.error), { detail: result });
  return result;
}

async function corePreflight(plan) {
  const original = net.Socket.prototype.connect;
  const refused = [];
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const target = first && typeof first === "object" ? { host: first.host ?? "localhost", port: Number(first.port) }
      : { host: typeof args[1] === "string" ? args[1] : "localhost", port: Number(first) };
    if (["127.0.0.1", "localhost", "::1"].includes(target.host) && target.port === plan.observationPort) return original.apply(this, args);
    refused.push({ host: target.host, port: target.port });
    process.nextTick(() => this.destroy(new Error("PAIRED_RESTORE_EGRESS_REFUSED")));
    return this;
  };
  try {
    const [{ openReadonlyDatabase }, { runHindsightRestorePreflight }, { createSecretCatalogService }, { resolveMasterKeySource }, { createCaptureLogger }] = await Promise.all([
      import("../../../../../packages/core/src/db/sqlite.ts"),
      import("../../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-preflight-operator.ts"),
      import("../../../../../packages/core/src/secrets/secret-catalog-service.ts"),
      import("../../../../../packages/core/src/secrets/master-key.ts"),
      import("../../../../../packages/core/src/testing/capture-logger.ts"),
    ]);
    const corePath = join(plan.pairDir, "core.sqlite"); const manifestPath = join(plan.pairDir, "manifest.json");
    const manifest = read(manifestPath); const host = read(join(plan.custodyDataDir, "host-identity.json"));
    assert.equal(host.hostId, manifest.custody.storeId, "PAIRED_RESTORE_CUSTODY_STORE_MISMATCH");
    const keySource = resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: plan.credentialsDir });
    assert.equal(keySource?.canCreate, false, "PAIRED_RESTORE_KEY_CREATION_FORBIDDEN");
    const catalog = await createSecretCatalogService({ filePath: join(plan.custodyDataDir, "secret-catalog.bin"), storeId: host.hostId,
      keySource, logger: createCaptureLogger().logger });
    assert.equal(catalog.health(), "ok", "PAIRED_RESTORE_CREDENTIAL_CATALOG_UNAVAILABLE");
    const db = openReadonlyDatabase(corePath);
    let migrationHead; let candidateRows;
    try {
      migrationHead = db.prepare("SELECT max(version) AS head FROM migrations").get().head;
      assert.equal(migrationHead, 77, "PAIRED_RESTORE_HEAD077_REQUIRED");
      assert.equal(manifest.core.migrationHead, migrationHead, "PAIRED_RESTORE_HEAD_MISMATCH");
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hindsight_candidate_%' ORDER BY name").all();
      assert.equal(tables.length, 5, "PAIRED_RESTORE_CANDIDATE_TABLES_MISSING");
      candidateRows = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n]));
      assert(Object.values(candidateRows).every((count) => count === 0), "PAIRED_RESTORE_CANDIDATE_ROWS_PRESENT");
    } finally { db.close(); }
    const preflight = await runHindsightRestorePreflight({ corePath, manifestPath, endpoint: `http://127.0.0.1:${plan.observationPort}`,
      catalog, signal: AbortSignal.timeout(60_000) });
    assert.equal(refused.length, 0, "PAIRED_RESTORE_EGRESS_REFUSED");
    return { completed: true, migrationHead, candidateRows, coreSha256: sha(corePath), credentialHealth: catalog.health(), preflight, coreStarted: false };
  } finally { net.Socket.prototype.connect = original; }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  if (process.argv.length === 2) console.log(JSON.stringify({ executed: false, completed: false }));
  else {
    assert.equal(process.argv[2], "--core-preflight"); assert.equal(process.argv.length, 4);
    const planPath = realpathSync(process.argv[3]); const plan = read(planPath);
    const root = fixtureRoot(plan.ownedRoot); const directory = owned(root, resolve(planPath, ".."));
    for (const path of [join(plan.pairDir, "core.sqlite"), join(plan.pairDir, "manifest.json"),
      join(plan.custodyDataDir, "host-identity.json"), join(plan.custodyDataDir, "secret-catalog.bin"),
      join(plan.credentialsDir, "taki-secret-catalog-master-key")]) owned(root, path);
    let result;
    try { result = await corePreflight(plan); }
    catch (error) { result = { completed: false, error: /^(PAIRED_RESTORE_|HINDSIGHT_|MEMORY_)[A-Z_]+$/.test(error.message ?? "")
      ? error.message : "PAIRED_RESTORE_PREFLIGHT_FAILED" }; console.error(error); process.exitCode = 1; }
    writeFileSync(join(directory, "core-result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  }
}
