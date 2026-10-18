/**
 * INPUT:  explicit fake artifacts and a new protected C: fixture root
 * OUTPUT: copied installed Host, actual Core/operator/Rust Node and a finite private-pipe engine
 * POS:    hindsight-host/tests — one admitted source-checkpoint path; never starts Docker, GUI or a real provider
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHost } from "../scripts/build.ts";
import { deploymentFixture } from "../src/deployment-test-fixtures.ts";
import { fileDigest, sha256 } from "../src/installed-files.ts";
import { createConfigSource } from "../../../packages/core/src/config/config-source.ts";
import { resolveHindsightConfig } from "../../../packages/core/src/config/hindsight-config.ts";
import { getFreePort, killTree, spawnProc, type Proc } from "../../../e2e/src/fixture/procs.ts";
import { jsonLine } from "../../../e2e/src/fixture/line-buffer.ts";
import { pairOperator, setPermissionLevel } from "../../../e2e/src/fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "../../../e2e/src/fixture/rpc-socket.ts";
import { DockerCommandFixture } from "./deployment-docker-fixture.ts";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:9" };
const SCRATCH = process.env.TAKI_C2A_TEMP ?? "G:/Temp/taki-c2a-source-20261014-impl";

export async function installedDeploymentFixture() {
  const root = resolve(`C:/taki-c2a-fixture-${randomUUID()}`);
  mkdirSync(root);
  writeFileSync(join(root, ".c2a-owned-fixture"), "C2A_FAKE_ONLY", { flag: "wx" });
  const processes: Proc[] = []; let operator: RpcSocket | undefined; let docker: DockerCommandFixture | undefined;
  const close = async () => {
    operator?.close();
    for (const child of processes.slice().reverse()) { killTree(child); await child.exited; }
    await docker?.close();
    const logs = processes.flatMap((child) => [...child.stdout.lines(), ...child.stderr.lines()]);
    writeFileSync(join(SCRATCH, `${root.split(/[\\/]/).at(-1)}.log`), logs.join("\n"));
    // Only this invocation's original marked root may be recursively removed.
    if (realpathSync(root).toLowerCase() !== root.toLowerCase()
      || readFileSync(join(root, ".c2a-owned-fixture"), "utf8") !== "C2A_FAKE_ONLY") throw new Error("fixture cleanup identity mismatch");
    rmSync(root, { recursive: true });
  };
  try {
    const { fixture, payload, nodeData, credentials, pipe } = await provisionInstallation(root);
    docker = new DockerCommandFixture(fixture); await docker.listen(pipe);
    const port = await getFreePort(); const url = `ws://127.0.0.1:${port}`;
    const base = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: SCRATCH, TMP: SCRATCH,
      WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" };
    const core = spawnProc({ command: process.execPath, args: [join(REPOSITORY, "packages/core/src/main.ts")], cwd: root,
      env: { ...base, ...CONFIG, TAKI_DATA_DIR: fixture.registration.coreDataDirectory, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
        TAKI_TRUST_LOOPBACK_OPERATOR: "false", TAKI_CREDENTIALS_DIRECTORY: credentials,
        TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "e2e-dummy-key", TAKI_PROVIDER_MODEL: "e2e-dummy-model" } });
    processes.push(core);
    await core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", 30_000);
    const node = spawnProc({ command: join(REPOSITORY, "apps/desktop/src-tauri/target/debug/taki-node.exe"), args: [], cwd: nodeData,
      env: { ...base, TAKI_DATA_DIR: nodeData, TAKI_WS_URL: url, TAKI_DEVICE_NAME: "C2a installed fixture", TAKI_GATE_AUTOAPPROVE: "allow-once",
        TAKI_CAPABILITIES: "hindsight-custody,hindsight-deployment,hindsight-deployment-observe" } });
    processes.push(node);
    const code = jsonLine(await core.stdout.waitFor((line) => {
      const value = jsonLine(line); return value?.msg === "pairing code issued" && value.deviceName === "C2a installed fixture";
    }, 20_000))?.code;
    node.child.stdin?.write(`${String(code)}\n`);
    await node.stderr.waitFor((line) => line.includes("state=connected"), 30_000);
    operator = await openRpcSocket(url);
    await pairOperator(operator, { deviceId: randomUUID(), deviceName: "C2a operator", getCode: async () => String(jsonLine(
      await core.stdout.waitFor((line) => { const value = jsonLine(line); return value?.msg === "pairing code issued" && value.deviceName === "C2a operator"; }))?.code) });
    await setPermissionLevel(operator, "relaxed");
    return { fixture, payload, nodeData, core, node, operator, docker, close,
      evidencePath: join(SCRATCH, `${root.split(/[\\/]/).at(-1)}.json`) };
  } catch (error) { await close(); throw error; }
}

async function provisionInstallation(root: string) {
  const identity = protectRoot(root);
  const keyAdapter = join(SCRATCH, "fake-key-adapter.exe");
  const fixture = await deploymentFixture(root, keyAdapter);
  const payload = buildHost({ output: join(root, "payload"), platform: "win32", architecture: "x64", adapter: keyAdapter });
  const runtime = join(root, "node.exe"); copyFileSync(process.execPath, runtime);
  const executable = join(root, "fake-docker.exe");
  command("rustc", [join(REPOSITORY, "apps/hindsight-host/test-fixtures/fake-docker.rs"), "-o", executable]);
  const pipe = `\\\\.\\pipe\\taki-c2a-${randomUUID()}`; writeFileSync(join(root, "engine-pipe.txt"), pipe);
  const nodeData = join(root, "node-data"); mkdirSync(nodeData);
  const config = resolveHindsightConfig(createConfigSource({ env: CONFIG, repo: {
    get: () => null, all: () => new Map(), upsert: () => { throw new Error("fixture read only"); }, delete: () => { throw new Error("fixture read only"); },
  } }));
  if (config.state !== "ready") throw new Error("fake configuration not ready");
  fixture.plan.configurationDigest = sha256(JSON.stringify(config.projection));
  fixture.registration.installationRoot = payload;
  fixture.registration.manifestSha256 = fileDigest(join(payload, "manifest.json"));
  fixture.registration.runtime = { path: runtime, sha256: fileDigest(runtime), version: process.version };
  if (fixture.registration.custody.kind !== "windows-keyring") throw new Error("Windows fixture required");
  fixture.registration.custody.tokenUserSha256 = identity;
  fixture.registration.custody.adapter = { path: join(payload, "bin/taki-secret-key.exe"), sha256: fileDigest(keyAdapter) };
  fixture.deploymentRegistration.docker.path = executable;
  fixture.deploymentRegistration.docker.sha256 = fileDigest(executable);
  const deploymentText = JSON.stringify(fixture.deploymentRegistration);
  fixture.plan.deploymentRegistrationSha256 = sha256(deploymentText);
  for (const data of [fixture.registration.coreDataDirectory, nodeData]) {
    const directory = join(data, "hindsight-host"); mkdirSync(directory);
    writeFileSync(join(directory, "installation.json"), JSON.stringify(fixture.registration));
    writeFileSync(join(directory, "deployment-registration.json"), deploymentText);
  }
  writeFileSync(join(fixture.registration.coreDataDirectory, "host-identity.json"), JSON.stringify({ hostId: fixture.registration.coreHostId }));
  writeFileSync(join(nodeData, "secrets.json"), JSON.stringify({ "device-id": fixture.registration.executionHostId }));
  const credentials = join(root, "fake-credentials"); mkdirSync(credentials);
  writeFileSync(join(credentials, "taki-secret-catalog-master-key"), new Uint8Array(32).fill(0xa5));
  return { fixture, payload, nodeData, credentials, pipe };
}

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`fixture command failed: ${executable}: ${result.stderr}`);
  return result.stdout.trim();
}
function protectRoot(root: string): string {
  const script = "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User\n"
    + "$bytes = New-Object byte[] $sid.BinaryLength\n$sid.GetBinaryForm($bytes, 0)\n"
    + "$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)\n"
    + "[pscustomobject]@{sid=$sid.Value; digest=([System.BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant())} | ConvertTo-Json -Compress";
  const identity = JSON.parse(command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script])) as { sid: string; digest: string };
  command("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${identity.sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  return identity.digest;
}
