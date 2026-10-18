/**
 * INPUT:  one separately approved, prepared local image/key adapter and fixed owned roots
 * OUTPUT: one admitted real-Docker fake startup, duplicate/observation evidence and owned cleanup
 * POS:    task-only experiment; reuses accepted source seams, never a production launcher or fault harness
 */
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
import { DeploymentRegistry } from "../../../../../apps/hindsight-host/src/deployment-registry.ts";
import { fileDigest, sha256 } from "../../../../../apps/hindsight-host/src/installed-files.ts";
import { createConfigSource } from "../../../../../packages/core/src/config/config-source.ts";
import { resolveHindsightConfig } from "../../../../../packages/core/src/config/hindsight-config.ts";
import { JsonRpcSuccessResponseSchema } from "../../../../../packages/shared/src/json-rpc-schema.ts";
import { RunStatusResultSchema } from "../../../../../packages/shared/src/harness-schema.ts";
import { DeploymentStatusV1Schema, HINDSIGHT_DEPLOYMENT_METHODS } from "../../../../../packages/shared/src/hindsight-deployment-schema.ts";
import { getFreePort, killTree, spawnProc, type Proc } from "../../../../../e2e/src/fixture/procs.ts";
import { jsonLine } from "../../../../../e2e/src/fixture/line-buffer.ts";
import { pairOperator, setPermissionLevel } from "../../../../../e2e/src/fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "../../../../../e2e/src/fixture/rpc-socket.ts";

const CASE = "8378a950-87c8-44e3-a909-d213a284f113";
const REPOSITORY = fileURLToPath(new URL("../../../../../", import.meta.url));
const HERE = fileURLToPath(new URL("./", import.meta.url));
const ROOT = resolve(`C:/taki-c2a-docker-fixture-${CASE}`);
const STAGING = resolve(`G:/TakiAgent-c2a-docker-acceptance/first-case-${CASE}`);
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
const report: Record<string, unknown> = { version: 1, caseId: CASE, scope: "first-admitted-docker-case", deploymentReady: false };
const scans: Record<string, { bytes: number; hits: number }> = {};
const processes: Proc[] = [];
let fixture: DeploymentFixture | undefined;
let operator: RpcSocket | undefined;
let stage = "prerequisites";
let ownsRoot = false;
let ownsRun = false;
let initialGFree = 0;
const startedAt = Date.now();
let cleanupDeadline = 0;

