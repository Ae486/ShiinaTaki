/**
 * INPUT:  one prepared immutable database fixture image/key adapter and fixed token/roots
 * OUTPUT: two admitted PostgreSQL generations, original logged data, checked stops and owned cleanup
 * POS:    task-only database experiment; no production provider, Native API or C2b receipt
 */
/* eslint-disable max-lines -- One single-use task fixture retains its reviewed sequence and exact cleanup; production limits are unchanged. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHost } from "../../../../../apps/hindsight-host/scripts/build.ts";
import { deploymentFixture, type DeploymentFixture } from "../../../../../apps/hindsight-host/src/deployment-test-fixtures.ts";
import { FixedDockerAdapter, resourceNames } from "../../../../../apps/hindsight-host/src/docker-adapter.ts";
import { dockerExchange } from "../../../../../apps/hindsight-host/src/docker-process.ts";
import { DeploymentRegistry, type DeploymentAttempt, type OwnedDeploymentRecord } from "../../../../../apps/hindsight-host/src/deployment-registry.ts";
import { fileDigest, sha256 } from "../../../../../apps/hindsight-host/src/installed-files.ts";
import { createConfigSource } from "../../../../../packages/core/src/config/config-source.ts";
import { resolveHindsightConfig } from "../../../../../packages/core/src/config/hindsight-config.ts";
import { JsonRpcSuccessResponseSchema } from "../../../../../packages/shared/src/json-rpc-schema.ts";
import { RunStatusResultSchema, type RunStatusResult } from "../../../../../packages/shared/src/harness-schema.ts";
import { DeploymentEffectV1Schema, DeploymentStatusV1Schema, HINDSIGHT_DEPLOYMENT_METHODS,
  type DeploymentStatusV1 } from "../../../../../packages/shared/src/hindsight-deployment-schema.ts";
import type { CapabilityRequest } from "../../../../../packages/shared/src/host-control-schema.ts";
import { getFreePort, killTree, spawnProc, type Proc } from "../../../../../e2e/src/fixture/procs.ts";
import { jsonLine } from "../../../../../e2e/src/fixture/line-buffer.ts";
import { pairOperator, setPermissionLevel } from "../../../../../e2e/src/fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "../../../../../e2e/src/fixture/rpc-socket.ts";
import { startCapabilityRelay, type CapabilityRelay } from "../../../../../e2e/src/fixture/ws-relay.ts";

const CASE = "13f04d85-ee84-408e-890c-88922e36c69e";
const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = resolve(`C:/taki-c2a-db-persistence-${CASE}`);
const STAGING = resolve(`G:/TakiAgent-c2a-database/persistence-${CASE}`);
const IMAGE_TAG = `taki-c2a-db:${CASE}`;
const BASE_IMAGE = "sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db";
const DOCKER = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
const SHELL = join(REPOSITORY, "apps/desktop/src-tauri/target/debug/taki-node.exe");
const CONFIG = { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:9" };
const PINNED = {
  [DOCKER]: "0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d",
  "C:/Program Files/nodejs/node.exe": "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de",
  [SHELL]: "1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9",
};
const report: Record<string, unknown> = { version: 1, caseId: CASE, scope: "admitted-database-persistence", deploymentReady: false,
  evidenceBoundary: "Task database only; Native API/provider, inner ACK loss, daemon restart and C2b remain untested" };
const commands: Record<string, unknown>[] = [];
const scans: Record<string, { bytes: number; hits: number }> = {};
const processes: Proc[] = [];
const stoppedProcesses = new Set<Proc>();
const capturedHelpers: WindowsProcess[] = [];
const execEvidence = new Map<string, unknown>();
const submitExecIds = new Set<string>();
const failedReadExecIds = new Set<string>();
let waitingReadFailures = 0;
let fixture: DeploymentFixture | undefined;
let operator: RpcSocket | undefined;
let relay: CapabilityRelay | undefined;
let stage = "prerequisites";
let ownsRoot = false;
let ownsRun = false;
let initialGFree = 0;
const startedAt = Date.now();
let cleanupDeadline = 0;

// These are task-probe facts only. All production wire messages use their existing Shared schemas.
interface WindowsProcess { ProcessId: number; ParentProcessId: number; ExecutablePath: string; CommandLine: string; CreatedAt: string }
interface BootPaths { nodeData: string; credentials: string }
interface Generation { core: Proc; node: Proc }

type FailureCode = "C2A_CHECK_FAILED" | "INITIAL_RESOURCE_CONTRACT" | "INITIAL_RUN_CONTRACT"
  | "DATABASE_READY_TIMEOUT" | "PROCESS_EXIT_TIMEOUT" | "STARTUP_READ_TIMEOUT" | "DOCKER_EXCHANGE_FAILED"
  | "UNEXPECTED_FAILURE";
const FAILURE_CODES = new Set<string>(["C2A_CHECK_FAILED", "INITIAL_RESOURCE_CONTRACT", "INITIAL_RUN_CONTRACT",
  "DATABASE_READY_TIMEOUT", "PROCESS_EXIT_TIMEOUT", "STARTUP_READ_TIMEOUT", "DOCKER_EXCHANGE_FAILED"]);
function requireFact(value: unknown, code: FailureCode = "C2A_CHECK_FAILED"): asserts value {
  if (!value) throw new Error(code);
}
function failureCode(error: unknown): FailureCode {
  return error instanceof Error && FAILURE_CODES.has(error.message) ? error.message as FailureCode : "UNEXPECTED_FAILURE";
}
function json(bytes: Uint8Array | string) { return JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8")); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function scan(name: string, bytes: Uint8Array | string) {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  const hits = [...buffer.toString("utf8").matchAll(/C2A_FAKE_[0-9a-f]{64}/g)].length;
  scans[name] = { bytes: buffer.length, hits }; requireFact(hits === 0);
}
function free(path: string) { const value = statfsSync(path); return value.bavail * value.bsize; }
function budget(limit: number) {
  const remaining = (stage === "owned-cleanup" ? cleanupDeadline : startedAt + 15 * 60_000) - Date.now();
  requireFact(remaining > 0); return Math.min(limit, remaining);
}
function capacity() {
  requireFact(free("G:/") >= 20 * 1024 ** 3 && initialGFree - free("G:/") <= 2 * 1024 ** 3);
  requireFact(free("C:/") >= 1024 ** 3 && Date.now() - startedAt < 15 * 60_000);
}
async function docker(argv: string[], timeout = 15_000) {
  requireFact(fixture);
  const before = Date.now();
  const entry: Record<string, unknown> = { argv, startedAt: new Date().toISOString() };
  commands.push(entry);
  try {
    const output = await dockerExchange(fixture.deploymentRegistration, { argv, signal: AbortSignal.timeout(budget(timeout)) });
    scan(`docker-command-${commands.length}`, output);
    Object.assign(entry, { outcome: "completed", output: output.toString("utf8"), bytes: output.length });
    return output;
  } catch { entry.outcome = "failed-or-unknown"; throw new Error("DOCKER_EXCHANGE_FAILED"); }
  finally { entry.elapsedMs = Date.now() - before; }
}
function command(path: string, args: string[], cwd = ROOT) {
  const result = spawnSync(path, args, { windowsHide: true, encoding: "utf8", timeout: budget(15_000), maxBuffer: 32 * 1024,
    env: { SystemRoot: process.env.SystemRoot }, cwd });
  requireFact(result.status === 0); return result.stdout.trim();
}

async function provision() {
  stage = "protected-installation";
  mkdirSync(ROOT); ownsRoot = true;
  writeFileSync(join(ROOT, ".c2a-docker-owner"), CASE, { flag: "wx" });
  const system = process.env.SystemRoot; requireFact(system);
  const identity = json(command(join(system, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
    "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $bytes=New-Object byte[] $sid.BinaryLength; "
    + "$sid.GetBinaryForm($bytes,0); $digest=[System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes); "
    + "[pscustomobject]@{sid=$sid.Value;digest=([BitConverter]::ToString($digest).Replace('-','').ToLowerInvariant())}|ConvertTo-Json -Compress"]));
  command(join(system, "System32/icacls.exe"), [ROOT, "/inheritance:r", "/grant:r", `*${identity.sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  const adapter = join(STAGING, "fake-key-adapter.exe");
  fixture = await deploymentFixture(ROOT, adapter);
  const payload = buildHost({ output: join(ROOT, "payload"), platform: "win32", architecture: "x64", adapter });
  const runtime = join(ROOT, "node.exe"); copyFileSync(process.execPath, runtime);
  const config = resolveHindsightConfig(createConfigSource({ env: CONFIG, repo: {
    get: () => null, all: () => new Map(), upsert: () => { throw new Error("READ_ONLY"); }, delete: () => { throw new Error("READ_ONLY"); },
  } }));
  requireFact(config.state === "ready" && fixture.registration.custody.kind === "windows-keyring");
  fixture.plan.configurationDigest = sha256(JSON.stringify(config.projection));
  Object.assign(fixture.registration, { installationRoot: payload, manifestSha256: fileDigest(join(payload, "manifest.json")),
    runtime: { path: runtime, sha256: fileDigest(runtime), version: process.version } });
  fixture.registration.custody.tokenUserSha256 = identity.digest;
  fixture.registration.custody.adapter = { path: join(payload, "bin/taki-secret-key.exe"), sha256: fileDigest(adapter) };
  Object.assign(fixture.deploymentRegistration.docker, { path: DOCKER, sha256: PINNED[DOCKER], version: "29.0.1",
    engineId: "93e8319e-24b7-4a7d-88f1-60923ad681e0" });
  const imageId = readFileSync(join(STAGING, "image-id.txt"), "utf8").trim();
  requireFact(/^sha256:[0-9a-f]{64}$/.test(imageId) && imageId !== BASE_IMAGE);
  fixture.deploymentRegistration.image.id = imageId;
  const nodeData = join(ROOT, "node-data"); mkdirSync(nodeData);
  for (const data of [fixture.registration.coreDataDirectory, nodeData]) {
    const directory = join(data, "hindsight-host"); mkdirSync(directory);
    writeFileSync(join(directory, "installation.json"), JSON.stringify(fixture.registration));
    writeFileSync(join(directory, "deployment-registration.json"), JSON.stringify(fixture.deploymentRegistration));
  }
  writeFileSync(join(fixture.registration.coreDataDirectory, "host-identity.json"), JSON.stringify({ hostId: fixture.registration.coreHostId }));
  writeFileSync(join(nodeData, "secrets.json"), JSON.stringify({ "device-id": fixture.registration.executionHostId }));
  const credentials = join(ROOT, "fake-credentials"); mkdirSync(credentials);
  writeFileSync(join(credentials, "taki-secret-catalog-master-key"), new Uint8Array(32).fill(0xa5));
  report.installation = { root: ROOT, manifestSha256: fixture.registration.manifestSha256, adapterSha256: fileDigest(adapter), imageId };
  scanTree(); capacity();
  return { nodeData, credentials };
}

async function boot(paths: BootPaths): Promise<Generation> {
  requireFact(fixture); stage = "core-shell-operator";
  const port = await getFreePort(); const url = `ws://127.0.0.1:${port}`;
  const base = { SystemRoot: process.env.SystemRoot, TEMP: STAGING, TMP: STAGING, WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" };
  const core = spawnProc({ command: process.execPath, args: [join(REPOSITORY, "packages/core/src/main.ts")], cwd: ROOT,
    env: { ...base, ...CONFIG, TAKI_DATA_DIR: fixture.registration.coreDataDirectory, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "false", TAKI_CREDENTIALS_DIRECTORY: paths.credentials,
      TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "e2e-dummy-key", TAKI_PROVIDER_MODEL: "e2e-dummy-model" } });
  processes.push(core); await core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", budget(30_000));
  relay = await startCapabilityRelay(url);
  const node = spawnProc({ command: SHELL, args: [], cwd: paths.nodeData, env: { ...base, TAKI_DATA_DIR: paths.nodeData,
    TAKI_WS_URL: relay.url, TAKI_DEVICE_NAME: "C2a database fixture", TAKI_GATE_AUTOAPPROVE: "allow-once",
    TAKI_CAPABILITIES: "hindsight-custody,hindsight-deployment,hindsight-deployment-observe" } });
  processes.push(node);
  const codeFor = async (name: string) => String(jsonLine(await core.stdout.waitFor((line) => {
    const entry = jsonLine(line); return entry?.msg === "pairing code issued" && entry.deviceName === name;
  }, budget(20_000)))?.code);
  node.child.stdin?.write(`${await codeFor("C2a database fixture")}\n`);
  await node.stderr.waitFor((line) => line.includes("state=connected"), budget(30_000));
  operator = await openRpcSocket(url);
  await pairOperator(operator, { deviceId: randomUUID(), deviceName: "C2a database operator", getCode: () => codeFor("C2a database operator") });
  await setPermissionLevel(operator, "relaxed");
  return { core, node };
}

function startInput() {
  requireFact(fixture);
  return { idempotencyKey: CASE, expectedConfigurationDigest: fixture.plan.configurationDigest };
}
async function deploymentCall(method: string, params: unknown): Promise<DeploymentStatusV1> {
  requireFact(operator);
  const result = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request(method, params, budget(90_000))).result);
  requireFact(result.deploymentReady === false);
  scan(`status-${Object.keys(scans).length}`, JSON.stringify(result));
  report.lastStatus = result;
  return result;
}
function ownedRegistry(): OwnedDeploymentRecord {
  requireFact(fixture);
  const record = new DeploymentRegistry(fixture.deploymentRegistration.stateDirectory).snapshot();
  requireFact(record.state === "owned" && record.containerId && record.volume);
  scan(`registry-${Object.keys(scans).length}`, JSON.stringify(record));
  report.lastRegistry = registryFacts(record);
  return record;
}
function registryFacts(record: OwnedDeploymentRecord) {
  // Record this bounded projection before assertions. Authorization/custody payloads stay private.
  return { deploymentId: record.plan.deploymentId, operationId: record.plan.operationId,
    containerId: record.containerId ?? null, volume: record.volume?.name ?? null,
    configurationDigest: record.plan.configurationDigest, steps: record.steps,
    attempts: record.attempts.map((attempt) => ({ action: attempt.action, phase: attempt.phase,
      requestId: attempt.requestId, startupId: attempt.startupId ?? null, runId: attempt.control.runId,
      checkpointId: attempt.checkpointId ?? null, startupAuthorizationId: attempt.startupAuthorizationId ?? null,
      custodySnapshotId: attempt.custody.input.snapshotId,
      coreAttemptId: attempt.control.coreAttemptId, hostAttemptId: attempt.control.attemptId,
      effectId: attempt.control.effectId })) };
}
async function readRun(runId: string): Promise<RunStatusResult> {
  requireFact(operator);
  return RunStatusResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request("run.status", { runId }, budget(20_000))).result);
}
function runFacts(result: RunStatusResult) {
  const run = result.run;
  return { runId: run.runId, state: run.state, outcome: run.outcome, activeAttemptId: run.activeAttemptId,
    idempotencyKey: run.idempotencyKey, triggerRequestId: run.triggerRequestId, provenance: run.provenance,
    attempts: result.attempts.map((entry) => ({ attemptId: entry.attemptId, state: entry.state, outcome: entry.outcome })) };
}
function windowsProcesses(filter: string): WindowsProcess[] {
  const system = process.env.SystemRoot; requireFact(system);
  const output = command(join(system, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $items=@(Get-CimInstance -ClassName Win32_Process -Filter '" + filter
    + "' | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{Name='CreatedAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}}); "
    + "ConvertTo-Json -InputObject $items -Compress"]);
  const values = json(output) as WindowsProcess[];
  requireFact(Array.isArray(values) && values.length <= 16 && values.every((value) => value
    && Number.isSafeInteger(value.ProcessId) && value.ProcessId > 0 && Number.isSafeInteger(value.ParentProcessId) && value.ParentProcessId >= 0
    && typeof value.ExecutablePath === "string" && typeof value.CommandLine === "string" && typeof value.CreatedAt === "string" && value.CreatedAt.length > 0));
  return values;
}
function captureHelper(node: Proc): WindowsProcess {
  const pid = node.child.pid; requireFact(pid && Number.isSafeInteger(pid));
  const normalize = (value: string) => value.replaceAll("\\", "/").toLowerCase();
  const candidates = windowsProcesses(`ParentProcessId = ${pid}`).filter((value) => normalize(value.ExecutablePath) === normalize(join(ROOT, "node.exe")));
  report.helperCandidates = candidates.map((value) => ({ pid: value.ProcessId,
    parentPid: value.ParentProcessId, createdAt: value.CreatedAt, expectedExecutable: true }));
  requireFact(candidates.length === 1);
  const helper = candidates[0]; requireFact(helper);
  // All fixed arguments are absolute paths without spaces, or fixed switches.
  // A quoted token is accepted only as a complete token; no caller text is parsed.
  const args = helper.CommandLine.match(/"[^"\r\n]*"|[^\s"]+/g)?.map((value) => value.startsWith('"') ? value.slice(1, -1) : value);
  const expected = [join(ROOT, "node.exe"), "--no-addons", "--no-global-search-paths", join(ROOT, "payload/app/main.js"),
    "deployment-host", "--registration", join(ROOT, "node-data/hindsight-host/installation.json"),
    "--deployment-registration", join(ROOT, "node-data/hindsight-host/deployment-registration.json")];
  const fixedArgvMatched = !!args && same(args.map(normalize), expected.map(normalize));
  report.helperArgvMatched = fixedArgvMatched;
  requireFact(fixedArgvMatched && helper.ParentProcessId === pid);
  capturedHelpers.push(helper);
  return helper;
}
function helperFacts(helper: WindowsProcess) {
  return { pid: helper.ProcessId, parentPid: helper.ParentProcessId, createdAt: helper.CreatedAt, executable: helper.ExecutablePath, fixedArgvVerified: true };
}
function requireHelperGone(helper: WindowsProcess): void {
  const remaining = windowsProcesses(`ProcessId = ${helper.ProcessId}`);
  requireFact(remaining.every((value) => value.CreatedAt !== helper.CreatedAt));
}
async function stopProcesses(items: Proc[]): Promise<void> {
  for (const child of items.slice().reverse()) {
    if (stoppedProcesses.has(child)) continue;
    killTree(child);
    await new Promise<void>((settle, reject) => {
      const timer = setTimeout(() => reject(new Error("PROCESS_EXIT_TIMEOUT")), budget(15_000));
      void child.exited.then(() => { clearTimeout(timer); settle(); });
    });
    stoppedProcesses.add(child);
  }
}
function requireOriginalFacts(before: OwnedDeploymentRecord, after: OwnedDeploymentRecord): void {
  requireFact(same(before.plan, after.plan) && same(before.steps, after.steps) && same(before.attempts, after.attempts)
    && before.containerId === after.containerId && same(before.volume, after.volume));
}
async function waitingStartup(containerId: string) {
  requireFact(fixture);
  const adapter = new FixedDockerAdapter(fixture.deploymentRegistration);
  const deadline = Date.now() + budget(20_000);
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    let status;
    try {
      status = await adapter.control(containerId, { version: 1, action: "status" }, AbortSignal.timeout(Math.max(1, Math.min(budget(5_000), deadline - Date.now()))));
    } catch {
      // Only this idempotent status read is polled; no mutation or old permit is replayed.
      waitingReadFailures++;
      if (Date.now() >= deadline) break;
      await new Promise<void>((settle) => setTimeout(settle, Math.min(250, deadline - Date.now())));
      continue;
    }
    requireFact(status.state === "waiting-for-credentials");
    report.startupReadPolls = { attempts: polls, transportFailures: waitingReadFailures };
    return status;
  }
  throw new Error("STARTUP_READ_TIMEOUT");
}
function requireFreshInjection(previous: DeploymentAttempt, next: DeploymentAttempt): void {
  requireFact(next.action === "inject" && next.phase === "observed" && next.startupId !== previous.startupId);
  for (const field of ["requestId", "checkpointId", "startupAuthorizationId"] as const) {
    requireFact(next[field] && previous[field] && next[field] !== previous[field]);
  }
  for (const field of ["runId", "coreAttemptId", "attemptId", "effectId"] as const) {
    requireFact(next.control[field] && previous.control[field] && next.control[field] !== previous.control[field]);
  }
  for (const field of ["snapshotId"] as const) requireFact(next.custody.input[field] !== previous.custody.input[field]);
  for (const field of ["coreOperationId", "coreAttemptId", "brokerOperationId", "hostAttemptId", "requestId", "inputDigest"] as const) {
    requireFact(next.custody.mapping[field] !== previous.custody.mapping[field]);
  }
  for (const field of ["coreBootId", "coreHostId", "catalogStoreId", "catalogKeyVersion", "sealedEnvelopeSha256", "installationId", "configurationDigest", "selection"] as const) {
    requireFact(same(next.custody.input[field], previous.custody.input[field]));
  }
  // Current control is validated by the live path. Counters need not increase across Core boots.
}
async function inspectExecs(original: OwnedDeploymentRecord, since: string, restarted: boolean) {
  requireFact(original.containerId && original.volume);
  const until = new Date().toISOString();
  const events = await docker(["events", "--since", since, "--until", until, "--filter", `container=${original.containerId}`, "--format", "{{json .}}"]);
  scan(`container-events-${restarted}`, events);
  const rows = events.toString("utf8").trim().split("\n").filter(Boolean).map((line) => json(line));
  requireFact(rows.every((entry) => entry.Type === "container" && entry.Actor?.ID === original.containerId));
  requireFact(rows.filter((entry) => entry.Action === "create").length === 1
    && rows.filter((entry) => entry.Action === "start").length === (restarted ? 2 : 1)
    && rows.filter((entry) => entry.Action === "stop").length === (restarted ? 2 : 0)
    && rows.filter((entry) => entry.Action === "die").length === (restarted ? 2 : 0));
  for (const entry of rows.filter((value) => String(value.Action).startsWith("exec_create"))) {
    const id = entry.Actor?.Attributes?.execID; requireFact(typeof id === "string" && /^[0-9a-f]{64}$/.test(id));
    if (execEvidence.has(id)) continue;
    const bytes = await readEngineEvidence("exec", id); scan(`exec-${execEvidence.size}`, bytes); const meta = json(bytes);
    const args = meta.ProcessConfig?.arguments;
    requireFact(meta.ContainerID === original.containerId && meta.ProcessConfig?.tty === false && meta.OpenStdin === true
      && meta.Running === false && Number.isInteger(meta.ExitCode) && meta.ProcessConfig?.entrypoint === "/app/api/.venv/bin/python"
      && Array.isArray(args) && args[0] === "-I" && args[1] === "-B");
    const privateModule = args.length === 4 && args[2] === "-m" && ["managed_bootstrap.control", "managed_bootstrap.submitter"].includes(args[3]);
    const fixtureProbe = args.length === 3 && args[2] === "-";
    requireFact(privateModule || fixtureProbe);
    if (meta.ExitCode !== 0) {
      // Only post-restart status polling may encounter a socket that is not ready yet.
      // All grants/submissions must already have passed their running/fence assertions.
      requireFact(restarted && privateModule && args[3] === "managed_bootstrap.control");
      failedReadExecIds.add(id);
      requireFact(failedReadExecIds.size <= waitingReadFailures);
    }
    if (privateModule && args[3] === "managed_bootstrap.submitter") submitExecIds.add(id);
    execEvidence.set(id, meta);
  }
  const volumeEvents = await docker(["events", "--since", since, "--until", until, "--filter", "type=volume", "--filter", `volume=${original.volume.name}`, "--format", "{{json .}}"]);
  scan(`volume-events-${restarted}`, volumeEvents);
  const volumes = volumeEvents.toString("utf8").trim().split("\n").filter(Boolean).map((line) => json(line));
  requireFact(volumes.every((entry) => entry.Type === "volume" && entry.Actor?.ID === original.volume?.name)
    && volumes.filter((entry) => entry.Action === "create").length === 1);
  requireFact(submitExecIds.size === (restarted ? 2 : 1));
  report[restarted ? "finalEngineEvents" : "beforeRestartEngineEvents"] = { since, until, container: rows, volume: volumes };
  report.execEvidence = [...execEvidence.values()];
}

interface DbProcess {
  pid: number; ppid: number; pgid: number; session: number; start_ticks: number;
  state: string; executable: string | null; argv: string[];
}
interface DbReady {
  version: 1; case_id: string; startup_id: string; status: string; generation: number;
  first_failure: unknown; sql: Record<string, string | number>;
  row: { case_id: string; bytes: number; sha256: string; count: number; relpersistence: string; fresh_connection: boolean };
  manifest: Record<string, unknown>; wrapper_live: DbProcess; postmaster_live: DbProcess;
  logger_live: DbProcess; start_dispatches: number; seed_committed: boolean;
  sql_ready_elapsed_seconds: number; connection_attempts: number;
}
interface DbProbe {
  version: 1; case_id: string;
  runtime: { tmpfs: true; sockets: Record<string, { uid: number; gid: number; mode: number }> };
  processes: { all: DbProcess[]; wrappers: DbProcess[]; postgres: DbProcess[]; argv_hits: number };
  marker: { pid: number; startupId: string; state: string } | null;
  current: DbReady | null; manifest: Record<string, unknown> | null;
  data_exists: boolean; intent_exists: boolean; last_stop_raw: string | null; last_stop_sha256: string | null;
}
const EXPECTED_ROW = { case_id: CASE, bytes: 4096, sha256: sha256(sha256(CASE).repeat(64)) };

async function probe(containerId: string, timeout = 6_000): Promise<DbProbe> {
  requireFact(fixture);
  const bytes = await dockerExchange(fixture.deploymentRegistration, {
    argv: ["exec", "-i", containerId, "/app/api/.venv/bin/python", "-I", "-B", "-"],
    input: readFileSync(join(HERE, "database-read.py")), signal: AbortSignal.timeout(budget(timeout)), maxBytes: 128 * 1024 });
  scan(`database-read-${Object.keys(scans).length}`, bytes);
  const value = json(bytes) as DbProbe;
  requireFact(value.version === 1 && value.case_id === CASE && value.runtime?.tmpfs === true
    && same(Object.keys(value.runtime.sockets).sort(), ["bootstrap.sock", "control.sock"])
    && Object.values(value.runtime.sockets).every((socket) => socket.uid === 1000 && socket.gid === 1000 && socket.mode === 0o600)
    && Array.isArray(value.processes?.all) && value.processes.all.length <= 64
    && Array.isArray(value.processes.wrappers) && value.processes.wrappers.length <= 1
    && Array.isArray(value.processes.postgres) && value.processes.postgres.length <= 64
    && value.processes.argv_hits === 0);
  requireFact(value.last_stop_raw === null || (typeof value.last_stop_raw === "string"
    && Buffer.byteLength(value.last_stop_raw) <= 128 * 1024 && sha256(value.last_stop_raw) === value.last_stop_sha256));
  return value;
}
function requireReady(facts: DbProbe, status: DeploymentStatusV1, generation: number): DbReady {
  const value = facts.current;
  requireFact(value && value.version === 1 && value.case_id === CASE && value.status === "ready"
    && value.startup_id === status.startupId && value.generation === generation && value.first_failure === null
    && value.start_dispatches === 1 && value.sql_ready_elapsed_seconds <= 60
    && value.seed_committed === (generation === 1) && value.connection_attempts === (generation === 1 ? 2 : 1)
    && value.row.case_id === EXPECTED_ROW.case_id && value.row.bytes === EXPECTED_ROW.bytes
    && value.row.sha256 === EXPECTED_ROW.sha256 && value.row.count === 1 && value.row.relpersistence === "p"
    && value.row.fresh_connection === (generation === 1));
  requireFact(value.sql.data_directory === "/home/hindsight/.pg0/c2a-db/data" && value.sql.fsync === "on"
    && value.sql.synchronous_commit === "on" && value.sql.full_page_writes === "on"
    && value.sql.port === "55432" && typeof value.sql.system_identifier === "string");
  requireFact(facts.marker?.state === "running" && facts.marker.startupId === status.startupId
    && facts.marker.pid === value.wrapper_live.pid && facts.processes.wrappers.length === 1
    && facts.processes.wrappers[0]?.pid === value.wrapper_live.pid
    && value.postmaster_live.ppid === value.wrapper_live.pid
    && facts.processes.postgres.some((p) => p.pid === value.postmaster_live.pid && p.start_ticks === value.postmaster_live.start_ticks)
    && value.logger_live.ppid === value.postmaster_live.pid && same(facts.manifest, value.manifest));
  return value;
}
async function readyDatabase(status: DeploymentStatusV1, generation: number): Promise<DbReady> {
  requireFact(status.containerId);
  const deadline = Date.now() + budget(65_000);
  while (Date.now() < deadline) {
    const facts = await probe(status.containerId, Math.min(6_000, deadline - Date.now()));
    report.latestDatabaseRead = { expectedStartupId: status.startupId, expectedGeneration: generation,
      recordedAt: new Date().toISOString(), facts };
    if (facts.current?.startup_id === status.startupId) return requireReady(facts, status, generation);
    if (facts.last_stop_raw) requireFact(json(facts.last_stop_raw).startup_id !== status.startupId);
    await new Promise<void>((settle) => setTimeout(settle, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
  throw new Error("DATABASE_READY_TIMEOUT");
}
function checkedStop(raw: string, ready: DbReady) {
  const bytes = Buffer.from(raw, "utf8"); requireFact(bytes.length <= 128 * 1024);
  scan(`database-stop-${ready.generation}`, bytes);
  const value = json(bytes);
  requireFact(value.version === 1 && value.case_id === CASE && value.startup_id === ready.startup_id
    && value.generation === ready.generation && value.status === "stopped" && value.first_failure === null
    && value.shutdown?.state === "checked" && value.shutdown.system_identifier === ready.sql.system_identifier
    && value.shutdown.owned_descendants_remaining === 0 && value.shutdown.logger_gone === true
    && value.shutdown_evidence_seconds <= 25 && value.elapsed_seconds <= 300
    && value.volume_scan?.complete === true && value.volume_scan.hits === 0
    && value.volume_scan.entries <= 4096 && value.volume_scan.bytes + value.volume_scan.link_bytes <= 1024 ** 3
    && same(value.manifest, ready.manifest) && same(value.row, ready.row)
    && same(value.postmaster_live, ready.postmaster_live));
  const waited = ready.generation === 1 ? value.reaped : [value.postmaster_direct_wait];
  requireFact(Array.isArray(waited) && waited.some((p) => p.pid === ready.postmaster_live.pid && p.exit_code === 0)
    && value.reaped.every((p: { exit_code: number }) => p.exit_code === 0)
    && value.commands.some((command: { argv: string[]; exit_code: number; output: string }) =>
      command.argv[0]?.endsWith("/pg_ctl") && command.argv[1] === "stop" && command.exit_code === 0)
    && value.commands.some((command: { argv: string[]; exit_code: number; output: string }) =>
      command.argv[0]?.endsWith("/pg_controldata") && command.exit_code === 0 && command.output.includes("shut down")));
  return value;
}

// The execute contains control only; its exact Effect is the unchanged request already captured
// by this relay. The authorization remains in the relay closure and is never retained in evidence.
// eslint-disable-next-line max-lines-per-function
async function startWithPreInjectionObservation(): Promise<DeploymentStatusV1> {
  requireFact(relay && fixture);
  const current = relay; const registration = fixture.deploymentRegistration;
  let target: CapabilityRequest | undefined;
  let observation: Promise<void> | undefined;
  let failed = false; let released = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    failed = true;
    closing ??= current.close().catch(() => { report.relayCloseFailed = true; });
    return closing;
  };
  const onRequest = (request: CapabilityRequest): CapabilityRequest => {
    try {
      if (request.control.capabilityId === "hindsight-deployment") {
        const effect = DeploymentEffectV1Schema.parse(request.input);
        if (effect.action === "inject") {
          requireFact(!target); target = request;
          observation = current.pauseNextExecute(budget(20_000)).then(async (held) => {
            const capturedAt = Date.now(); const deadline = capturedAt + 10_000;
            const timer = setTimeout(() => { void close(); }, 10_000);
            const remaining = (limit: number) => { requireFact(!failed && Date.now() < deadline); return Math.min(limit, deadline - Date.now()); };
            try {
              requireFact(held.execute.requestId === request.requestId && same(held.execute.control, request.control)
                && same(DeploymentEffectV1Schema.parse(request.input), effect));
              const original = ownedRegistry();
              requireFact(original.containerId === effect.containerId && same(original.plan, effect.plan));
              const native = await new FixedDockerAdapter(registration).control(effect.containerId,
                { version: 1, action: "status" }, AbortSignal.timeout(remaining(4_000)));
              const before = await probe(effect.containerId, remaining(5_000));
              requireFact(native.state === "waiting-for-credentials" && native.startupId === effect.startupId
                && native.authorizationId === undefined && before.processes.wrappers.length === 0
                && before.processes.postgres.length === 0 && before.marker === null
                && before.data_exists === false && before.intent_exists === false && before.manifest === null);
              remaining(1);
              report.beforeInjection = { requestId: request.requestId, control: request.control,
                startupId: effect.startupId, containerId: effect.containerId, native, process: before,
                captureToReleaseMs: Date.now() - capturedAt };
              held.release(); released = true;
            } finally { clearTimeout(timer); }
          }).catch(close);
          return request;
        }
      }
      current.mutateNext(onRequest);
    } catch { void close(); }
    return request;
  };
  current.mutateNext(onRequest);
  stage = "pre-injection-observation-and-start";
  try {
    const result = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.start, startInput());
    await observation;
    requireFact(target && observation && released && !failed && result.state === "running" && result.deploymentReady === false);
    return result;
  } catch (error) { await close(); throw error; }
}
async function runningSurfaces(status: DeploymentStatusV1) {
  requireFact(status.containerId);
  const bytes = await docker(["container", "inspect", status.containerId]); const container = json(bytes)[0];
  requireFact(container.Id === status.containerId && container.Config.Tty === false && container.State.Running === true
    && container.Config.User === "1000:1000" && container.HostConfig.NetworkMode === "none");
  scanContainerLogs(await readEngineEvidence("logs", status.containerId));
  report[`runningContainer-${status.startupId}`] = container;
}
async function stopDatabase(original: OwnedDeploymentRecord) {
  requireFact(fixture && original.containerId);
  const found = await new FixedDockerAdapter(fixture.deploymentRegistration).inspectOwned(original.plan, AbortSignal.timeout(budget(20_000)));
  requireFact(found.container?.id === original.containerId && found.container.running && same(found.volume, original.volume));
  await docker(["stop", "--time", "45", original.containerId], 55_000);
  const state = json(await docker(["container", "inspect", original.containerId]))[0].State;
  requireFact(state.Running === false && state.ExitCode === 0 && state.OOMKilled === false && !state.Error);
  scanContainerLogs(await readEngineEvidence("logs", original.containerId));
  return state;
}
// eslint-disable-next-line max-lines-per-function -- Keep the fixed stop/preserve/observe/resume ordering in one task-only sequence.
async function restartAndResume(original: OwnedDeploymentRecord, first: DbReady, status: DeploymentStatusV1) {
  requireFact(original.containerId && status.operationId);
  stage = "first-database-stop";
  const stopped = await stopDatabase(original);
  await docker(["start", original.containerId], 15_000);
  const native = await waitingStartup(original.containerId);
  requireFact(native.startupId !== status.startupId && native.configurationDigest === original.plan.configurationDigest
    && native.operationId === undefined && native.attemptId === undefined && native.authorizationId === undefined && native.deadlineAt === undefined);
  const fresh = await probe(original.containerId);
  requireFact(fresh.processes.wrappers.length === 0 && fresh.processes.postgres.length === 0
    && fresh.marker?.startupId === first.startup_id && fresh.marker.state === "stopped"
    && same(fresh.manifest, first.manifest) && fresh.last_stop_raw && fresh.last_stop_sha256);
  const firstStop = checkedStop(fresh.last_stop_raw, first);
  const firstStopPath = join(STAGING, "first-stop.json");
  writeFileSync(firstStopPath, Buffer.from(fresh.last_stop_raw, "utf8"), { flag: "wx" });
  requireFact(fileDigest(firstStopPath) === fresh.last_stop_sha256);
  report.firstStop = { rawPath: firstStopPath, sha256: fresh.last_stop_sha256, result: firstStop, container: stopped };
  const waiting = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.observe, { deploymentId: status.operationId });
  requireFact(waiting.state === "waiting" && waiting.startupId === native.startupId && waiting.attemptId === undefined
    && waiting.containerId === original.containerId && waiting.operationId === status.operationId);
  requireFact(same(await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.start, startInput()), waiting));
  requireOriginalFacts(original, ownedRegistry());
  const afterReads = await probe(original.containerId);
  requireFact(afterReads.processes.wrappers.length === 0 && afterReads.processes.postgres.length === 0);
  report.beforeResume = { native, waiting, process: afterReads, originalAuthorityNotReplayed: true };
  stage = "fresh-startup-resume";
  const next = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.resumeStartup, { deploymentId: status.operationId });
  requireFact(next.state === "running" && next.startupId === native.startupId && next.operationId === status.operationId
    && next.containerId === original.containerId && next.deploymentReady === false);
  const after = ownedRegistry();
  requireFact(after.attempts.length === 4 && same(after.attempts.slice(0, 3), original.attempts)
    && same(after.steps, original.steps) && same(after.plan, original.plan) && same(after.volume, original.volume));
  const previous = original.attempts[2]; const attempt = after.attempts[3]; requireFact(previous && attempt);
  requireFreshInjection(previous, attempt);
  requireFact(attempt.startupId === next.startupId && attempt.control.attemptId === next.attemptId
    && attempt.control.operationId === original.plan.operationId);
  const run = await readRun(attempt.control.runId);
  requireFact(run.run.state === "completed" && run.run.outcome === "completed" && run.attempts.length === 1
    && run.run.activeAttemptId === attempt.control.coreAttemptId && run.attempts[0]?.outcome === "completed"
    && run.run.idempotencyKey === `hindsight-deployment:startup:v1:${original.plan.deploymentId}:${native.startupId}`
    && run.run.provenance.parentRunId === original.plan.deploymentId);
  stage = "second-database-readiness";
  const second = await readyDatabase(next, 2);
  requireFact(same(first.manifest, second.manifest) && first.sql.system_identifier === second.sql.system_identifier
    && first.sql.postmaster_start_time !== second.sql.postmaster_start_time);
  requireFact(same(await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.resumeStartup, { deploymentId: status.operationId }), next));
  requireOriginalFacts(after, ownedRegistry());
  requireFact(same((await probe(original.containerId)).current?.postmaster_live, second.postmaster_live));
  report.secondGeneration = { status: next, ready: second, registry: registryFacts(after), startupRun: runFacts(run), repeatedResumeObservedOnly: true };
  await runningSurfaces(next);
  return second;
}
async function persistenceCase(generation: Generation) {
  capacity(); const since = new Date().toISOString();
  const status = await startWithPreInjectionObservation();
  stage = "initial-resource-contract";
  const original = ownedRegistry();
  requireFact(original.containerId && original.attempts.map((a) => a.action).join(",") === "create,start,inject"
    && original.attempts[2]?.phase === "observed"
    && original.attempts.every((a) => a.control.effectId && a.control.coreAttemptId)
    && original.steps.volume === "verified" && original.steps.container === "verified"
    && original.steps.start === "verified", "INITIAL_RESOURCE_CONTRACT");
  stage = "initial-helper-identity";
  const helper = captureHelper(generation.node);
  stage = "initial-run-contract";
  const initialRun = await readRun(original.plan.deploymentId);
  report.initialRun = runFacts(initialRun);
  requireFact(initialRun.run.state === "completed" && initialRun.run.outcome === "completed"
    && initialRun.run.activeAttemptId === original.attempts[0]?.control.coreAttemptId, "INITIAL_RUN_CONTRACT");
  stage = "first-database-readiness";
  const first = await readyDatabase(status, 1);
  report.firstGeneration = { status, ready: first, registry: registryFacts(original), helper: helperFacts(helper), corePid: generation.core.child.pid };
  await runningSurfaces(status);
  await inspectExecs(original, since, false); // Keep pre-restart exec metadata before the engine can discard it.
  const second = await restartAndResume(original, first, status);
  stage = "second-database-stop";
  const state = await stopDatabase(original);
  const path = join(STAGING, "final-stop.json"); requireFact(!existsSync(path));
  await docker(["cp", `${original.containerId}:/home/hindsight/.pg0/c2a-db/last-stop.json`, path], 10_000);
  const metadata = lstatSync(path);
  requireFact(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 128 * 1024);
  const raw = readFileSync(path); const finalStop = checkedStop(raw.toString("utf8"), second);
  report.finalStop = { rawPath: path, sha256: sha256(raw), result: finalStop, container: state };
  await inspectExecs(original, since, true);
  report.effectCounts = { containerCreate: 1, volumeCreate: 1, containerStart: 2, containerStop: 2,
    privateSubmit: 2, pg0Initialization: 1, rawPostgresRestart: 1,
    source: "actual resource events, exec metadata, protected registry and both generation reports" };
}

function readEngineEvidence(kind: "exec" | "logs", id: string): Promise<Buffer> {
  // Read-only Engine exec inspection fills the one fact absent from CLI inspect:
  // the actual exec TTY flag. IDs originate only in this container's events.
  requireFact(/^[0-9a-f]{64}$/.test(id));
  const path = kind === "exec" ? `/exec/${id}/json` : `/containers/${id}/logs?stdout=true&stderr=true&follow=false&tail=all`;
  return new Promise((resolveResult, reject) => {
    const call = request({ socketPath: String.raw`\\.\pipe\dockerDesktopLinuxEngine`, path, method: "GET",
      signal: AbortSignal.timeout(budget(10_000)) }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (part: Buffer) => { size += part.length; if (size > 64 * 1024) call.destroy(new Error("LIMIT")); else chunks.push(part); });
      response.on("error", reject);
      response.on("end", () => response.statusCode === 200 ? resolveResult(Buffer.concat(chunks)) : reject(new Error("EXEC_INSPECT_FAILED")));
    });
    call.on("error", reject); call.end();
  });
}

function scanContainerLogs(bytes: Buffer) {
  // Non-TTY Engine logs have an eight-byte header per frame. Join each stream
  // before scanning so a sentinel split between frames cannot evade the check.
  const stdout: Buffer[] = []; const stderr: Buffer[] = []; let offset = 0;
  while (offset < bytes.length) {
    requireFact(offset + 8 <= bytes.length);
    const stream = bytes[offset]; const length = bytes.readUInt32BE(offset + 4);
    requireFact((stream === 1 || stream === 2) && bytes.subarray(offset + 1, offset + 4).every((byte) => byte === 0)
      && offset + 8 + length <= bytes.length);
    (stream === 1 ? stdout : stderr).push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  scan("container-stdout", Buffer.concat(stdout)); scan("container-stderr", Buffer.concat(stderr));
}

function scanTree() {
  let bytes = 0; let files = 0; const pending = [ROOT];
  while (pending.length) {
    const path = pending.pop(); requireFact(path); const metadata = lstatSync(path);
    requireFact(!metadata.isSymbolicLink());
    if (metadata.isDirectory()) { pending.push(...readdirSync(path).map((name) => join(path, name))); continue; }
    bytes += metadata.size; files++; requireFact(metadata.isFile() && files <= 4096 && bytes <= 256 * 1024 ** 2 && metadata.size <= 128 * 1024 ** 2);
    const content = readFileSync(path); requireFact(!/C2A_FAKE_[0-9a-f]{64}/.test(content.toString("utf8")));
  }
  report.localFiles = { files, bytes, hits: 0 };
}

async function retainFailureStop(original: OwnedDeploymentRecord): Promise<void> {
  // This is the existing fixed report, after the same cleanup stop and before deletion.
  // A missing/stale report is secondary evidence; it cannot hide the first failed assertion.
  const path = join(STAGING, "failure-stop.json");
  const expectedStartupId = original.attempts.filter((attempt) => attempt.action === "inject").at(-1)?.startupId;
  try {
    requireFact(original.containerId && !existsSync(path));
    await docker(["cp", `${original.containerId}:/home/hindsight/.pg0/c2a-db/last-stop.json`, path], 10_000);
    const metadata = lstatSync(path);
    requireFact(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 128 * 1024);
    const bytes = readFileSync(path); scan("failure-stop-report", bytes);
    const value = json(bytes);
    requireFact(value.version === 1 && value.case_id === CASE
      && typeof value.startup_id === "string" && value.startup_id === expectedStartupId);
    report.failureStop = { outcome: "retained", path, bytes: bytes.length, sha256: sha256(bytes), result: value };
  } catch (error) {
    report.failureStop = { outcome: "unavailable-or-invalid", code: failureCode(error),
      path, expectedStartupId: expectedStartupId ?? null };
  }
}

// eslint-disable-next-line max-lines-per-function -- Preserve the single ordered stop/evidence/removal sequence for this task fixture.
async function cleanup() {
  stage = "owned-cleanup"; cleanupDeadline = Date.now() + 5 * 60_000; operator?.close();
  await relay?.close();
  report.ownedProcessIds = processes.map((child) => child.child.pid);
  report.pendingImageTag = IMAGE_TAG;
  if (fixture) report.pendingRegistry = join(fixture.deploymentRegistration.stateDirectory, "deployment.json");
  await stopProcesses(processes);
  for (const helper of capturedHelpers) requireHelperGone(helper);
  report.reapedHelpers = capturedHelpers.map(helperFacts);
  // A failed provision still leaves Root's prepared image. Never claim complete cleanup without its binding.
  requireFact(fixture);
  if (fixture) {
    const registry = new DeploymentRegistry(fixture.deploymentRegistration.stateDirectory).snapshot();
    const adapter = new FixedDockerAdapter(fixture.deploymentRegistration);
    if (registry.state === "owned") {
      report.cleanupOriginal = { deploymentId: registry.plan.deploymentId, names: resourceNames(registry.plan),
        containerId: registry.containerId ?? null, volume: registry.volume?.name ?? null };
      scan("process-logs", processes.flatMap((child) => [...child.stdout.lines(), ...child.stderr.lines()]).join("\n"));
      const found = await adapter.inspectOwned(registry.plan, AbortSignal.timeout(budget(30_000)));
      requireFact(!found.container || found.container.id === registry.containerId);
      requireFact(!found.volume || JSON.stringify(found.volume) === JSON.stringify(registry.volume));
      if (found.container) {
        if (found.container.running) await docker(["stop", "--time", "45", found.container.id], 55_000);
        requireFact(json(await docker(["container", "inspect", found.container.id]))[0].State.Running === false);
        if (report.casePassed !== true) await retainFailureStop(registry);
        await docker(["rm", found.container.id]);
      }
      if (found.volume) {
        requireFact((await docker(["container", "ls", "--all", "--filter", `volume=${found.volume.name}`, "--format", "{{.ID}}"])).toString("utf8").trim() === "");
        await docker(["volume", "rm", found.volume.name]);
      }
      const remaining = await adapter.inspectOwned(registry.plan, AbortSignal.timeout(budget(30_000)));
      requireFact(!remaining.container && !remaining.volume); report.resourcesRemoved = resourceNames(registry.plan);
    }
    const image = json(await docker(["image", "inspect", IMAGE_TAG]))[0];
    requireFact(image.Id === fixture.deploymentRegistration.image.id && image.Id !== BASE_IMAGE && image.Config.Labels?.["taki.c2a.fixture"] === CASE
      && image.RepoTags?.length === 1 && image.RepoTags[0] === IMAGE_TAG);
    requireFact((await docker(["container", "ls", "--all", "--filter", `ancestor=${image.Id}`, "--format", "{{.ID}}"])).toString("utf8").trim() === "");
    await docker(["image", "rm", IMAGE_TAG]);
    requireFact((await docker(["image", "ls", "--filter", `reference=${IMAGE_TAG}`, "--format", "{{.ID}}"])).toString("utf8").trim() === "");
    report.imageTagRemoved = IMAGE_TAG;
    report.pendingImageTag = null;
  }
  if (ownsRoot) {
    scanTree(); report.protectedTreeScannedAfterStop = true;
    requireFact(realpathSync(ROOT).toLowerCase() === ROOT.toLowerCase() && readFileSync(join(ROOT, ".c2a-docker-owner"), "utf8") === CASE);
    const system = process.env.SystemRoot; requireFact(system);
    command(join(system, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
      "Remove-Item -LiteralPath '" + ROOT + "' -Recurse -Force -ErrorAction Stop"], STAGING);
    requireFact(!existsSync(ROOT)); report.protectedRootRemoved = true;
  }
}

async function main() {
  requireFact(process.argv.length === 3 && process.argv[2] === "--execute-approved-persistence" && process.platform === "win32");
  requireFact(resolve(process.execPath).toLowerCase() === resolve("C:/Program Files/nodejs/node.exe").toLowerCase());
  requireFact(!existsSync(ROOT) && realpathSync(STAGING).toLowerCase() === STAGING.toLowerCase()
    && readFileSync(join(STAGING, ".c2a-docker-owner"), "utf8") === CASE);
  // Cargo keeps a second hard link to the accepted Shell binary. This is a
  // public build-artifact pin, not the single-link installed-file trust check.
  for (const [path, digest] of Object.entries(PINNED)) requireFact(sha256(readFileSync(path)) === digest);
  const sourcePath = join(HERE, "../c2a-implementation-source-manifest.json");
  requireFact(fileDigest(sourcePath) === "f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2");
  for (const entry of json(readFileSync(sourcePath)).files) requireFact(fileDigest(entry.absolutePath) === entry.afterSha256);
  report.inputs = { launcherSha256: fileDigest(fileURLToPath(import.meta.url)), probeSha256: fileDigest(join(HERE, "database-read.py")),
    childSha256: fileDigest(join(HERE, "fake_child.py")), sourceManifestSha256: fileDigest(sourcePath) };
  requireFact(json(readFileSync(join(STAGING, "base-probe.json"))).compatible === true);
  writeFileSync(join(STAGING, "persistence.started"), new Date().toISOString(), { flag: "wx" }); ownsRun = true;
  initialGFree = json(readFileSync(join(STAGING, "baseline.json"))).gFree;
  requireFact(Number.isSafeInteger(initialGFree) && initialGFree > 0); capacity();
  const paths = await provision(); requireFact(fixture);
  stage = "engine-and-result-image";
  const adapter = new FixedDockerAdapter(fixture.deploymentRegistration);
  await adapter.inspectEngine(AbortSignal.timeout(budget(20_000))); await adapter.inspectImage(AbortSignal.timeout(budget(20_000)));
  const bytes = await docker(["image", "inspect", IMAGE_TAG]); scan("image-metadata", bytes); const image = json(bytes)[0];
  requireFact(image.Id === fixture.deploymentRegistration.image.id && image.Config.User === "1000:1000"
    && image.Config.Labels?.["taki.c2a.fixture"] === CASE && Object.keys(image.Config.Volumes ?? {}).length === 0
    && JSON.stringify(image.Config.Entrypoint) === JSON.stringify(["/app/api/.venv/bin/python", "-I", "-B", "-m", "managed_bootstrap.owner"])
    && (!image.Config.Cmd || image.Config.Cmd.length === 0));
  const generation = await boot(paths);
  await persistenceCase(generation); capacity(); report.casePassed = true;
}

function writeEvidence(): void {
  let evidence: string;
  try {
    evidence = JSON.stringify(report, null, 2);
    scan("retained-evidence", evidence);
    evidence = JSON.stringify(report, null, 2);
    requireFact(Buffer.byteLength(evidence) <= 1024 * 1024);
  } catch {
    // Keep a bounded failure record even when the detailed evidence itself cannot be exported.
    report.casePassed = false; process.exitCode = 1;
    evidence = JSON.stringify({ version: 1, caseId: CASE, casePassed: false, deploymentReady: false,
      evidenceFailure: "size-or-containment", ownedRuntimeCleanup: report.ownedRuntimeCleanup === true });
  }
  writeFileSync(join(STAGING, "persistence.json"), evidence, { flag: "wx" });
}

try { await main(); }
catch (error) { report.casePassed = false; report.failureStage = stage; report.failureCode = failureCode(error); process.exitCode = 1; }
finally {
  if (ownsRun) {
    try { await cleanup(); requireFact(report.protectedTreeScannedAfterStop === true); report.ownedRuntimeCleanup = true; }
    catch (error) { report.casePassed = false; report.ownedRuntimeCleanup = false; report.cleanupFailureStage = stage; report.cleanupFailureCode = failureCode(error); process.exitCode = 1; }
    report.commands = commands; report.scans = scans; report.elapsedMs = Date.now() - startedAt;
    report.stagingDisposition = "Retained for Root to copy evidence, verify paths, and remove; build cache/VHDX reclamation unclaimed";
    writeEvidence();
  }
  console.log(JSON.stringify({ caseId: CASE, passed: report.casePassed ?? false, ownedRuntimeCleanup: report.ownedRuntimeCleanup ?? false,
    evidence: ownsRun ? join(STAGING, "persistence.json") : null, deploymentReady: false }));
}
