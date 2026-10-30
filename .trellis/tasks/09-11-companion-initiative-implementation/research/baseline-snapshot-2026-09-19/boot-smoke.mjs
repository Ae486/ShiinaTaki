/** Isolated strip-only startup and real registered SIGINT-handler shutdown; no user data or external services. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { seedCanonicalLocal } from "../../../../../e2e/src/fixture/seed-canonical-memory.ts";
import { getFreePort } from "../../../../../e2e/src/fixture/procs.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../../../..");
assert.equal(root.toLowerCase(), resolve("H:/TakiAgent-worktrees/t4").toLowerCase());
const logs = join(here, "logs"); mkdirSync(logs, { recursive: true });
const cases = [];
for (const mode of ["legacy-markdown", "canonical-local"]) cases.push(await run(mode));
writeFileSync(join(here, "boot-result.json"), JSON.stringify({ node: process.version, cases }, null, 2) + "\n");
console.log(JSON.stringify({ node: process.version, cases }, null, 2));

async function run(mode) {
  const dataDir = join(here, "payload", `boot-${mode}-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
  if (mode === "canonical-local") seedCanonicalLocal(dataDir);
  let providerRequests = 0;
  const provider = createServer((_request, response) => { providerRequests += 1; response.writeHead(503); response.end(); });
  await new Promise((accept) => provider.listen(0, "127.0.0.1", accept));
  const port = await getFreePort();
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
    TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, TAKI_PROVIDER_API_KEY: "isolated-dummy-key",
    TAKI_PROVIDER_MODEL: "isolated-never-called", TAKI_LOG_LEVEL: "info", TAKI_HINDSIGHT_ENABLED: "false",
    TAKI_PROMPT_DIR: join(root, "prompt"), TAKI_CREDENTIALS_DIRECTORY: join(dataDir, "no-credentials"), CREDENTIALS_DIRECTORY: "" });
  const entry = pathToFileURL(join(root, "packages/core/src/main.ts")).href;
  const wrapper = `process.on("message", () => { process.disconnect(); process.emit("SIGINT"); }); await import(${JSON.stringify(entry)}); process.send("ready");`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", wrapper], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((accept) => child.once("exit", (code, signal) => accept({ code, signal })));
  try {
    await deadline(new Promise((accept, reject) => {
      child.once("message", accept); child.once("error", reject);
      child.once("exit", () => reject(new Error("Core exited before ready")));
    }), 30_000);
    // IPC ready and buffered pino stdout are independent channels; require both
    // without assuming which channel the Windows scheduler delivers first.
    await deadline(new Promise((accept) => {
      const ready = () => { if (output.includes("ws server listening")) { child.stdout.off("data", ready); accept(); } };
      child.stdout.on("data", ready); ready();
    }), 5_000);
    child.send("shutdown");
    const exit = await deadline(exited, 30_000);
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.ok(output.includes("shutting down"));
    assert.ok(!output.includes("CORE_SHUTDOWN_FAILED"));
    const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: [] });
    let versions;
    try {
      versions = db.prepare("SELECT version FROM migrations ORDER BY version").all().map((row) => row.version);
      assert.deepEqual(versions, Array.from({ length: 48 }, (_, i) => i + 1));
      assert.equal(db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get().mode, mode);
      assert.equal(db.prepare("SELECT count(*) AS n FROM memory_operations").get().n, 0);
    } finally { db.close(); }
    assert.equal(providerRequests, 0);
    return { mode, port, providerRequests, versions, exit, registeredSigintHandler: true, dataDir };
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    await new Promise((accept) => provider.close(accept));
    writeFileSync(join(logs, `boot-${mode}.log`), output);
  }
}

async function deadline(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("boot/exit deadline")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
