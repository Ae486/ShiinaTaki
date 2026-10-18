/**
 * INPUT:  admitted non-secret C2 plans, current Host control and private startup checkpoints
 * OUTPUT: strict fixed-topology deployment, observation, registration and permit contracts
 * POS:    shared/protocol — C2a proves only a fake child; no shape grants custody or readiness
 */
import { z } from "zod";
import {
  HindsightCustodyDigestSchema as Digest, HindsightCustodyPrepareSchema,
  HindsightCustodyRefusalSchema, HindsightFixedSelectionSchema, HindsightTrustedInvocationSchema,
} from "./hindsight-custody-schema.ts";
import { CapabilityAuthorizationLineageSchema, HostOperationControlSchema } from "./host-control-schema.ts";
import { canonicalCapabilityInput } from "./host-input-encoding.ts";

export const HINDSIGHT_DEPLOYMENT_CAPABILITY = "hindsight-deployment";
export const HINDSIGHT_DEPLOYMENT_OBSERVE_CAPABILITY = "hindsight-deployment-observe";
export const HINDSIGHT_DEPLOYMENT_METHODS = {
  start: "memory.hindsight.deployment.start", observe: "memory.hindsight.deployment.observe",
  resumeStartup: "memory.hindsight.deployment.resumeStartup", checkpoint: "host.hindsight.deployment.checkpoint",
} as const;
export const HINDSIGHT_DEPLOYMENT_LIMITS = { requestBytes: 32 * 1024, statusBytes: 16 * 1024,
  registryBytes: 1024 * 1024, attempts: 64, admissionMs: 90_000 } as const;
export const C2A_FAKE_VALUE = /^C2A_FAKE_[0-9a-f]{64}$/;
const Id = z.uuid();
const Time = z.iso.datetime({ offset: true });
const Engine = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_.-]+$/);
export const DockerIdSchema = Digest;
const Image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const AbsolutePath = z.string().min(1).max(4096).refine((value) => !value.includes("\0")
  && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/")));

export const DeploymentPlanV1Schema = z.strictObject({
  version: z.literal(1), deploymentId: Id, operationId: Id, coreHostId: Id, executionHostId: Id,
  installationId: Digest, deploymentRegistrationSha256: Digest, engineId: Engine, imageId: Image,
  configurationDigest: Digest, consumer: z.literal("c2a-fake-v1"), storage: z.literal("new-named-volume"),
}).refine((value) => value.deploymentId === value.operationId, "different original operation");
export type DeploymentPlanV1 = z.infer<typeof DeploymentPlanV1Schema>;
export function canonicalDeploymentPlan(plan: DeploymentPlanV1): string {
  return canonicalCapabilityInput("hindsight-deployment-plan:v1", DeploymentPlanV1Schema.parse(plan));
}

export const CustodyAttemptMappingSchema = z.strictObject({
  coreOperationId: Id, coreAttemptId: Id, brokerOperationId: Id, hostAttemptId: Id, requestId: Id, inputDigest: Digest,
}).refine((value) => value.coreOperationId === value.brokerOperationId, "different custody operation");
export type CustodyAttemptMapping = z.infer<typeof CustodyAttemptMappingSchema>;
export const CustodyLinkV1Schema = z.strictObject({
  input: HindsightCustodyPrepareSchema, mapping: CustodyAttemptMappingSchema, deadlineAt: Time,
});
export type CustodyLinkV1 = z.infer<typeof CustodyLinkV1Schema>;
const EffectBase = { version: z.literal(1), plan: DeploymentPlanV1Schema, custody: CustodyLinkV1Schema };
export const DeploymentEffectV1Schema = z.discriminatedUnion("action", [
  z.strictObject({ ...EffectBase, action: z.literal("create") }),
  z.strictObject({ ...EffectBase, action: z.literal("start"), containerId: DockerIdSchema }),
  z.strictObject({ ...EffectBase, action: z.literal("inject"), containerId: DockerIdSchema, startupId: Id }),
]).refine((value) => value.plan.configurationDigest === value.custody.input.configurationDigest
  && value.plan.installationId === value.custody.input.installationId
  && value.plan.coreHostId === value.custody.input.coreHostId, "different custody plan");
export type DeploymentEffectV1 = z.infer<typeof DeploymentEffectV1Schema>;
export const DeploymentObserveV1Schema = z.strictObject({ version: z.literal(1), deploymentId: Id });
export type DeploymentObserveV1 = z.infer<typeof DeploymentObserveV1Schema>;
export const DeploymentStartParamsSchema = z.strictObject({ idempotencyKey: Id, expectedConfigurationDigest: Digest });
export type DeploymentStartParams = z.infer<typeof DeploymentStartParamsSchema>;
export const DeploymentIdParamsSchema = z.strictObject({ deploymentId: Id });

export const InjectionCheckpointV1Schema = z.strictObject({
  version: z.literal(1), requestId: Id, control: HostOperationControlSchema,
  authorization: CapabilityAuthorizationLineageSchema.optional(), checkpointId: Id, deploymentId: Id,
  containerId: DockerIdSchema, startupId: Id, configurationDigest: Digest, custodySnapshotId: Id,
});
export type InjectionCheckpointV1 = z.infer<typeof InjectionCheckpointV1Schema>;
export const NativeStartupBindingSchema = z.strictObject({
  startupId: Id, configurationDigest: Digest, operationId: Id, attemptId: Id, authorizationId: Id, deadlineAt: Time,
});
export const NativeStartupPermitV1Schema = z.strictObject({
  version: z.literal(1), checkpointId: Id, binding: NativeStartupBindingSchema, selection: HindsightFixedSelectionSchema,
});
export type NativeStartupPermitV1 = z.infer<typeof NativeStartupPermitV1Schema>;
export const BootstrapOwnerRequestV1Schema = z.discriminatedUnion("action", [
  z.strictObject({ version: z.literal(1), action: z.literal("status") }),
  z.strictObject({ version: z.literal(1), action: z.literal("authorize"), permit: NativeStartupPermitV1Schema }),
]);
export type BootstrapOwnerRequestV1 = z.infer<typeof BootstrapOwnerRequestV1Schema>;
export const DeploymentRefusalSchema = z.enum([...HindsightCustodyRefusalSchema.options,
  "ownership-conflict", "engine-mismatch", "artifact-mismatch", "registry-unavailable", "registry-full"]);
export type DeploymentRefusal = z.infer<typeof DeploymentRefusalSchema>;
export const InjectionCheckpointResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("granted"), permit: NativeStartupPermitV1Schema }),
  z.strictObject({ state: z.literal("unavailable"), reason: DeploymentRefusalSchema }),
]);
export type InjectionCheckpointResult = z.infer<typeof InjectionCheckpointResultSchema>;

