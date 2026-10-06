/** Owned synthetic check for the D91 CLI protocol; never derives data from a real corpus. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, startPg0 } from "../../archive/2026-09/09-25-hindsight-backup-restore/research/restore-drill/smoke-native.mjs";

if (process.argv.slice(2).join(" ") !== "--run-owned-synthetic") {
  console.log(JSON.stringify({ executed: false })); process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url)); const repo = resolve(here, "../../../..");
const root = join(repo, ".trellis/.runtime/stage4-w6-restore", `synthetic-${randomUUID()}`); mkdirSync(root, { recursive: true });
const native = "H:/hindsight"; const python = join(native, ".venv/Scripts/python.exe");
const pg0 = join(native, ".venv/Lib/site-packages/pg0/bin/pg0.exe");
const osKeys = new Set(["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase())));
Object.assign(env, { PYTHON_DOTENV_DISABLED: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", UV_NO_ENV_FILE: "1", HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True",
  PYTHONPATH: join(native, "hindsight-api-slim"), HINDSIGHT_API_LLM_PROVIDER: "mock" });
let instance; const result = { executed: true, completed: false };
try {
  instance = startPg0(root, await freePort());
  const url = `postgresql://taki_smoke:taki_smoke@127.0.0.1:${instance.port}/taki_smoke`;
  const urlFile = join(root, "database-url.txt"); writeFileSync(urlFile, url, { flag: "wx" });
  const requestPath = join(root, "native-request.json");
  const initialize = `import asyncio,json,uuid,sys,importlib.util
import asyncpg
from hindsight_api.migrations import run_migrations
url=open(sys.argv[1],encoding='utf-8').read()
run_migrations(url,schema='public')
async def seed():
 c=await asyncpg.connect(url)
 try:
  spec=importlib.util.spec_from_file_location('w6_restore',sys.argv[3]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
  await module.triggers(c,'public')
  for sql,expected in [
   ('DROP TRIGGER guard_transition_bank_write ON public.documents','W6_RESTORE_MISSING_WRITER_GUARD'),
   ('ALTER TABLE public.documents ENABLE REPLICA TRIGGER guard_transition_bank_write','W6_RESTORE_DISABLED_WRITER_GUARD')]:
   tx=c.transaction(); await tx.start()
   try:
    await c.execute(sql)
    try: await module.triggers(c,'public')
    except ValueError as error: assert str(error)==expected
    else: raise AssertionError('W6_SYNTHETIC_GUARD_NOT_REJECTED')
   finally: await tx.rollback()
  await module.triggers(c,'public')
  await c.execute("INSERT INTO public.banks(bank_id,name) VALUES('owned-w6-bank','Owned W6')")
  lineage=await c.fetchval('SELECT provider_lineage FROM public.replication_provider_lineage')
  with open(sys.argv[2],'x',encoding='utf-8') as f: json.dump(dict(version=1,backupId=str(uuid.uuid4()),createdAt='2026-10-06T00:00:00Z',providerLineageId=str(lineage),nativeBankIds=['owned-w6-bank'],operationIds=[]),f)
 finally: await c.close()
asyncio.run(seed())`;
  const seed = spawnSync(python, ["-B", "-c", initialize, urlFile, requestPath, join(here, "w6-paired-native-restore.py")], { cwd: native, env, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  writeFileSync(join(root, "initialize.log"), seed.stdout + seed.stderr); assert.equal(seed.status, 0, "W6_SYNTHETIC_INITIALIZE_FAILED");
  const planPath = join(root, "plan.json");
  writeFileSync(planPath, JSON.stringify({ ownedRoot: root, coreStopped: true, databaseUrlFile: urlFile, sourceSchema: "public", nativeRequestPath: requestPath }));
  const run = spawnSync(python, ["-B", join(here, "w6-paired-native-restore.py"), "--run-owned-restore", "--plan", planPath],
    { cwd: native, env, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  writeFileSync(join(root, "restore.log"), run.stdout + run.stderr);
  const proof = JSON.parse(readFileSync(join(root, "native-restore-result.json"), "utf8"));
  assert.equal(run.status, 0, proof.error); assert.equal(proof.completed, true);
  assert(proof.tables.memory_transition_bank_origins.count > 0);
  const again = spawnSync(python, ["-B", join(here, "w6-paired-native-restore.py"), "--run-owned-restore", "--plan", planPath],
    { cwd: native, env, encoding: "utf8", windowsHide: true, timeout: 15_000 });
  assert.notEqual(again.status, 0); assert.deepEqual(JSON.parse(readFileSync(join(root, "native-restore-result.json"), "utf8")), proof);
  result.completed = true; result.tableCount = proof.tableCount; result.fullHistoryHash = proof.fullHistoryHash; result.noAutomaticRetry = true;
  result.missingAndReplicaOnlyGuardsRefused = true;
} catch (error) { result.error = /^[A-Z_]+$/.test(error.message ?? "") ? error.message : "W6_SYNTHETIC_FAILED"; process.exitCode = 1; }
finally {
  if (instance) {
    const stop = spawnSync(pg0, ["stop", "--name", instance.name], { windowsHide: true, timeout: 60_000 });
    const info = spawnSync(pg0, ["info", "--name", instance.name, "--output", "json"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    result.stopped = stop.status === 0 && JSON.parse(info.stdout).running === false;
    if (!result.stopped) process.exitCode = 1;
  }
  writeFileSync(join(root, "smoke-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ root, ...result }));
}
