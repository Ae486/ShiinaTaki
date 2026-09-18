/**
 * Isolated strip-only Core startup proof for both retained Legacy and Canonical Local modes.
 * Uses the existing E2E process/seed helpers, a never-called dummy provider and owned temporary data only.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_DIR, dummyProviderEnv } from "../../../../../e2e/src/fixture/paths.ts";
import { childEnv, getFreePort, killTree, spawnProc } from "../../../../../e2e/src/fixture/procs.ts";
import { jsonLine } from "../../../../../e2e/src/fixture/line-buffer.ts";
import { seedCanonicalLocal } from "../../../../../e2e/src/fixture/seed-canonical-memory.ts";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const evidenceDir = join(root, ".trellis", ".runtime", "b6-quality-20260911", "boot");
mkdirSync(evidenceDir, { recursive: true });
const results = [];
for (const mode of ["legacy", "canonical-local"]) results.push(await checkMode(mode));
writeFileSync(join(evidenceDir, "result.json"), JSON.stringify({ node: process.version, results }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ node: process.version, results }));

async function checkMode(mode) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-b6-boot-"));
  let proc;
  let started = false;
  let exited = false;
  let pid = null;
  try {
    if (mode === "canonical-local") seedCanonicalLocal(dataDir);
    const port = await getFreePort();
    proc = spawnProc({ command: process.execPath, args: ["src/main.ts"], cwd: CORE_DIR,
      env: childEnv({ ...dummyProviderEnv(), TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
        TAKI_DATA_DIR: dataDir, TAKI_LOG_LEVEL: "info", TAKI_PROMPT_DIR: join(root, "prompt"),
        // A missing file under this owned test directory keeps the catalog locked without reading an OS keyring.
        TAKI_CREDENTIALS_DIRECTORY: join(dataDir, "test-credentials"), CREDENTIALS_DIRECTORY: "", NODE_OPTIONS: "" }) });
    pid = proc.child.pid ?? null;
    await proc.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", 20_000);
    started = true;
    assert.equal(proc.child.exitCode, null, "Core must remain alive after listening");
  } finally {
    if (proc) {
      killTree(proc);
      await boundedExit(proc.exited);
      exited = true;
      writeFileSync(join(evidenceDir, `${mode}.stdout.jsonl`), proc.stdout.lines().join("\n") + "\n", "utf8");
      writeFileSync(join(evidenceDir, `${mode}.stderr.log`), proc.stderr.lines().join("\n") + "\n", "utf8");
    }
    removeOwnedTemp(dataDir);
  }
  return { mode, started, exited, pid, tempRemoved: !existsSync(dataDir), realModelCalls: 0 };
}

async function boundedExit(exited) {
  let timer;
  try {
    await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("owned Core did not exit after tree termination")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

function removeOwnedTemp(path) {
  if (!existsSync(path)) return;
  const actual = realpathSync(path);
  const parent = realpathSync(tmpdir());
  assert.equal(dirname(actual), parent, "cleanup must remain under the actual OS temporary directory");
  assert.ok(basename(actual).startsWith("taki-b6-boot-"), "cleanup must name a directory created by this smoke");
  rmSync(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
