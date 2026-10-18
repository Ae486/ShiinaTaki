/**
 * INPUT:  inherited bounded resident frames from the verified Shell and fixed registration paths
 * OUTPUT: current-checkpoint relays and safe results from the concrete durable deployment owner
 * POS:    hindsight-host — installed resident entry; pipe loss retires authority without deleting resources
 */
import { DeploymentInvocationSchema, InjectionCheckpointResultSchema,
  type DeploymentInvocation, type InjectionCheckpointV1 } from "@taki/shared/hindsight-deployment";
import { openInstallation } from "./installation.ts";
import { openDeploymentRegistration } from "./deployment-registration.ts";
import { DeploymentRegistry } from "./deployment-registry.ts";
import { FixedDockerAdapter, packet } from "./docker-adapter.ts";
import { DeploymentOwner } from "./deployment-owner.ts";
import { DeploymentError } from "./deployment-error.ts";

export async function serveDeploymentHost(paths: { registration: string; deploymentRegistration: string }): Promise<void> {
  return serveDeploymentRequests((request) => {
    const installation = openInstallation(paths.registration, request.owner);
    const deployment = openDeploymentRegistration(paths.deploymentRegistration, installation);
    return new DeploymentOwner({ ...deployment, installation, registry: new DeploymentRegistry(deployment.registration.stateDirectory),
      adapter: new FixedDockerAdapter(deployment.registration) });
  });
}

/** The installed command supplies the fixed factory above. Constructor injection
 * lets process fixtures substitute only the external engine, with no CLI switch. */
export async function serveDeploymentRequests(createOwner: (request: DeploymentInvocation) => DeploymentOwner): Promise<void> {
  const frames = residentFrames()[Symbol.asyncIterator]();
  let owner: DeploymentOwner | undefined;
  for (;;) {
    const next = await frames.next();
    if (next.done) return;
    const request = DeploymentInvocationSchema.parse(next.value);
    owner ??= createOwner(request);
    const checkpoint = async (value: InjectionCheckpointV1) => {
      writeResidentFrame({ kind: "checkpoint", checkpoint: value });
      const answer = await frames.next();
      if (answer.done) throw new DeploymentError("outcome-unknown");
      return InjectionCheckpointResultSchema.parse(answer.value);
    };
    const status = await owner.execute(request, checkpoint);
    writeResidentFrame({ kind: "result", requestId: request.requestId, status });
  }
}

async function* residentFrames(): AsyncGenerator<unknown> {
  let buffered = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffered = Buffer.concat([buffered, chunk as Buffer]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE();
      if (length > 32 * 1024) throw new DeploymentError("input-oversize");
      if (buffered.length < length + 4) break;
      const payload = buffered.subarray(4, length + 4);
      buffered = buffered.subarray(length + 4);
      yield JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
    }
    if (buffered.length > 32 * 1024 + 4) throw new DeploymentError("input-oversize");
  }
  if (buffered.length !== 0) throw new DeploymentError("denied");
}
function writeResidentFrame(value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 32 * 1024) throw new DeploymentError("input-oversize");
  process.stdout.write(packet(bytes));
}
