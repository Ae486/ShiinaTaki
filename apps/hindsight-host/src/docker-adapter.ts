/**
 * INPUT:  protected C2 registration, original plan and exact recorded Docker identities
 * OUTPUT: fixed create/start/private-control operations plus owned-only inspection
 * POS:    hindsight-host — all engine effects live here; no pull, delete, adopt or arbitrary options
 */
import { z } from "zod";
import {
  BootstrapOwnerRequestV1Schema, DockerIdSchema, NativeBootstrapStatusSchema, canonicalDeploymentPlan,
  type BootstrapOwnerRequestV1, type DeploymentPlanV1, type HindsightDeploymentRegistrationV1,
  type NativeBootstrapStatus,
} from "@taki/shared/hindsight-deployment";
import { OwnedVolumeSchema } from "./deployment-registry.ts";
import { DeploymentError } from "./deployment-error.ts";
import { sha256 } from "./installed-files.ts";
import { dockerExchange } from "./docker-process.ts";

export type OwnedVolume = z.infer<typeof OwnedVolumeSchema>;
export interface OwnedInspection { volume: OwnedVolume | null; container: { id: string; running: boolean } | null }
export interface DeploymentDockerAdapter {
  inspectEngine(signal: AbortSignal): Promise<void>;
  inspectImage(signal: AbortSignal): Promise<void>;
  inspectOwned(plan: DeploymentPlanV1, signal: AbortSignal): Promise<OwnedInspection>;
  createVolume(plan: DeploymentPlanV1, signal: AbortSignal): Promise<void>;
  createContainer(plan: DeploymentPlanV1, signal: AbortSignal): Promise<void>;
  startContainer(containerId: string, signal: AbortSignal): Promise<void>;
  control(containerId: string, request: BootstrapOwnerRequestV1, signal: AbortSignal): Promise<NativeBootstrapStatus>;
  submit(containerId: string, frame: Uint8Array, signal: AbortSignal): Promise<NativeBootstrapStatus>;
}
export function resourceNames(plan: DeploymentPlanV1) {
  return { container: `taki-c2a-${plan.deploymentId}`, volume: `taki-c2a-${plan.deploymentId}-data` };
}
export function resourceLabels(plan: DeploymentPlanV1, role: "container" | "data"): Record<string, string> {
  return { "taki.c2a.deployment": plan.deploymentId, "taki.c2a.core": plan.coreHostId,
    "taki.c2a.host": plan.executionHostId, "taki.c2a.installation": plan.installationId,
    "taki.c2a.plan": sha256(canonicalDeploymentPlan(plan)), "taki.c2a.role": role };
}
const TMPFS = "rw,noexec,nosuid,size=8388608,mode=0700,uid=1000,gid=1000";
const MapSchema = z.record(z.string(), z.string());
const Volume = z.object({ Name: z.string(), Driver: z.string(), Labels: MapSchema });
const Container = z.object({ Id: DockerIdSchema, Name: z.string(), Image: z.string(),
  Config: z.object({ Image: z.string(), User: z.string(), Labels: MapSchema }),
  State: z.object({ Running: z.boolean() }),
  HostConfig: z.object({ NetworkMode: z.string(), Tmpfs: MapSchema, PortBindings: z.record(z.string(), z.unknown()).nullable() }),
  Mounts: z.array(z.object({ Type: z.string(), Name: z.string().optional(), Destination: z.string(), RW: z.boolean() })),
});

export class FixedDockerAdapter implements DeploymentDockerAdapter {
  private readonly registration: HindsightDeploymentRegistrationV1;
  constructor(registration: HindsightDeploymentRegistrationV1) { this.registration = registration; }

  async inspectEngine(signal: AbortSignal): Promise<void> {
    const value = z.object({ ID: z.string(), OSType: z.string(), Architecture: z.string() }).parse(await this.json(["info", "--format", "{{json .}}"], signal));
    if (value.ID !== this.registration.docker.engineId || value.OSType !== "linux"
      || !["x86_64", "amd64"].includes(value.Architecture)) throw new DeploymentError("engine-mismatch");
    const version = await this.run(["version", "--format", "{{.Client.Version}}"], signal);
    if (version.toString("utf8").trim() !== this.registration.docker.version) throw new DeploymentError("artifact-mismatch");
  }

  async inspectImage(signal: AbortSignal): Promise<void> {
    const values = z.array(z.object({ Id: z.string(), Os: z.string(), Architecture: z.string() })).length(1)
      .parse(await this.json(["image", "inspect", this.registration.image.id], signal));
    const image = values[0];
    if (!image || image.Id !== this.registration.image.id || image.Os !== "linux" || image.Architecture !== "amd64") {
      throw new DeploymentError("artifact-mismatch");
    }
  }