function requireFact(value: unknown): asserts value { if (!value) throw new Error("C2A_CHECK_FAILED"); }
function json(bytes: Uint8Array | string) { return JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8")); }
function scan(name: string, bytes: Uint8Array | string) {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  const hits = [...buffer.toString("utf8").matchAll(/C2A_FAKE_[0-9a-f]{64}/g)].length;
  scans[name] = { bytes: buffer.length, hits }; requireFact(hits === 0);
}
function free(path: string) { const value = statfsSync(path); return value.bavail * value.bsize; }
function budget(limit: number) {
  const remaining = (stage === "owned-cleanup" ? cleanupDeadline : startedAt + 5 * 60_000) - Date.now();
  requireFact(remaining > 0); return Math.min(limit, remaining);
}
function capacity() {
  requireFact(free("G:/") >= 20 * 1024 ** 3 && initialGFree - free("G:/") <= 2 * 1024 ** 3);
  requireFact(free("C:/") >= 1024 ** 3 && Date.now() - startedAt < 5 * 60_000);
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

async function boot(paths: { nodeData: string; credentials: string }) {
  requireFact(fixture); stage = "core-shell-operator";
  const port = await getFreePort(); const url = `ws://127.0.0.1:${port}`;
  const base = { SystemRoot: process.env.SystemRoot, TEMP: STAGING, TMP: STAGING, WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" };
  const core = spawnProc({ command: process.execPath, args: [join(REPOSITORY, "packages/core/src/main.ts")], cwd: ROOT,
    env: { ...base, ...CONFIG, TAKI_DATA_DIR: fixture.registration.coreDataDirectory, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "false", TAKI_CREDENTIALS_DIRECTORY: paths.credentials,
      TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "e2e-dummy-key", TAKI_PROVIDER_MODEL: "e2e-dummy-model" } });
  processes.push(core); await core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", budget(30_000));
  // Match the accepted debug Shell fixture's required startup configuration.
  const node = spawnProc({ command: SHELL, args: [], cwd: paths.nodeData, env: { ...base, TAKI_DATA_DIR: paths.nodeData,
    TAKI_WS_URL: url, TAKI_DEVICE_NAME: "C2a Docker fixture", TAKI_GATE_AUTOAPPROVE: "allow-once",
    TAKI_CAPABILITIES: "hindsight-custody,hindsight-deployment,hindsight-deployment-observe" } });
  processes.push(node);
  const codeFor = async (name: string) => String(jsonLine(await core.stdout.waitFor((line) => {
    const entry = jsonLine(line); return entry?.msg === "pairing code issued" && entry.deviceName === name;
  }, budget(20_000)))?.code);
  node.child.stdin?.write(`${await codeFor("C2a Docker fixture")}\n`);
  await node.stderr.waitFor((line) => line.includes("state=connected"), budget(30_000));
  operator = await openRpcSocket(url);
  await pairOperator(operator, { deviceId: randomUUID(), deviceName: "C2a Docker operator", getCode: () => codeFor("C2a Docker operator") });
  await setPermissionLevel(operator, "relaxed");
}

async function admittedCase() {
  requireFact(fixture && operator); capacity(); stage = "admitted-start";
  const since = new Date().toISOString();
  const input = { idempotencyKey: CASE, expectedConfigurationDigest: fixture.plan.configurationDigest };
  const result = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request(HINDSIGHT_DEPLOYMENT_METHODS.start, input, budget(90_000))).result);
  scan("first-status", JSON.stringify(result)); report.firstStatus = result;
  requireFact(result.state === "running" && result.containerId && result.operationId);
  const original = new DeploymentRegistry(fixture.deploymentRegistration.stateDirectory).snapshot();
  requireFact(original.state === "owned" && original.containerId === result.containerId && original.volume);
  requireFact(original.attempts.map((entry) => entry.action).join(",") === "create,start,inject"
    && original.attempts.every((entry) => entry.control.effectId && entry.control.coreAttemptId));
  const run = RunStatusResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request("run.status", { runId: result.operationId }, budget(20_000))).result);
  requireFact(run.run.runId === result.operationId && run.run.outcome === "completed");
  stage = "duplicate-and-observe";
  for (const [method, params] of [[HINDSIGHT_DEPLOYMENT_METHODS.start, input], [HINDSIGHT_DEPLOYMENT_METHODS.observe, { deploymentId: result.operationId }]] as const) {
    const current = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(await operator.request(method, params, budget(30_000))).result);
    scan(method, JSON.stringify(current)); requireFact(JSON.stringify(current) === JSON.stringify(result));
  }
  const after = new DeploymentRegistry(fixture.deploymentRegistration.stateDirectory).snapshot();
  requireFact(after.state === "owned" && JSON.stringify(after.attempts) === JSON.stringify(original.attempts)
    && JSON.stringify(after.steps) === JSON.stringify(original.steps) && after.containerId === original.containerId);
  scan("registry", JSON.stringify(after)); report.registry = after;
  await inspectExecs(result.containerId, since);
  stage = "container-scans";
  const inspected = await docker(["container", "inspect", result.containerId]); scan("container-metadata", inspected);
  const container = json(inspected)[0]; requireFact(container.Config.Tty === false && container.State.Running === true);
  // The production CLI exchange discards stderr. Read both Docker log streams
  // through the bounded read-only endpoint so stderr is actually scanned too.
  scanContainerLogs(await readEngineEvidence("logs", result.containerId));
  const scanBytes = await dockerExchange(fixture.deploymentRegistration, { argv: ["exec", "-i", result.containerId, "/app/api/.venv/bin/python", "-I", "-B", "-"],
    input: readFileSync(join(HERE, "container-scan.py")), signal: AbortSignal.timeout(budget(20_000)), maxBytes: 16 * 1024 });
  scan("container-scan-result", scanBytes); const facts = json(scanBytes);
  requireFact(facts.marker.startupId === result.startupId && facts.marker.state === "running" && facts.childAlive
    && facts.hits === 0 && facts.argvHits === 0);
  requireFact(Object.values(facts.sockets).every((value) => {
    const entry = value as { uid: number; gid: number; mode: number; socket: boolean };
    return entry.uid === 1000 && entry.gid === 1000 && entry.mode === 0o600 && entry.socket;
  }));
  report.containerScan = facts; report.duplicateAndOriginalObservation = true;
  report.effectCounts = { create: 1, start: 1, inject: 1, source: "unchanged actual registry and engine events" };
}

