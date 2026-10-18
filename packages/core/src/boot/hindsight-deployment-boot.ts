/**
 * INPUT:  real Run/Effect route, C1 owner and explicit protected deployment registration
 * OUTPUT: three operator methods and the Node-only current injection checkpoint
 * POS:    core/boot — reads non-secret installation metadata; never starts or inspects Docker directly
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import {
  HINDSIGHT_DEPLOYMENT_METHODS, HindsightDeploymentRegistrationV1Schema, DeploymentStartParamsSchema,
  DeploymentIdParamsSchema, DeploymentStatusV1Schema,
} from "@taki/shared/hindsight-deployment";
import type { RunService } from "../harness/run-service.ts";
import { routeCapability, type CapabilityRouteDeps, type InteractiveOperator } from "../capabilities/route-capability.ts";
import { HindsightDeploymentOwner } from "../memory/hindsight/hindsight-deployment-owner.ts";
import type { HindsightCustodyOwner } from "../memory/hindsight/hindsight-custody-owner.ts";
import { hindsightDeploymentCheckpointMethod } from "../server/methods/hindsight-deployment-checkpoint.ts";
import type { MethodRegistry } from "../server/method-registry.ts";

export function composeHindsightDeployment(deps: {
  dataDir: string; coreHostId: string; runs: RunService<InteractiveOperator>;
  custody: HindsightCustodyOwner; route: CapabilityRouteDeps; methods: MethodRegistry;
}) {
  const owner = new HindsightDeploymentOwner({ runs: deps.runs, custody: deps.custody,
    registration: () => readRegistration(deps.dataDir, deps.coreHostId),
    route: (request, interactive) => routeCapability({ ...deps.route, interactive }, request) });
  deps.methods.register({ method: HINDSIGHT_DEPLOYMENT_METHODS.start, roles: ["operator"], paramsSchema: DeploymentStartParamsSchema,
    handler: async (params, context) => DeploymentStatusV1Schema.parse(await owner.start(params, { connection: context.connection })) });
  deps.methods.register({ method: HINDSIGHT_DEPLOYMENT_METHODS.observe, roles: ["operator"], paramsSchema: DeploymentIdParamsSchema,
    handler: async (params, context) => DeploymentStatusV1Schema.parse(await owner.observe(params.deploymentId, { connection: context.connection })) });
  deps.methods.register({ method: HINDSIGHT_DEPLOYMENT_METHODS.resumeStartup, roles: ["operator"], paramsSchema: DeploymentIdParamsSchema,
    handler: async (params, context) => DeploymentStatusV1Schema.parse(await owner.resumeStartup(params.deploymentId, { connection: context.connection })) });
  deps.methods.register(hindsightDeploymentCheckpointMethod(deps.route.broker, deps.route.registry));
  return owner;
}
function readRegistration(dataDir: string, coreHostId: string) {
  let fd: number | undefined;
  try {
    fd = openSync(join(dataDir, "hindsight-host", "deployment-registration.json"), "r");
    const bytes = Buffer.alloc(32 * 1024 + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count > 32 * 1024) return null;
    const content = bytes.subarray(0, count);
    const registration = HindsightDeploymentRegistrationV1Schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)));
    if (registration.coreHostId !== coreHostId) return null;
    return { registration, sha256: createHash("sha256").update(content).digest("hex") };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
