/**
 * INPUT:  pinned Docker client/endpoint/engine, cached base image, reviewed inspect-image.py and topology-probe.py bytes
 * OUTPUT: S/result.json with Phase A inventory, Phase B topology facts and owned cleanup proof; archived copy; S removal
 * POS:    task-only C2b slice 1 runner executed by Root; no producer, API, receipt or deploymentReady claim
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const T = "cb3b3ca9-5a01-4bc4-a734-8b48d7868489";
const PORT = 58117;
const HERE = fileURLToPath(new URL("./", import.meta.url));
const DOCKER = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
const DOCKER_SHA256 = "0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d";
const ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
const ENGINE_ID = "93e8319e-24b7-4a7d-88f1-60923ad681e0";
const IMAGE = "sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db";
const STAGING_ROOT = resolve("G:/TakiAgent-c2b-native-api");
const S = join(STAGING_ROOT, `image-${T}`);
const C = join(S, "client-config");
const MARKER = join(S, ".c2b-image-owner");
const ARCHIVE = resolve(HERE, `../c2b-slice1-run-${T}`);
// Bytes are read once and hash-checked in local preflight; stdin feeds exactly those bytes.
const PACKETS = {
  inventory: { path: join(HERE, "inspect-image.py"), sha256: "f7e962da88188e1afb6bbcba9acb1101839f75d38296c603d776da25f44e1ae7", bytes: Buffer.alloc(0) },
  topology: { path: join(HERE, "topology-probe.py"), sha256: "045b1f4434794713a2bd2fc60501714509090238438175f1d78357c6a677f9b9", bytes: Buffer.alloc(0) },
};
const NETWORK_NAME = `taki-c2b-net-${T}`;
const TOKEN_LABEL = `taki.c2b.image-prerequisite=${T}`;
const TOKEN = `taki-c2b-topology-ok:${T}\n`;
const TARGETS = ["1.1.1.1:443", "8.8.8.8:53"];
const ENTRY = "/app/api/.venv/bin/python";
const MASQUERADE = "com.docker.network.bridge.enable_ip_masquerade";
const IMAGE_FORMAT = '{"Id":{{json .Id}},"Os":{{json .Os}},"Architecture":{{json .Architecture}},"Volumes":{{json (index .Config "Volumes")}}}';
const CONTAINER_FORMAT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Path":{{json .Path}},"Args":{{json .Args}},'
  + '"User":{{json .Config.User}},"Token":{{json (index .Config.Labels "taki.c2b.image-prerequisite")}},'
  + '"Role":{{json (index .Config.Labels "taki.c2b.role")}},"NetworkMode":{{json .HostConfig.NetworkMode}},'
  + '"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Mounts":{{json .Mounts}},"Memory":{{json .HostConfig.Memory}},'
  + '"NanoCpus":{{json .HostConfig.NanoCpus}},"PidsLimit":{{json .HostConfig.PidsLimit}},"Privileged":{{json .HostConfig.Privileged}},'
  + '"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"LogDriver":{{json .HostConfig.LogConfig.Type}},'
  + '"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}}}';
const NETWORK_FORMAT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Driver":{{json .Driver}},"Scope":{{json .Scope}},"Internal":{{json .Internal}},'
  + '"EnableIPv6":{{json .EnableIPv6}},"Options":{{json .Options}},"Labels":{{json .Labels}},"Containers":{{json .Containers}}}';

type Json = Record<string, unknown>;
interface Exchange { code: number | null; stdout: string; stderr: string; timedOut: boolean; overflow: boolean }
interface DockerOptions { timeout: number; input?: Buffer; maxStdout?: number; onStdout?: (text: string) => void }
interface Owned { name: string; format: string; spec: Json; record: Json; createAttempted: boolean; id?: string }

function containerSpec(name: string, role: string, network: string): Json {
  return { Name: `/${name}`, Image: IMAGE, Path: ENTRY, Args: ["-I", "-B", "-"], User: "1000:1000", Token: T, Role: role,
    NetworkMode: network, ReadonlyRootfs: true, Mounts: [], Memory: 256 * 1024 ** 2, NanoCpus: 1_000_000_000, PidsLimit: 16,
    Privileged: false, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"], LogDriver: "none" };
}
const phaseA: Json = { verdict: "FAIL" };
const phaseB: Json = { verdict: "FAIL" };
const inventoryOwned: Owned = { name: `taki-c2b-image-${T}`, format: CONTAINER_FORMAT, record: phaseA, createAttempted: false,
  spec: containerSpec(`taki-c2b-image-${T}`, "native-image-inventory", "none") };
const topologyOwned: Owned = { name: `taki-c2b-topology-${T}`, record: phaseB, createAttempted: false,
  format: `${CONTAINER_FORMAT.slice(0, -1)},"PortBindings":{{json .HostConfig.PortBindings}}}`,
  spec: { ...containerSpec(`taki-c2b-topology-${T}`, "topology-probe", NETWORK_NAME),
    PortBindings: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(PORT) }] } } };
const network: { createAttempted: boolean; id?: string; record: Json } = { createAttempted: false, record: {} };
const commands: Json[] = [];
const startedAt = Date.now();
const result: Json = { schema: "c2b-slice1-run-v1", token: T, port: PORT, deploymentReady: false,
  scope: "Cached-base static inventory plus masquerade-off bridge topology probe; no API, producer, receipt or setup",
  childEnvironmentKeys: ["SystemRoot"], phaseA, phaseB, network: network.record, commands };
let stage = "local-preflight";
let deadline = 0;
let ownsStage = false;
let preflightPassed = false;

function requireFact(value: unknown, code = "SLICE1_CHECK_FAILED"): asserts value { if (!value) throw new Error(code); }
function failure(error: unknown) { return { stage, code: error instanceof Error ? error.message : "UNEXPECTED_FAILURE" }; }
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function free(path: string) { const value = statfsSync(path); return value.bavail * value.bsize; }
function begin(name: string) { stage = name; deadline = Date.now() + 60_000; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
function same(left: unknown, right: unknown) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function mismatches(actual: Json, expected: Json) { return Object.keys(expected).filter((key) => !same(actual[key], expected[key])); }
function parseLine(line: string | undefined): Json | null {
  try { const value: unknown = JSON.parse(line ?? ""); return value && typeof value === "object" ? value as Json : null; } catch { return null; }
}

function docker(argv: string[], options: DockerOptions): Promise<Exchange> {
  const remaining = deadline - Date.now(); requireFact(remaining > 0, "BUDGET_EXHAUSTED");
  const full = ["--host", ENDPOINT, "--config", C, ...argv];
  const entry: Json = { stage, argv: [DOCKER, ...full], stdinSha256: options.input ? sha256(options.input) : null };
  commands.push(entry);
  const began = Date.now();
  return new Promise((settle) => {
    const child = spawn(DOCKER, full, { cwd: S, env: { SystemRoot: process.env.SystemRoot }, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    let outBytes = 0; let errBytes = 0; let timedOut = false; let overflow = false; let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.min(options.timeout, remaining));
    const finish = (code: number | null, spawnError?: string) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const exchange = { code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), timedOut, overflow };
      Object.assign(entry, exchange, { spawnError: spawnError ?? null, elapsedMs: Date.now() - began });
      settle(exchange);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > (options.maxStdout ?? 16 * 1024)) { overflow = true; child.kill(); return; }
      out.push(chunk); options.onStdout?.(Buffer.concat(out).toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > 8 * 1024) { overflow = true; child.kill(); return; }
      err.push(chunk);
    });
    // An early exit can break the stdin pipe; the recorded exit status still decides the outcome.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => { child.kill(); finish(null, error.message); });
    child.on("close", (code) => finish(code));
    child.stdin.end(options.input);
  });
}
function ok(exchange: Exchange) { return exchange.code === 0 && !exchange.timedOut && !exchange.overflow; }
function projection(exchange: Exchange): Json {
  const lines = exchange.stdout.trim().split("\n");
  const value = lines.length === 1 ? parseLine(lines[0]) : null;
  requireFact(ok(exchange) && value, "INSPECT_FAILED"); return value;
}
function inspect(kind: "container" | "network", ref: string, format: string) {
  return docker([kind, "inspect", ref, "--format", format], { timeout: 5_000 });
}
function absent(exchange: Exchange, kind: "container" | "network", ref: string) {
  // Refs are fixed hex/UUID-derived names, so they are literal inside these patterns.
  const pattern = kind === "container" ? `^Error(?: response from daemon)?: No such (?:container|object): ${ref}$`
    : `^Error(?: response from daemon)?: network ${ref} not found$`;
  return exchange.code === 1 && !exchange.timedOut && !exchange.overflow && exchange.stdout.trim() === ""
    && new RegExp(pattern).test(exchange.stderr.trim());
}
function createArgs(owned: Owned, network: string, publish: string[] = []) {
  return ["create", "--name", owned.name, "--label", TOKEN_LABEL, "--label", `taki.c2b.role=${String(owned.spec.Role)}`,
    "--pull", "never", "--network", network, ...publish, "--read-only", "--user", "1000:1000", "--interactive",
    "--log-driver", "none", "--memory", "256m", "--cpus", "1", "--pids-limit", "16",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--entrypoint", ENTRY, IMAGE, "-I", "-B", "-"];
}

async function createContainer(owned: Owned, argv: string[]) {
  requireFact(absent(await inspect("container", owned.name, owned.format), "container", owned.name), "NAME_COLLISION");
  owned.createAttempted = true;
  const created = await docker(argv, { timeout: 5_000 });
  const id = created.stdout.trim();
  requireFact(ok(created) && /^[0-9a-f]{64}$/.test(id), "CREATE_FAILED");
  owned.id = id;
  const before = projection(await inspect("container", id, owned.format));
  const wrong = mismatches(before, owned.spec);
  Object.assign(owned.record, { containerId: id, beforeStart: before, settingMismatches: wrong });
  requireFact(before.Id === id && before.Running === false && wrong.length === 0, "SETTINGS_MISMATCH");
  return id;
}

async function inventory() {
  begin("a-preflight");
  const engine = await docker(["info", "--format", "{{.ID}}"], { timeout: 5_000 });
  requireFact(ok(engine) && engine.stdout.trim() === ENGINE_ID, "ENGINE_MISMATCH");
  const time = await docker(["info", "--format", "{{.SystemTime}}"], { timeout: 5_000 });
  result.engine = { id: ENGINE_ID, systemTime: ok(time) ? time.stdout.trim() : null };
  const image = projection(await docker(["image", "inspect", IMAGE, "--format", IMAGE_FORMAT], { timeout: 5_000 }));
  result.image = image;
  requireFact(image.Id === IMAGE && image.Os === "linux" && image.Architecture === "amd64"
    && (image.Volumes === null || same(image.Volumes, {})), "IMAGE_MISMATCH");
  preflightPassed = true;
  stage = "a-create";
  const id = await createContainer(inventoryOwned, createArgs(inventoryOwned, "none"));
  stage = "a-attach";
  const attach = await docker(["start", "--attach", "--interactive", id],
    { timeout: 40_000, input: PACKETS.inventory.bytes, maxStdout: 64 * 1024 });
  const after = projection(await inspect("container", id, CONTAINER_FORMAT));
  const lines = attach.stdout.split("\n");
  const output = lines.length === 2 && lines[1] === "" ? parseLine(lines[0]) : null;
  Object.assign(phaseA, { exitCode: attach.code, timedOut: attach.timedOut, overflow: attach.overflow, afterExit: after, output });
  const passed = ok(attach) && output?.schema === "c2b-cached-image-inventory-v1" && output.expected_image_input === IMAGE
    && output.status === "inventory_complete" && output.inventory_complete === true && output.deploymentReady === false
    && Array.isArray(output.unresolved) && output.unresolved.length === 0
    && after.Running === false && after.ExitCode === 0 && after.OOMKilled === false;
  phaseA.verdict = passed ? "PASS" : "FAIL";
}

function portState(): Promise<string> {
  return new Promise((settle) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => settle(error.code ?? "error"));
    server.listen({ host: "127.0.0.1", port: PORT, exclusive: true }, () => server.close(() => settle("free")));
  });
}
function loopbackRead(): Promise<Json> {
  const began = Date.now();
  return new Promise((settle) => {
    const chunks: Buffer[] = []; let size = 0;
    const finish = (outcome: string) => settle({ outcome, received: Buffer.concat(chunks).toString("utf8"), elapsedMs: Date.now() - began });
    const socket = connect({ host: "127.0.0.1", port: PORT });
    socket.setTimeout(5_000, () => socket.destroy(new Error("ETIMEDOUT")));
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256) { socket.destroy(new Error("OVERFLOW")); return; }
      chunks.push(chunk); if (chunk.includes(10)) socket.destroy();
    });
    socket.on("error", (error: NodeJS.ErrnoException) => finish(`error:${error.code ?? error.message}`));
    socket.on("close", () => finish("closed"));
  });
}

async function topology() {
  begin("b-network");
  requireFact(absent(await inspect("network", NETWORK_NAME, NETWORK_FORMAT), "network", NETWORK_NAME), "NAME_COLLISION");
  network.createAttempted = true;
  const created = await docker(["network", "create", "--driver", "bridge", "--label", TOKEN_LABEL, "--label", "taki.c2b.role=topology-probe",
    "-o", `${MASQUERADE}=false`, NETWORK_NAME], { timeout: 5_000 });
  const networkId = created.stdout.trim();
  requireFact(ok(created) && /^[0-9a-f]{64}$/.test(networkId), "CREATE_FAILED");
  network.id = networkId;
  const net = projection(await inspect("network", networkId, NETWORK_FORMAT));
  Object.assign(network.record, { networkId, afterCreate: net });
  requireFact(net.Id === networkId && networkMatches(net) && (net.Containers === null || same(net.Containers, {})), "SETTINGS_MISMATCH");
  stage = "b-port";
  const port = await portState(); phaseB.portBeforeCreate = port;
  requireFact(port === "free", "PORT_OCCUPIED");
  stage = "b-create";
  const id = await createContainer(topologyOwned, createArgs(topologyOwned, NETWORK_NAME, ["--publish", `127.0.0.1:${PORT}:8000/tcp`]));
  stage = "b-attach";
  let signalReady: (value: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((settle) => { signalReady = settle; });
  const run = docker(["start", "--attach", "--interactive", id], { timeout: 40_000, input: PACKETS.topology.bytes,
    onStdout: (text) => { if (text.includes("\n") && parseLine(text.split("\n")[0])?.event === "ready") signalReady(true); } });
  const reached = await Promise.race([ready, run.then(() => false)]);
  const loopback = reached ? await loopbackRead() : { outcome: "probe-not-ready", received: "" };
  const attach = await run;
  const after = projection(await inspect("container", id, topologyOwned.format));
  const final = parseLine(attach.stdout.split("\n").filter(Boolean).at(-1));
  const outbound = final && Array.isArray(final.outbound) ? final.outbound as Json[] : [];
  const facts = {
    loopbackTokenReceived: loopback.received === TOKEN,
    externalConnectsFailed: same(outbound.map((entry) => entry.target), TARGETS) && outbound.every((entry) => entry.result !== "connected"),
    loopback, outbound, probeResult: final,
  };
  Object.assign(phaseB, { exitCode: attach.code, timedOut: attach.timedOut, overflow: attach.overflow, afterExit: after, facts });
  const passed = facts.loopbackTokenReceived && facts.externalConnectsFailed && ok(attach) && final?.event === "result"
    && after.Running === false && after.ExitCode === 0 && after.OOMKilled === false;
  phaseB.verdict = passed ? "PASS" : "FAIL";
}
function networkMatches(net: Json) {
  const options = net.Options as Json | null;
  return net.Name === NETWORK_NAME && net.Driver === "bridge" && net.Internal === false && options?.[MASQUERADE] === "false"
    && same(net.Labels, { "taki.c2b.image-prerequisite": T, "taki.c2b.role": "topology-probe" });
}

async function cleanupContainer(owned: Owned) {
  const proof: Json = {}; owned.record.cleanup = proof;
  if (!owned.createAttempted) { proof.outcome = "not-created"; return; }
  // A lost create reply leaves only the frozen name; identity is still checked before any mutation.
  const ref = owned.id ?? owned.name;
  const found = await inspect("container", ref, owned.format);
  if (absent(found, "container", ref)) { proof.outcome = "absent"; return; }
  let state = projection(found);
  const id = state.Id;
  requireFact(typeof id === "string" && (!owned.id || id === owned.id) && mismatches(state, owned.spec).length === 0, "CLEANUP_AMBIGUOUS");
  if (state.Running === true) {
    requireFact(ok(await docker(["stop", "--time", "2", id], { timeout: 5_000 })), "STOP_FAILED");
    state = projection(await inspect("container", id, owned.format));
    requireFact(state.Running === false, "STOP_UNCONFIRMED");
  }
  proof.stopped = state;
  requireFact(ok(await docker(["rm", id], { timeout: 5_000 })), "REMOVE_FAILED");
  requireFact(absent(await inspect("container", id, owned.format), "container", id), "ABSENCE_UNPROVEN");
  proof.outcome = "removed-and-absent";
}
async function cleanupNetwork() {
  const proof: Json = {}; network.record.cleanup = proof;
  if (!network.createAttempted) { proof.outcome = "not-created"; return; }
  const ref = network.id ?? NETWORK_NAME;
  const found = await inspect("network", ref, NETWORK_FORMAT);
  if (absent(found, "network", ref)) { proof.outcome = "absent"; return; }
  const net = projection(found);
  const id = net.Id;
  proof.beforeRemove = net;
  requireFact(typeof id === "string" && (!network.id || id === network.id) && networkMatches(net)
    && (net.Containers === null || same(net.Containers, {})), "CLEANUP_AMBIGUOUS");
  requireFact(ok(await docker(["network", "rm", id], { timeout: 5_000 })), "REMOVE_FAILED");
  requireFact(absent(await inspect("network", id, NETWORK_FORMAT), "network", id), "ABSENCE_UNPROVEN");
  proof.outcome = "removed-and-absent";
}
async function attempt(record: Json, key: string, work: () => Promise<void>) {
  try { await work(); return true; } catch (error) { record[key] = failure(error); return false; }
}

function localPreflight() {
  requireFact(process.platform === "win32" && process.argv.length === 2, "USAGE");
  requireFact(sha256(readFileSync(DOCKER)) === DOCKER_SHA256, "DOCKER_CLIENT_MISMATCH");
  for (const packet of Object.values(PACKETS)) {
    packet.bytes = readFileSync(packet.path); requireFact(sha256(packet.bytes) === packet.sha256, "PACKET_HASH_MISMATCH");
  }
  result.inputs = { runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), dockerSha256: DOCKER_SHA256,
    inventorySha256: PACKETS.inventory.sha256, topologySha256: PACKETS.topology.sha256, node: process.version };
  requireFact(!existsSync(S) && !existsSync(ARCHIVE), "STAGING_EXISTS");
  requireFact(free("G:/") >= 20 * 1024 ** 3 && free("C:/") >= 1024 ** 3, "CAPACITY");
  mkdirSync(STAGING_ROOT, { recursive: true });
  requireFact(realpathSync(STAGING_ROOT).toLowerCase() === STAGING_ROOT.toLowerCase(), "STAGING_ROOT_MISMATCH");
  mkdirSync(S); ownsStage = true;
  writeFileSync(MARKER, T, { flag: "wx" }); mkdirSync(C);
}
function stageBytes() {
  let bytes = 0; const pending = [S];
  while (pending.length) {
    const path = pending.pop(); requireFact(path); const metadata = lstatSync(path);
    requireFact(!metadata.isSymbolicLink(), "STAGE_LINK");
    if (metadata.isDirectory()) pending.push(...readdirSync(path).map((name) => join(path, name)));
    else bytes += metadata.size;
  }
  return bytes;
}
function archive() {
  stage = "archive";
  const bytes = stageBytes(); requireFact(bytes <= 1024 * 1024, "STAGE_GROWTH");
  mkdirSync(ARCHIVE);
  const copied: Json = {};
  for (const name of readdirSync(S).filter((entry) => entry !== "client-config")) {
    const from = join(S, name); const to = join(ARCHIVE, name);
    requireFact(lstatSync(from).isFile(), "STAGE_ENTRY"); copyFileSync(from, to);
    const digest = sha256(readFileSync(from)); requireFact(sha256(readFileSync(to)) === digest, "ARCHIVE_READBACK"); copied[name] = digest;
  }
  requireFact(realpathSync(S).toLowerCase() === S.toLowerCase() && readFileSync(MARKER, "utf8") === T, "MARKER_MISMATCH");
  rmSync(S, { recursive: true }); requireFact(!existsSync(S), "STAGE_REMAINS");
  writeFileSync(join(ARCHIVE, "archive.json"), JSON.stringify({ token: T, stageBytes: bytes, copied, stagingRemoved: true }, null, 2), { flag: "wx" });
}

let cleanupProven = false;
let archived = false;
try { localPreflight(); } catch (error) { result.localPreflightFailure = failure(error); }
if (ownsStage) {
  if (!result.localPreflightFailure) await attempt(phaseA, "failure", inventory);
  begin("a-cleanup");
  const cleanA = await attempt(phaseA, "cleanupFailure", () => cleanupContainer(inventoryOwned));
  let cleanB = true;
  // Phase B is independent of the inventory verdict, but never runs on an unverified engine/image or ambiguous Phase A resource.
  if (preflightPassed && cleanA) {
    await attempt(phaseB, "failure", topology);
    begin("b-cleanup");
    const container = await attempt(phaseB, "cleanupFailure", () => cleanupContainer(topologyOwned));
    const net = await attempt(network.record, "cleanupFailure", cleanupNetwork);
    cleanB = container && net;
  } else phaseB.skipped = preflightPassed ? "phase-a-cleanup-unproven" : "engine-or-image-preflight-failed";
  cleanupProven = cleanA && cleanB;
  Object.assign(result, { cleanupProven, elapsedMs: Date.now() - startedAt });
  writeFileSync(join(S, "result.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  try { archive(); archived = true; } catch (error) { console.error(JSON.stringify({ archiveFailure: failure(error) })); }
}
const passed = phaseA.verdict === "PASS" && phaseB.verdict === "PASS" && cleanupProven && archived;
process.exitCode = passed ? 0 : 1;
console.log(JSON.stringify({ token: T, phaseA: phaseA.verdict, phaseB: phaseB.verdict, cleanupProven, archived,
  evidence: archived ? ARCHIVE : ownsStage ? join(S, "result.json") : null, localPreflightFailure: result.localPreflightFailure ?? null,
  deploymentReady: false }));