export const NativeBootstrapStatusSchema = z.strictObject({
  version: z.literal(1), state: z.enum(["waiting-for-credentials", "running", "stopped", "unavailable"]),
  startupId: Id, configurationDigest: Digest, deploymentReady: z.literal(false),
  operationId: Id.optional(), attemptId: Id.optional(), authorizationId: Id.optional(), deadlineAt: Time.optional(),
  reason: HindsightCustodyRefusalSchema.optional(),
}).refine((value) => [value.operationId, value.attemptId, value.authorizationId, value.deadlineAt]
  .filter((part) => part !== undefined).length % 4 === 0
  && (value.state !== "running" || value.operationId !== undefined)
  && (value.state === "unavailable") === (value.reason !== undefined), "invalid startup status");
export type NativeBootstrapStatus = z.infer<typeof NativeBootstrapStatusSchema>;
export const DeploymentStatusV1Schema = z.strictObject({
  version: z.literal(1), state: z.enum(["waiting", "running", "stopped", "unavailable", "outcome-unknown"]),
  deploymentId: Id.optional(), operationId: Id.optional(), configurationDigest: Digest.optional(),
  containerId: DockerIdSchema.optional(), startupId: Id.optional(), attemptId: Id.optional(),
  reason: DeploymentRefusalSchema.optional(), deploymentReady: z.literal(false),
}).refine((value) => value.deploymentId === value.operationId
  && ((value.deploymentId !== undefined && value.configurationDigest !== undefined) || value.state === "unavailable")
  && (value.state !== "running" || !!(value.containerId && value.startupId && value.attemptId)), "invalid deployment status");
export type DeploymentStatusV1 = z.infer<typeof DeploymentStatusV1Schema>;

export const HindsightDeploymentRegistrationV1Schema = z.strictObject({
  version: z.literal(1), installationId: Digest, coreHostId: Id, executionHostId: Id,
  docker: z.strictObject({ path: AbsolutePath, sha256: Digest, version: z.string().min(1).max(128),
    endpoint: z.literal("npipe:////./pipe/dockerDesktopLinuxEngine"), engineId: Engine }),
  image: z.strictObject({ id: Image, os: z.literal("linux"), architecture: z.literal("amd64"),
    consumer: z.literal("c2a-fake-v1"), bootstrapVersion: z.literal(1) }),
  stateDirectory: AbsolutePath,
});
export type HindsightDeploymentRegistrationV1 = z.infer<typeof HindsightDeploymentRegistrationV1Schema>;
export const DeploymentInvocationSchema = z.strictObject({
  version: z.literal(1), requestId: Id, control: HostOperationControlSchema,
  authorization: CapabilityAuthorizationLineageSchema.optional(), owner: HindsightTrustedInvocationSchema.shape.owner,
  input: z.union([DeploymentEffectV1Schema, DeploymentObserveV1Schema]),
}).refine((value) => "action" in value.input
  ? value.control.capabilityId === HINDSIGHT_DEPLOYMENT_CAPABILITY
  : value.control.capabilityId === HINDSIGHT_DEPLOYMENT_OBSERVE_CAPABILITY, "wrong deployment capability");
export type DeploymentInvocation = z.infer<typeof DeploymentInvocationSchema>;
export const DeploymentResidentReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("checkpoint"), checkpoint: InjectionCheckpointV1Schema }),
  z.strictObject({ kind: z.literal("result"), requestId: Id, status: DeploymentStatusV1Schema }),
]);