  async inspectOwned(plan: DeploymentPlanV1, signal: AbortSignal): Promise<OwnedInspection> {
    await this.inspectEngine(signal);
    const names = resourceNames(plan);
    // Listing exact names distinguishes absence from CLI failure. A failed
    // inspect is never silently treated as permission to create a replacement.
    const volumeNames = (await this.run(["volume", "ls", "--format", "{{.Name}}", "--filter", `name=^${names.volume}$`], signal)).toString("utf8").trim();
    const containers = (await this.run(["container", "ls", "--all", "--no-trunc", "--format", "{{.ID}}", "--filter", `name=^/${names.container}$`], signal)).toString("utf8").trim();
    const volume = volumeNames ? await this.volume(plan, signal) : null;
    const container = containers ? await this.container(plan, signal) : null;
    if (volumeNames && volumeNames !== names.volume) throw new DeploymentError("ownership-conflict");
    if (containers && containers !== container?.id) throw new DeploymentError("ownership-conflict");
    return { volume, container };
  }

  async createVolume(plan: DeploymentPlanV1, signal: AbortSignal): Promise<void> {
    await this.run(["volume", "create", "--driver", "local", ...labelsArgs(resourceLabels(plan, "data")), resourceNames(plan).volume], signal);
  }
  async createContainer(plan: DeploymentPlanV1, signal: AbortSignal): Promise<void> {
    const names = resourceNames(plan);
    await this.run(["create", "--pull=never", "--name", names.container, "--network", "none", "--user", "1000:1000",
      ...labelsArgs(resourceLabels(plan, "container")), "--mount", `type=volume,src=${names.volume},dst=/home/hindsight/.pg0`,
      "--tmpfs", `/run/taki-hindsight:${TMPFS}`, "--env", `TAKI_C2A_CONFIGURATION_DIGEST=${plan.configurationDigest}`, plan.imageId], signal);
  }
  async startContainer(containerId: string, signal: AbortSignal): Promise<void> {
    await this.run(["start", DockerIdSchema.parse(containerId)], signal);
  }
  control(containerId: string, request: BootstrapOwnerRequestV1, signal: AbortSignal): Promise<NativeBootstrapStatus> {
    return this.privateExchange(containerId, { module: "control", bytes: packet(Buffer.from(JSON.stringify(BootstrapOwnerRequestV1Schema.parse(request)))) }, signal);
  }
  submit(containerId: string, frame: Uint8Array, signal: AbortSignal): Promise<NativeBootstrapStatus> {
    return this.privateExchange(containerId, { module: "submitter", bytes: frame }, signal);
  }

  private async privateExchange(containerId: string, input: { module: "control" | "submitter"; bytes: Uint8Array }, signal: AbortSignal) {
    const bytes = await dockerExchange(this.registration, { argv: ["exec", "-i", DockerIdSchema.parse(containerId),
      "/app/api/.venv/bin/python", "-I", "-B", "-m", `managed_bootstrap.${input.module}`], input: input.bytes, signal, maxBytes: 16 * 1024 });
    return NativeBootstrapStatusSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  }
  private run(argv: string[], signal: AbortSignal): Promise<Buffer> { return dockerExchange(this.registration, { argv, signal }); }
  private async json(argv: string[], signal: AbortSignal): Promise<unknown> {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await this.run(argv, signal))) as unknown;
  }
  private async volume(plan: DeploymentPlanV1, signal: AbortSignal): Promise<OwnedVolume> {
    const entry = z.array(Volume).length(1).parse(await this.json(["volume", "inspect", resourceNames(plan).volume], signal))[0];
    if (!entry || entry.Name !== resourceNames(plan).volume || entry.Driver !== "local"
      || !labelsMatch(entry.Labels, resourceLabels(plan, "data"))) throw new DeploymentError("ownership-conflict");
    return { name: entry.Name, driver: "local", labels: entry.Labels };
  }
  private async container(plan: DeploymentPlanV1, signal: AbortSignal) {
    const entry = z.array(Container).length(1).parse(await this.json(["container", "inspect", resourceNames(plan).container], signal))[0];
    if (!entry || entry.Name !== `/${resourceNames(plan).container}` || entry.Image !== plan.imageId
      || entry.Config.Image !== plan.imageId || entry.Config.User !== "1000:1000"
      || !labelsMatch(entry.Config.Labels, resourceLabels(plan, "container"))
      || entry.HostConfig.NetworkMode !== "none" || entry.HostConfig.Tmpfs["/run/taki-hindsight"] !== TMPFS
      || Object.keys(entry.HostConfig.Tmpfs).length !== 1 || Object.keys(entry.HostConfig.PortBindings ?? {}).length !== 0
      || entry.Mounts.filter((mount) => mount.Type === "volume").length !== 1
      || entry.Mounts.some((mount) => mount.Type !== "volume"
        && !(mount.Type === "tmpfs" && mount.Destination === "/run/taki-hindsight" && mount.RW))
      || entry.Mounts.filter((mount) => mount.Type === "tmpfs").length > 1
      || !entry.Mounts.some((mount) => mount.Type === "volume" && mount.Name === resourceNames(plan).volume
        && mount.Destination === "/home/hindsight/.pg0" && mount.RW)) throw new DeploymentError("ownership-conflict");
    return { id: entry.Id, running: entry.State.Running };
  }
}
function labelsArgs(labels: Record<string, string>): string[] { return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]); }
function labelsMatch(actual: Record<string, string>, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}
export function packet(bytes: Buffer): Buffer {
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(bytes.length); return Buffer.concat([prefix, bytes]);
}