async function inspectExecs(containerId: string, since: string) {
  stage = "actual-exec-metadata";
  const events = await docker(["events", "--since", since, "--until", new Date().toISOString(), "--filter", `container=${containerId}`, "--format", "{{json .}}"]);
  scan("docker-events", events);
  const rows = events.toString("utf8").trim().split("\n").filter(Boolean).map((line) => json(line));
  requireFact(rows.filter((entry) => entry.Action === "create").length === 1 && rows.filter((entry) => entry.Action === "start").length === 1);
  const execs = [];
  for (const entry of rows.filter((value) => String(value.Action).startsWith("exec_create"))) {
    const id = entry.Actor?.Attributes?.execID; requireFact(typeof id === "string" && /^[0-9a-f]{64}$/.test(id));
    const bytes = await readEngineEvidence("exec", id); scan(`exec-${execs.length}`, bytes); const meta = json(bytes);
    const args = meta.ProcessConfig?.arguments;
    requireFact(meta.ContainerID === containerId && meta.ProcessConfig?.tty === false && meta.OpenStdin === true
      && meta.Running === false && meta.ExitCode === 0 && meta.ProcessConfig?.entrypoint === "/app/api/.venv/bin/python"
      && Array.isArray(args) && args.length === 4 && args.slice(0, 3).join(",") === "-I,-B,-m"
      && ["managed_bootstrap.control", "managed_bootstrap.submitter"].includes(args[3]));
    execs.push({ id, module: args[3], tty: false, exitCode: 0 });
  }
  requireFact(execs.filter((entry) => entry.module === "managed_bootstrap.submitter").length === 1);
  report.privateExecs = execs;
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
  report.ownedProcessIds = processes.map((child) => child.child.pid);
  report.pendingImageTag = IMAGE_TAG;
  if (fixture) report.pendingRegistry = join(fixture.deploymentRegistration.stateDirectory, "deployment.json");
  for (const child of processes.slice().reverse()) {
    killTree(child);
    await new Promise<void>((settle, reject) => {
      const timer = setTimeout(() => reject(new Error("PROCESS_EXIT_TIMEOUT")), budget(15_000));
      void child.exited.then(() => { clearTimeout(timer); settle(); });
    });
  }
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
    scanTree();
    requireFact(realpathSync(ROOT).toLowerCase() === ROOT.toLowerCase() && readFileSync(join(ROOT, ".c2a-docker-owner"), "utf8") === CASE);
    rmSync(ROOT, { recursive: true }); requireFact(!existsSync(ROOT)); report.protectedRootRemoved = true;
  }
}

async function main() {
  requireFact(process.argv.length === 3 && process.argv[2] === "--execute-approved-first-case" && process.platform === "win32");
  requireFact(resolve(process.execPath).toLowerCase() === resolve("C:/Program Files/nodejs/node.exe").toLowerCase());
  requireFact(!existsSync(ROOT) && realpathSync(STAGING).toLowerCase() === STAGING.toLowerCase()
    && readFileSync(join(STAGING, ".c2a-docker-owner"), "utf8") === CASE);
  // Cargo keeps a second hard link to the accepted Shell binary. This is a
  // public build-artifact pin, not the single-link installed-file trust check.
  for (const [path, digest] of Object.entries(PINNED)) requireFact(sha256(readFileSync(path)) === digest);
  const sourcePath = join(HERE, "../c2a-implementation-source-manifest.json");
  requireFact(fileDigest(sourcePath) === "f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2");
  for (const entry of json(readFileSync(sourcePath)).files) requireFact(fileDigest(entry.absolutePath) === entry.afterSha256);
  requireFact(json(readFileSync(join(STAGING, "base-probe.json"))).compatible === true);
  writeFileSync(join(STAGING, "first-case.started"), new Date().toISOString(), { flag: "wx" }); ownsRun = true;
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
  await boot(paths); await admittedCase(); capacity(); report.casePassed = true;
}

try { await main(); }
catch { report.casePassed = false; report.failureStage = stage; process.exitCode = 1; }
finally {
  if (ownsRun) {
    try { await cleanup(); report.ownedRuntimeCleanup = true; }
    catch { report.casePassed = false; report.ownedRuntimeCleanup = false; report.cleanupFailureStage = stage; process.exitCode = 1; }
    report.scans = scans; report.elapsedMs = Date.now() - startedAt;
    report.stagingDisposition = "Retained for Root to copy evidence, verify paths, and remove; build cache/VHDX reclamation unclaimed";
    writeFileSync(join(STAGING, "first-case.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  }
  console.log(JSON.stringify({ caseId: CASE, passed: report.casePassed ?? false, ownedRuntimeCleanup: report.ownedRuntimeCleanup ?? false,
    evidence: ownsRun ? join(STAGING, "first-case.json") : null, deploymentReady: false }));
}
