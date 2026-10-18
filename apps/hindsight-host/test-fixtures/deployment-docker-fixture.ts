/**
 * INPUT:  the copied fake Docker executable's bounded argv/private pipe requests
 * OUTPUT: only the fixed adapter's finite command set, backed by the existing real Native fixture
 * POS:    hindsight-host/tests — production FixedDockerAdapter runs unchanged; no daemon or CLI discovery
 */
import { createServer, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DeploymentPlanV1Schema, type DeploymentPlanV1 } from "@taki/shared/hindsight-deployment";
import { packet, resourceLabels, resourceNames, type OwnedInspection } from "../src/docker-adapter.ts";
import type { DeploymentFixture } from "../src/deployment-test-fixtures.ts";
import { FakeDeploymentEngine } from "./deployment-process-fixture.ts";

const TMPFS = "rw,noexec,nosuid,size=8388608,mode=0700,uid=1000,gid=1000";
export class DockerCommandFixture {
  readonly engine: FakeDeploymentEngine;
  readonly argv: string[][] = [];
  private readonly fixture: DeploymentFixture;
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((socket) => this.connection(socket));
  constructor(fixture: DeploymentFixture) { this.fixture = fixture; this.engine = new FakeDeploymentEngine(fixture); }
  listen(path: string): Promise<void> {
    return new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(path, resolve); });
  }
  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.engine.close();
  }
  private connection(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(15_000, () => socket.destroy());
    let bytes = Buffer.alloc(0); let dispatched = false;
    socket.on("data", (chunk: Buffer) => {
      if (dispatched) { socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 4 * 1024 * 1024 + 32768) { socket.destroy(); return; }
      const call = decode(bytes);
      if (!call) return;
      dispatched = true;
      void this.run(call.argv, call.input).then((result) => { bytes.fill(0); socket.end(packet(result)); },
        () => { bytes.fill(0); socket.destroy(); });
    });
  }
  private async run(argv: string[], input: Buffer): Promise<Buffer> {
    const registration = this.fixture.deploymentRegistration;
    const prefix = ["--config", join(registration.stateDirectory, "docker-config"), "--host", registration.docker.endpoint];
    if (prefix.some((value, index) => value !== argv[index])) throw new Error("wrong fixed Docker prefix");
    const args = argv.slice(prefix.length); this.argv.push(args);
    const key = args.join(" ");
    if (key === "info --format {{json .}}") return json({ ID: registration.docker.engineId, OSType: "linux", Architecture: "amd64" });
    if (key === "version --format {{.Client.Version}}") return Buffer.from(registration.docker.version);
    if (key === `image inspect ${registration.image.id}`) return json([{ Id: registration.image.id, Os: "linux", Architecture: "amd64" }]);
    const record = JSON.parse(readFileSync(join(registration.stateDirectory, "deployment.json"), "utf8")) as { state: string; plan?: unknown };
    const plan = record.state === "owned" ? DeploymentPlanV1Schema.parse(record.plan) : undefined;
    const owned = plan ? await this.engine.handle("inspectOwned", [plan]) as OwnedInspection : { volume: null, container: null };
    if (args[0] === "volume" && args[1] === "ls") return Buffer.from(owned.volume?.name ?? "");
    if (args[0] === "container" && args[1] === "ls") return Buffer.from(owned.container?.id ?? "");
    if (!plan) throw new Error("effect requires original durable plan");
    const names = resourceNames(plan);
    if (key === `volume inspect ${names.volume}` && owned.volume) return json([{ Name: owned.volume.name, Driver: "local", Labels: owned.volume.labels }]);
    if (key === `container inspect ${names.container}` && owned.container) return json([containerMetadata(plan, owned.container)]);
    if (args[0] === "volume" && args[1] === "create") { await this.engine.handle("createVolume", [plan]); return Buffer.from(names.volume); }
    if (args[0] === "create") { await this.engine.handle("createContainer", [plan]); return Buffer.from(this.engine.containerId); }
    if (key === `start ${this.engine.containerId}`) { await this.engine.handle("startContainer", [this.engine.containerId]); return Buffer.from(this.engine.containerId); }
    const exec = ["exec", "-i", this.engine.containerId, "/app/api/.venv/bin/python", "-I", "-B", "-m"];
    if (args.length !== 8 || exec.some((value, index) => args[index] !== value)) throw new Error("unsupported fake Docker command");
    if (args[7] === "managed_bootstrap.submitter") return json(await this.engine.handle("submit", [this.engine.containerId, input]));
    if (args[7] !== "managed_bootstrap.control" || input.readUInt32LE() !== input.length - 4) throw new Error("invalid private control");
    return json(await this.engine.handle("control", [this.engine.containerId, JSON.parse(input.subarray(4).toString("utf8"))]));
  }
}
function containerMetadata(plan: DeploymentPlanV1, container: { id: string; running: boolean }) {
  const names = resourceNames(plan);
  return { Id: container.id, Name: `/${names.container}`, Image: plan.imageId,
    Config: { Image: plan.imageId, User: "1000:1000", Labels: resourceLabels(plan, "container") },
    State: { Running: container.running }, HostConfig: { NetworkMode: "none", Tmpfs: { "/run/taki-hindsight": TMPFS }, PortBindings: {} },
    Mounts: [{ Type: "volume", Name: names.volume, Destination: "/home/hindsight/.pg0", RW: true }] };
}
function json(value: unknown): Buffer { return Buffer.from(JSON.stringify(value)); }
function decode(bytes: Buffer): { argv: string[]; input: Buffer } | undefined {
  if (bytes.length < 4) return;
  const count = bytes.readUInt32LE();
  if (count > 64) throw new Error("fixture argv count");
  const parts: Buffer[] = []; let offset = 4;
  for (let index = 0; index <= count; index++) {
    if (offset + 4 > bytes.length) return;
    const length = bytes.readUInt32LE(offset); offset += 4;
    if (length > (index === count ? 4 * 1024 * 1024 + 4 : 4096)) throw new Error("fixture frame size");
    if (offset + length > bytes.length) return;
    parts.push(bytes.subarray(offset, offset + length)); offset += length;
  }
  if (offset !== bytes.length) throw new Error("trailing fixture bytes");
  return { argv: parts.slice(0, count).map((value) => value.toString("utf8")), input: parts[count]! };
}
