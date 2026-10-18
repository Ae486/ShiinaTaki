/**
 * INPUT:  one prepared immutable fake image/key adapter and the reviewed recovery token/roots
 * OUTPUT: exact Host completion loss, original-state recovery, fresh-startup admission and owned cleanup
 * POS:    task-only fixed experiment; no production fault option, private Native ACK claim or database proof
 */
/* eslint-disable max-lines -- One single-use task fixture retains its reviewed sequence and exact cleanup; production limits are unchanged. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs";
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
import type { CapabilityRequest, CapabilityRespondParams } from "../../../../../packages/shared/src/host-control-schema.ts";
import { getFreePort, killTree, spawnProc, type Proc } from "../../../../../e2e/src/fixture/procs.ts";
import { jsonLine } from "../../../../../e2e/src/fixture/line-buffer.ts";
import { pairOperator, setPermissionLevel } from "../../../../../e2e/src/fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "../../../../../e2e/src/fixture/rpc-socket.ts";
import { startCapabilityRelay, type CapabilityRelay } from "../../../../../e2e/src/fixture/ws-relay.ts";

const CASE = "775da07b-2b69-44a3-868c-2604423dac11";
const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = resolve(`C:/taki-c2a-docker-recovery-${CASE}`);
const STAGING = resolve(`G:/TakiAgent-c2a-docker-acceptance/recovery-${CASE}`);
const IMAGE_TAG = `taki-c2a-fake:${CASE}`;
const BASE_IMAGE = "sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db";
const DOCKER = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
const SHELL = join(REPOSITORY, "apps/desktop/src-tauri/target/debug/taki-node.exe");
const CONFIG = { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:9" };
const PINNED = {
  [DOCKER]: "0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d",
  "C:/Program Files/nodejs/node.exe": "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de",
  [SHELL]: "1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9",
};
const report: Record<string, unknown> = { version: 1, caseId: CASE, scope: "isolated-docker-recovery", deploymentReady: false,
  evidenceBoundary: "Host completion loss; inner Native socket ACK loss and database persistence are untested" };
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
interface Probe {
  version: 1;
  runtime: { tmpfs: true; sockets: Record<string, { uid: number; gid: number; mode: number }> };
  volumeMarkerSha256: string | null; tmpfsMarkerSha256: string | null;
  childMarker: { pid: number; startupId: string; state: "running" | "stopped" };
  children: Array<{ pid: number; startTicks: string }>;
}
interface BootPaths { nodeData: string; credentials: string }
interface Generation { core: Proc; node: Proc }

function requireFact(value: unknown): asserts value { if (!value) throw new Error("C2A_CHECK_FAILED"); }
function json(bytes: Uint8Array | string) { return JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8")); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function scan(name: string, bytes: Uint8Array | string) {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  const hits = [...buffer.toString("utf8").matchAll(/C2A_FAKE_[0-9a-f]{64}/g)].length;
  scans[name] = { bytes: buffer.length, hits }; requireFact(hits === 0);
}
function free(path: string) { const value = statfsSync(path); return value.bavail * value.bsize; }
function budget(limit: number) {
  const remaining = (stage === "owned-cleanup" ? cleanupDeadline : startedAt + 8 * 60_000) - Date.now();
  requireFact(remaining > 0); return Math.min(limit, remaining);
}
function capacity() {
  requireFact(free("G:/") >= 20 * 1024 ** 3 && initialGFree - free("G:/") <= 2 * 1024 ** 3);
  requireFact(free("C:/") >= 1024 ** 3 && Date.now() - startedAt < 8 * 60_000);
}
async function docker(argv: string[], timeout = 15_000) {
  requireFact(fixture);
  return dockerExchange(fixture.deploymentRegistration, { argv, signal: AbortSignal.timeout(budget(timeout)) });
}
function command(path: string, args: string[]) {
  const result = spawnSync(path, args, { windowsHide: true, encoding: "utf8", timeout: budget(15_000), maxBuffer: 32 * 1024,
    env: { SystemRoot: process.env.SystemRoot }, cwd: ROOT });
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

async function boot(paths: BootPaths, reopening: boolean): Promise<Generation> {
  requireFact(fixture); stage = reopening ? "reopen-core-shell-operator" : "core-shell-operator";
  const port = await getFreePort(); const url = `ws://127.0.0.1:${port}`;
  const base = { SystemRoot: process.env.SystemRoot, TEMP: STAGING, TMP: STAGING, WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" };
  const core = spawnProc({ command: process.execPath, args: [join(REPOSITORY, "packages/core/src/main.ts")], cwd: ROOT,
    env: { ...base, ...CONFIG, TAKI_DATA_DIR: fixture.registration.coreDataDirectory, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "false", TAKI_CREDENTIALS_DIRECTORY: paths.credentials,
      TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "e2e-dummy-key", TAKI_PROVIDER_MODEL: "e2e-dummy-model" } });
  processes.push(core); await core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", budget(30_000));
  if (!reopening) relay = await startCapabilityRelay(url);
  else requireFact(relay?.isClosed() && relay.activeConnectionCount() === 0);
  // Reopening uses the new Core URL and retained Node token. The old fault relay stays closed.
  const node = spawnProc({ command: SHELL, args: [], cwd: paths.nodeData, env: { ...base, TAKI_DATA_DIR: paths.nodeData,
    TAKI_WS_URL: reopening ? url : relay?.url, TAKI_DEVICE_NAME: "C2a recovery fixture", TAKI_GATE_AUTOAPPROVE: "allow-once",
    TAKI_CAPABILITIES: "hindsight-custody,hindsight-deployment,hindsight-deployment-observe" } });
  processes.push(node);
  const codeFor = async (name: string) => String(jsonLine(await core.stdout.waitFor((line) => {
    const entry = jsonLine(line); return entry?.msg === "pairing code issued" && entry.deviceName === name;
  }, budget(20_000)))?.code);
  if (!reopening) node.child.stdin?.write(`${await codeFor("C2a recovery fixture")}\n`);
  await node.stderr.waitFor((line) => line.includes("state=connected"), budget(30_000));
  operator = await openRpcSocket(url);
  await pairOperator(operator, { deviceId: randomUUID(), deviceName: "C2a recovery operator", getCode: () => codeFor("C2a recovery operator") });
  if (!reopening) await setPermissionLevel(operator, "relaxed");
  return { core, node };
}

function startInput() {
  requireFact(fixture);
  return { idempotencyKey: CASE, expectedConfigurationDigest: fixture.plan.configurationDigest };
}
async function deploymentCall(method: string, params: unknown): Promise<DeploymentStatusV1> {
  requireFact(operator);
  const result = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request(method, params, budget(90_000))).result);
  scan(`status-${Object.keys(scans).length}`, JSON.stringify(result));
  return result;
}
function ownedRegistry(): OwnedDeploymentRecord {
  requireFact(fixture);
  const record = new DeploymentRegistry(fixture.deploymentRegistration.stateDirectory).snapshot();
  requireFact(record.state === "owned" && record.containerId && record.volume);
  scan(`registry-${Object.keys(scans).length}`, JSON.stringify(record));
  return record;
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
async function requireUnknownRun(runId: string) {
  const result = await readRun(runId);
  requireFact(result.run.runId === runId && result.run.state === "outcome_unknown" && result.run.outcome === "outcome_unknown"
    && result.attempts.find((entry) => entry.attemptId === result.run.activeAttemptId)?.outcome === "outcome_unknown");
  return runFacts(result);
}

// The one fault closure owns its callbacks until the selected completion is discarded.
// eslint-disable-next-line max-lines-per-function
async function loseHostCompletion(): Promise<DeploymentStatusV1> {
  requireFact(relay);
  const current = relay;
  let target: CapabilityRequest | undefined;
  let held: DeploymentStatusV1 | undefined;
  let closing: Promise<void> | undefined;
  let dropped = 0;
  let failed = false;
  const close = () => { closing = current.close().catch(() => { failed = true; }); };
  const response = (value: CapabilityRespondParams): CapabilityRespondParams => {
    try {
      if (value.requestId !== target?.requestId) { current.mutateNextResponse(response); return value; }
      requireFact(same(value.control, target.control) && value.state === "completed");
      const effect = DeploymentEffectV1Schema.parse(target.input);
      requireFact(effect.action === "inject");
      held = DeploymentStatusV1Schema.parse(value.output);
      requireFact(held.state === "running" && held.deploymentId === effect.plan.deploymentId
        && held.operationId === effect.plan.operationId && held.configurationDigest === effect.plan.configurationDigest
        && held.containerId === effect.containerId && held.startupId === effect.startupId
        && held.attemptId === value.control.attemptId && dropped === 0);
      dropped++;
      report.fault = { boundary: "Host completion before Core acceptance", requestId: value.requestId,
        control: value.control, heldStatus: held, heldAt: new Date().toISOString(), droppedCount: dropped };
      // close() terminates the upstream synchronously. Returning the unchanged
      // frame cannot reach forwardToCore's OPEN/CONNECTING forwarding branches.
      close();
      requireFact(current.isClosed() && current.activeConnectionCount() === 0);
    } catch { failed = true; close(); }
    return value;
  };
  const request = (value: CapabilityRequest): CapabilityRequest => {
    try {
      if (value.control.capabilityId === "hindsight-deployment") {
        const effect = DeploymentEffectV1Schema.parse(value.input);
        if (effect.action === "inject") {
          requireFact(!target);
          target = value;
          current.mutateNextResponse(response);
          return value;
        }
      }
      current.mutateNext(request);
    } catch { failed = true; close(); }
    return value;
  };
  current.mutateNext(request);
  stage = "drop-exact-host-completion";
  const result = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.start, startInput());
  requireFact(closing && held && !failed && dropped === 1 && result.state === "outcome-unknown"
    && result.deploymentId === held.deploymentId);
  await closing;
  requireFact(!failed && current.isClosed() && current.activeConnectionCount() === 0 && held.operationId);
  report.initialUnknownStatus = result;
  report.originalRunBeforeInterruption = await requireUnknownRun(held.operationId);
  return held;
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
  requireFact(candidates.length === 1);
  const helper = candidates[0]; requireFact(helper);
  // All fixed arguments are absolute paths without spaces, or fixed switches.
  // A quoted token is accepted only as a complete token; no caller text is parsed.
  const args = helper.CommandLine.match(/"[^"\r\n]*"|[^\s"]+/g)?.map((value) => value.startsWith('"') ? value.slice(1, -1) : value);
  const expected = [join(ROOT, "node.exe"), "--no-addons", "--no-global-search-paths", join(ROOT, "payload/app/main.js"),
    "deployment-host", "--registration", join(ROOT, "node-data/hindsight-host/installation.json"),
    "--deployment-registration", join(ROOT, "node-data/hindsight-host/deployment-registration.json")];
  requireFact(args && same(args.map(normalize), expected.map(normalize)) && helper.ParentProcessId === pid);
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
async function probe(containerId: string, action: "read" | "seed"): Promise<Probe> {
  requireFact(fixture);
  const bytes = await dockerExchange(fixture.deploymentRegistration, {
    argv: ["exec", "-i", containerId, "/app/api/.venv/bin/python", "-I", "-B", "-", action],
    input: readFileSync(join(HERE, "recovery-probe.py")), signal: AbortSignal.timeout(budget(20_000)), maxBytes: 16 * 1024 });
  scan(`probe-${Object.keys(scans).length}`, bytes);
  const value = json(bytes) as Probe;
  requireFact(value.version === 1 && value.runtime?.tmpfs === true
    && same(Object.keys(value.runtime.sockets).sort(), ["bootstrap.sock", "control.sock"])
    && Object.values(value.runtime.sockets).every((socket) => socket.uid === 1000 && socket.gid === 1000 && socket.mode === 0o600)
    && [value.volumeMarkerSha256, value.tmpfsMarkerSha256].every((hash) => hash === null || (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)))
    && Number.isSafeInteger(value.childMarker?.pid) && value.childMarker.pid > 0 && typeof value.childMarker.startupId === "string"
    && ["running", "stopped"].includes(value.childMarker.state) && Array.isArray(value.children) && value.children.length <= 1
    && value.children.every((child) => Number.isSafeInteger(child.pid) && child.pid > 0 && typeof child.startTicks === "string" && /^[1-9][0-9]*$/.test(child.startTicks)));
  return value;
}
function requireRunningChild(facts: Probe, status: DeploymentStatusV1): void {
  requireFact(facts.childMarker.startupId === status.startupId && facts.childMarker.state === "running"
    && facts.children.length === 1 && facts.children[0]?.pid === facts.childMarker.pid);
}
function requireSameChild(before: Probe, after: Probe): void {
  requireFact(same(before.childMarker, after.childMarker) && same(before.children, after.children));
}
function requireOriginalFacts(before: OwnedDeploymentRecord, after: OwnedDeploymentRecord): void {
  requireFact(same(before.plan, after.plan) && same(before.steps, after.steps) && same(before.attempts, after.attempts)
    && before.containerId === after.containerId && same(before.volume, after.volume));
}
function stableFilePins(paths: BootPaths): Record<string, string> {
  requireFact(fixture);
  const core = fixture.registration.coreDataDirectory;
  const secrets = json(readFileSync(join(paths.nodeData, "secrets.json")));
  requireFact(secrets["device-id"] === fixture.registration.executionHostId && typeof secrets["node-token"] === "string" && secrets["node-token"].length > 0);
  return Object.fromEntries([join(core, "host-identity.json"), join(core, "secret-catalog.bin"), join(paths.nodeData, "secrets.json"),
    ...[core, paths.nodeData].flatMap((data) => [join(data, "hindsight-host/installation.json"), join(data, "hindsight-host/deployment-registration.json")])]
    .map((path) => [path, fileDigest(path)]));
}

async function recoverProcesses(paths: BootPaths, generation: Generation, status: DeploymentStatusV1) {
  requireFact(status.containerId && status.operationId);
  const original = ownedRegistry();
  requireFact(original.attempts.map((value) => value.action).join(",") === "create,start,inject"
    && original.attempts[2]?.phase === "observed" && original.attempts.every((value) => value.control.effectId && value.control.coreAttemptId));
  const before = await probe(status.containerId, "read"); requireRunningChild(before, status);
  const pins = stableFilePins(paths);
  const helper = captureHelper(generation.node);
  report.beforeInterruption = { registry: original, child: before, helper: helperFacts(helper), corePid: generation.core.child.pid };
  stage = "terminate-original-fixture-processes";
  operator?.close(); operator = undefined;
  await stopProcesses([generation.core, generation.node]); requireHelperGone(helper);
  const afterTermination = await probe(status.containerId, "read"); requireSameChild(before, afterTermination);
  await runningScan(status);
  report.afterInterruption = { child: afterTermination, originalHelperReaped: true };
  const replacement = await boot(paths, true);
  requireFact(same(pins, stableFilePins(paths)));
  stage = "observe-original-after-reopen";
  for (const [method, params] of [[HINDSIGHT_DEPLOYMENT_METHODS.start, startInput()],
    [HINDSIGHT_DEPLOYMENT_METHODS.observe, { deploymentId: status.operationId }]] as const) {
    requireFact(same(await deploymentCall(method, params), status));
  }
  requireOriginalFacts(original, ownedRegistry());
  const afterReopen = await probe(status.containerId, "read"); requireSameChild(before, afterReopen);
  const nextHelper = captureHelper(replacement.node);
  requireFact(nextHelper.ProcessId !== helper.ProcessId || nextHelper.CreatedAt !== helper.CreatedAt);
  report.afterReopen = { child: afterReopen, helper: helperFacts(nextHelper), corePid: replacement.core.child.pid,
    persistedInputsPreserved: true, originalRun: await requireUnknownRun(status.operationId) };
  return original;
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
async function restartOwned(original: OwnedDeploymentRecord, previous: DeploymentStatusV1, since: string) {
  requireFact(fixture && original.containerId && previous.operationId);
  stage = "seed-owned-recovery-markers";
  const seeded = await probe(original.containerId, "seed");
  requireFact(seeded.volumeMarkerSha256 && seeded.volumeMarkerSha256 === seeded.tmpfsMarkerSha256);
  // Retain pre-restart exec facts now: the daemon need not keep old exec metadata after restart.
  await inspectExecs(original, since, false);
  requireFact(submitExecIds.size === 1);
  const owned = await new FixedDockerAdapter(fixture.deploymentRegistration).inspectOwned(original.plan, AbortSignal.timeout(budget(30_000)));
  requireFact(owned.container?.id === original.containerId && owned.container.running && same(owned.volume, original.volume));
  stage = "restart-exact-owned-container";
  await docker(["restart", "--time", "35", original.containerId], 45_000);
  const native = await waitingStartup(original.containerId);
  requireFact(native.startupId !== previous.startupId && native.configurationDigest === original.plan.configurationDigest
    && native.operationId === undefined && native.attemptId === undefined && native.authorizationId === undefined && native.deadlineAt === undefined);
  const waiting = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.observe, { deploymentId: previous.operationId });
  requireFact(waiting.state === "waiting" && waiting.startupId === native.startupId && waiting.attemptId === undefined
    && waiting.containerId === original.containerId && waiting.operationId === previous.operationId);
  requireFact(same(await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.start, startInput()), waiting));
  requireOriginalFacts(original, ownedRegistry());
  const fresh = await probe(original.containerId, "read");
  requireFact(fresh.tmpfsMarkerSha256 === null && fresh.volumeMarkerSha256 === seeded.volumeMarkerSha256
    && fresh.children.length === 0 && fresh.childMarker.startupId === previous.startupId && fresh.childMarker.state === "stopped");
  report.beforeResume = { seeded, fresh, native, waiting, oldAuthorityNotReplayed: true };
  return { waiting, markerSha256: seeded.volumeMarkerSha256 };
}

function requireFreshInjection(previous: DeploymentAttempt, next: DeploymentAttempt): void {
  requireFact(next.action === "inject" && next.phase === "observed" && next.startupId !== previous.startupId);
  for (const field of ["requestId", "checkpointId", "startupAuthorizationId"] as const) {
    requireFact(next[field] && previous[field] && next[field] !== previous[field]);
  }
  for (const field of ["runId", "coreAttemptId", "attemptId", "effectId"] as const) {
    requireFact(next.control[field] && previous.control[field] && next.control[field] !== previous.control[field]);
  }
  for (const field of ["snapshotId", "coreBootId"] as const) requireFact(next.custody.input[field] !== previous.custody.input[field]);
  for (const field of ["coreOperationId", "coreAttemptId", "brokerOperationId", "hostAttemptId", "requestId", "inputDigest"] as const) {
    requireFact(next.custody.mapping[field] !== previous.custody.mapping[field]);
  }
  for (const field of ["coreHostId", "catalogStoreId", "catalogKeyVersion", "sealedEnvelopeSha256", "installationId", "configurationDigest", "selection"] as const) {
    requireFact(same(next.custody.input[field], previous.custody.input[field]));
  }
  // Current control is validated by the live path. Counters need not increase across Core boots.
}
async function resumeNewStartup(original: OwnedDeploymentRecord, waiting: DeploymentStatusV1, markerSha256: string) {
  requireFact(original.containerId && waiting.operationId && waiting.startupId);
  stage = "explicit-fresh-startup-resume";
  const result = await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.resumeStartup, { deploymentId: waiting.operationId });
  requireFact(result.state === "running" && result.startupId === waiting.startupId && result.containerId === original.containerId
    && result.operationId === original.plan.operationId && result.configurationDigest === original.plan.configurationDigest);
  const after = ownedRegistry();
  requireFact(after.attempts.length === 4 && same(after.attempts.slice(0, 3), original.attempts)
    && same(after.steps, original.steps) && same(after.plan, original.plan) && same(after.volume, original.volume));
  const previous = original.attempts[2]; const next = after.attempts[3]; requireFact(previous && next);
  requireFreshInjection(previous, next);
  requireFact(next.startupId === result.startupId && next.control.attemptId === result.attemptId && next.control.operationId === original.plan.operationId);
  const run = await readRun(next.control.runId);
  requireFact(run.run.state === "completed" && run.run.outcome === "completed" && run.attempts.length === 1
    && run.run.activeAttemptId === next.control.coreAttemptId && run.attempts[0]?.outcome === "completed"
    && run.run.idempotencyKey === `hindsight-deployment:startup:v1:${original.plan.deploymentId}:${waiting.startupId}`
    && run.run.triggerRequestId === waiting.startupId && run.run.provenance.parentRunId === original.plan.deploymentId);
  const child = await probe(original.containerId, "read"); requireRunningChild(child, result);
  requireFact(child.volumeMarkerSha256 === markerSha256 && child.tmpfsMarkerSha256 === null);
  requireFact(same(await deploymentCall(HINDSIGHT_DEPLOYMENT_METHODS.resumeStartup, { deploymentId: waiting.operationId }), result));
  requireOriginalFacts(after, ownedRegistry());
  report.afterResume = { result, child, registry: after, startupRun: runFacts(run),
    originalRun: await requireUnknownRun(original.plan.deploymentId), repeatedResumeObservedOnly: true };
  await runningScan(result);
}

async function runningScan(result: DeploymentStatusV1) {
  requireFact(fixture && result.containerId);
  const bytes = await dockerExchange(fixture.deploymentRegistration, { argv: ["exec", "-i", result.containerId, "/app/api/.venv/bin/python", "-I", "-B", "-"],
    input: readFileSync(join(HERE, "../docker-acceptance/container-scan.py")), signal: AbortSignal.timeout(budget(20_000)), maxBytes: 16 * 1024 });
  scan(`container-scan-${Object.keys(scans).length}`, bytes); const facts = json(bytes);
  requireFact(facts.marker.startupId === result.startupId && facts.marker.state === "running" && facts.childAlive
    && facts.hits === 0 && facts.argvHits === 0);
  const inspected = await docker(["container", "inspect", result.containerId]); scan("container-metadata", inspected);
  const container = json(inspected)[0]; requireFact(container.Config.Tty === false && container.State.Running === true);
  scanContainerLogs(await readEngineEvidence("logs", result.containerId));
  report[`runningScan-${result.startupId}`] = facts;
}
async function inspectExecs(original: OwnedDeploymentRecord, since: string, restarted: boolean) {
  requireFact(original.containerId && original.volume);
  const until = new Date().toISOString();
  const events = await docker(["events", "--since", since, "--until", until, "--filter", `container=${original.containerId}`, "--format", "{{json .}}"]);
  scan(`container-events-${restarted}`, events);
  const rows = events.toString("utf8").trim().split("\n").filter(Boolean).map((line) => json(line));
  requireFact(rows.every((entry) => entry.Type === "container" && entry.Actor?.ID === original.containerId));
  requireFact(rows.filter((entry) => entry.Action === "create").length === 1
    && rows.filter((entry) => entry.Action === "start").length === (restarted ? 2 : 1));
  for (const entry of rows.filter((value) => String(value.Action).startsWith("exec_create"))) {
    const id = entry.Actor?.Attributes?.execID; requireFact(typeof id === "string" && /^[0-9a-f]{64}$/.test(id));
    if (execEvidence.has(id)) continue;
    const bytes = await readEngineEvidence("exec", id); scan(`exec-${execEvidence.size}`, bytes); const meta = json(bytes);
    const args = meta.ProcessConfig?.arguments;
    requireFact(meta.ContainerID === original.containerId && meta.ProcessConfig?.tty === false && meta.OpenStdin === true
      && meta.Running === false && Number.isInteger(meta.ExitCode) && meta.ProcessConfig?.entrypoint === "/app/api/.venv/bin/python"
      && Array.isArray(args) && args[0] === "-I" && args[1] === "-B");
    const privateModule = args.length === 4 && args[2] === "-m" && ["managed_bootstrap.control", "managed_bootstrap.submitter"].includes(args[3]);
    const fixtureProbe = args[2] === "-" && (args.length === 3 || (args.length === 4 && ["read", "seed"].includes(args[3])));
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
async function recoveryCase(paths: BootPaths, generation: Generation) {
  capacity();
  const since = new Date().toISOString();
  const status = await loseHostCompletion();
  const original = await recoverProcesses(paths, generation, status);
  const { waiting, markerSha256 } = await restartOwned(original, status, since);
  await resumeNewStartup(original, waiting, markerSha256);
  stage = "final-effect-and-containment-check";
  await inspectExecs(original, since, true);
  // The live Shell owns deployment.lock exclusively. The required full-tree scan
  // runs in cleanup after the owned stack is reaped, without skipping any file.
  report.effectCounts = { containerCreate: 1, volumeCreate: 1, containerStart: 2, maintenanceRestart: 1, submit: 2,
    source: "actual resource-scoped events, exec metadata, unchanged original registry entries and fresh startup entry" };
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
        await docker(["stop", "--time", "35", found.container.id], 45_000);
        requireFact(json(await docker(["container", "inspect", found.container.id]))[0].State.Running === false);
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
    rmSync(ROOT, { recursive: true }); requireFact(!existsSync(ROOT)); report.protectedRootRemoved = true;
  }
}

async function main() {
  requireFact(process.argv.length === 3 && process.argv[2] === "--execute-approved-recovery" && process.platform === "win32");
  requireFact(resolve(process.execPath).toLowerCase() === resolve("C:/Program Files/nodejs/node.exe").toLowerCase());
  requireFact(!existsSync(ROOT) && realpathSync(STAGING).toLowerCase() === STAGING.toLowerCase()
    && readFileSync(join(STAGING, ".c2a-docker-owner"), "utf8") === CASE);
  // Cargo keeps a second hard link to the accepted Shell binary. This is a
  // public build-artifact pin, not the single-link installed-file trust check.
  for (const [path, digest] of Object.entries(PINNED)) requireFact(sha256(readFileSync(path)) === digest);
  const sourcePath = join(HERE, "../c2a-implementation-source-manifest.json");
  requireFact(fileDigest(sourcePath) === "f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2");
  for (const entry of json(readFileSync(sourcePath)).files) requireFact(fileDigest(entry.absolutePath) === entry.afterSha256);
  report.inputs = { launcherSha256: fileDigest(fileURLToPath(import.meta.url)), probeSha256: fileDigest(join(HERE, "recovery-probe.py")),
    containerScannerSha256: fileDigest(join(HERE, "../docker-acceptance/container-scan.py")), sourceManifestSha256: fileDigest(sourcePath) };
  requireFact(json(readFileSync(join(STAGING, "base-probe.json"))).compatible === true);
  writeFileSync(join(STAGING, "recovery.started"), new Date().toISOString(), { flag: "wx" }); ownsRun = true;
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
  const generation = await boot(paths, false);
  await recoveryCase(paths, generation); capacity(); report.casePassed = true;
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
  writeFileSync(join(STAGING, "recovery.json"), evidence, { flag: "wx" });
}

try { await main(); }
catch { report.casePassed = false; report.failureStage = stage; process.exitCode = 1; }
finally {
  if (ownsRun) {
    try { await cleanup(); requireFact(report.protectedTreeScannedAfterStop === true); report.ownedRuntimeCleanup = true; }
    catch { report.casePassed = false; report.ownedRuntimeCleanup = false; report.cleanupFailureStage = stage; process.exitCode = 1; }
    report.scans = scans; report.elapsedMs = Date.now() - startedAt;
    report.stagingDisposition = "Retained for Root to copy evidence, verify paths, and remove; build cache/VHDX reclamation unclaimed";
    writeEvidence();
  }
  console.log(JSON.stringify({ caseId: CASE, passed: report.casePassed ?? false, ownedRuntimeCleanup: report.ownedRuntimeCleanup ?? false,
    evidence: ownsRun ? join(STAGING, "recovery.json") : null, deploymentReady: false }));
}
