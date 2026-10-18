import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DeploymentEffectV1Schema, HindsightDeploymentRegistrationV1Schema } from "@taki/shared/hindsight-deployment";
import { FixedDockerAdapter, resourceLabels, resourceNames } from "./docker-adapter.ts";

const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("./docker-process.ts", () => ({ dockerExchange: exchange }));
const fixtures = new URL("../../../packages/shared/fixtures/protocol/", import.meta.url);
const registration = HindsightDeploymentRegistrationV1Schema.parse(JSON.parse(readFileSync(new URL("hindsight-deployment-registration.windows.valid.json", fixtures), "utf8")));
const plan = DeploymentEffectV1Schema.parse(JSON.parse(readFileSync(new URL("hindsight-deployment-effect.create.valid.json", fixtures), "utf8"))).plan;
const names = resourceNames(plan);
const id = "f".repeat(64);
const tmpfs = "rw,noexec,nosuid,size=8388608,mode=0700,uid=1000,gid=1000";

function harness() {
  const container = { Id: id, Name: `/${names.container}`, Image: plan.imageId,
    Config: { Image: plan.imageId, User: "1000:1000", Labels: resourceLabels(plan, "container") }, State: { Running: true },
    HostConfig: { NetworkMode: "none", Tmpfs: { "/run/taki-hindsight": tmpfs }, PortBindings: {} as Record<string, unknown> },
    Mounts: [{ Type: "volume", Name: names.volume, Destination: "/home/hindsight/.pg0", RW: true }] };
  const volume = { Name: names.volume, Driver: "local", Labels: resourceLabels(plan, "data") };
  const engine = { ID: registration.docker.engineId, OSType: "linux", Architecture: "amd64" };
  const image = { Id: registration.image.id, Os: "linux", Architecture: "amd64" };
  exchange.mockReset();
  exchange.mockImplementation(async (_registration, request: { argv: string[] }) => {
    const key = request.argv.join(" ");
    if (request.argv[0] === "info") return Buffer.from(JSON.stringify(engine));
    if (request.argv[0] === "version") return Buffer.from(registration.docker.version);
    if (request.argv[0] === "image") return Buffer.from(JSON.stringify([image]));
    if (key.startsWith("volume ls")) return Buffer.from(names.volume);
    if (key.startsWith("container ls")) return Buffer.from(id);
    if (key.startsWith("volume inspect")) return Buffer.from(JSON.stringify([volume]));
    if (key.startsWith("container inspect")) return Buffer.from(JSON.stringify([container]));
    return Buffer.alloc(0);
  });
  return { container, volume, engine, image, adapter: new FixedDockerAdapter(registration), signal: AbortSignal.timeout(1000) };
}

describe("fixed C2 Docker adapter", () => {
  it("emits only fixed create/start flags, one new volume and no private value in argv", async () => {
    const h = harness();
    await h.adapter.createVolume(plan, h.signal); await h.adapter.createContainer(plan, h.signal); await h.adapter.startContainer(id, h.signal);
    const argv = exchange.mock.calls.map(([, request]) => request.argv as string[]);
    expect(argv[0]).toEqual(expect.arrayContaining(["volume", "create", "--driver", "local", names.volume]));
    expect(argv[1]).toEqual(expect.arrayContaining(["create", "--pull=never", "--network", "none", "--user", "1000:1000",
      "--tmpfs", `/run/taki-hindsight:${tmpfs}`, `type=volume,src=${names.volume},dst=/home/hindsight/.pg0`, plan.imageId]));
    expect(argv[1]!.filter((value) => value === "--env")).toHaveLength(1);
    expect(argv[1]).toContain(`TAKI_C2A_CONFIGURATION_DIGEST=${plan.configurationDigest}`);
    expect(argv[2]).toEqual(["start", id]);
    expect(JSON.stringify(argv)).not.toContain("C2A_FAKE_");
  });

  it("accepts exact owned metadata and rejects extra bind mounts or changed ownership", async () => {
    const h = harness();
    expect(await h.adapter.inspectOwned(plan, h.signal)).toMatchObject({ container: { id, running: true }, volume: { name: names.volume } });
    h.container.Mounts.push({ Type: "bind", Name: "", Destination: "/arbitrary", RW: true });
    await expect(h.adapter.inspectOwned(plan, h.signal)).rejects.toMatchObject({ reason: "ownership-conflict" });
    h.container.Mounts.pop(); h.container.Config.Labels["taki.c2a.plan"] = "a".repeat(64);
    await expect(h.adapter.inspectOwned(plan, h.signal)).rejects.toMatchObject({ reason: "ownership-conflict" });
  });

  it.each(["engine", "image", "container", "volume", "user", "network", "ports", "tmpfs"])("refuses wrong %s metadata", async (kind) => {
    const h = harness();
    if (kind === "engine") h.engine.ID = "FOREIGN";
    if (kind === "image") h.image.Id = `sha256:${"0".repeat(64)}`;
    if (kind === "container") h.container.Image = `sha256:${"0".repeat(64)}`;
    if (kind === "volume") h.volume.Driver = "foreign";
    if (kind === "user") h.container.Config.User = "0";
    if (kind === "network") h.container.HostConfig.NetworkMode = "host";
    if (kind === "ports") h.container.HostConfig.PortBindings["8888/tcp"] = [];
    if (kind === "tmpfs") h.container.HostConfig.Tmpfs["/run/taki-hindsight"] = "rw";
    await expect(kind === "image" ? h.adapter.inspectImage(h.signal) : h.adapter.inspectOwned(plan, h.signal)).rejects.toThrow();
  });
});
