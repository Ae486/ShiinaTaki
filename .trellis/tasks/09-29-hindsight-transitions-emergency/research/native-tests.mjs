/** Task-owned native test runner; existing archived ownership helpers create only fresh isolated PostgreSQL. */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, startPg0, listPg0Registry } from "../../archive/2026-09/09-25-hindsight-backup-restore/research/restore-drill/smoke-native.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const native = "H:/hindsight";
const python = join(native, ".venv/Scripts/python.exe");
const pg0 = join(native, ".venv/Lib/site-packages/pg0/bin/pg0.exe");
const args = process.argv.slice(2);
if (!args.length || args.some((arg) => !arg.startsWith("tests/") || arg.includes(".."))) {
  throw new Error("Pass explicit native tests/ paths only; this runner fixes offline/sequential pytest options.");
}
const id = randomBytes(8).toString("hex");
const root = resolve(repo, ".trellis/.runtime/stage4-native-tests", id);
mkdirSync(root, { recursive: true });
const result = { id, root, tests: args, beforeRegistry: listPg0Registry(), startedAt: new Date().toISOString() };
let instance;
let child;
try {
  instance = startPg0(root, await freePort());
  result.instance = { name: instance.name, ...instance.info };
  const tiktoken = join(root, "tiktoken");
  mkdirSync(tiktoken);
  copyFileSync(join(repo, ".trellis/.runtime/b6-continuation-20260911/tokenizer-cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4"),
    join(tiktoken, "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"));
  const osKeys = new Set(["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase())));
  Object.assign(env, { PYTHON_DOTENV_DISABLED: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", UV_NO_ENV_FILE: "1",
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
    LITELLM_LOCAL_MODEL_COST_MAP: "True", TIKTOKEN_CACHE_DIR: tiktoken,
    HINDSIGHT_API_DATABASE_URL: `postgresql://taki_smoke:taki_smoke@127.0.0.1:${instance.port}/taki_smoke`,
    HINDSIGHT_API_LLM_PROVIDER: "mock", TAKI_SMOKE_ALLOWED_PORTS: String(instance.port),
    TAKI_SMOKE_EGRESS_LOG: join(root, "egress.jsonl"), PYTHONPATH: join(native, "hindsight-api-slim") });
  const log = openSync(join(root, "pytest.log"), "w");
  child = spawn(python, [join(here, "native-test-support/pytest_entry.py"), ...args, "-q", "-n", "0", "--tb=short"],
    { cwd: join(native, "hindsight-api-slim"), env, stdio: ["ignore", log, log], windowsHide: true });
  closeSync(log);
  console.log(JSON.stringify({ state: "testing", root, instance: result.instance }));
  const timer = setTimeout(() => {
    result.timeout = true;
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  }, 15 * 60_000);
  try { const [code, signal] = await once(child, "exit"); result.exitCode = code; result.signal = signal; }
  finally { clearTimeout(timer); }
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  if (instance) {
    const stop = spawnSync(pg0, ["stop", "--name", instance.name], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    const info = spawnSync(pg0, ["info", "--name", instance.name, "--output", "json"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    const parsed = JSON.parse(info.stdout);
    result.stopped = stop.status === 0 && parsed.running === false && resolve(parsed.data_dir) === resolve(instance.dataDir);
    // Retain the stopped fixture and private logs for W2 diagnosis; do not delete any historical data.
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  try { console.log(readFileSync(join(root, "pytest.log"), "utf8").split(/\r?\n/).slice(-35).join("\n")); } catch {}
  process.exitCode = result.exitCode === 0 && result.stopped && !result.error && !result.timeout ? 0 : 1;
}
