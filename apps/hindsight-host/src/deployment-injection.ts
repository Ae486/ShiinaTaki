/**
 * INPUT:  a live C2 injection, private fake-only Catalog selection and independent Core checkpoint
 * OUTPUT: durably fenced grant/submission to one original Native startup through fixed private stdin
 * POS:    hindsight-host — C2-only private sender; selected real values refuse before checkpoint or frame creation
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_CUSTODY_LIMITS } from "@taki/shared/hindsight-custody";
import {
  C2A_FAKE_VALUE, InjectionCheckpointResultSchema, type DeploymentEffectV1, type DeploymentInvocation,
  type InjectionCheckpointV1, type InjectionCheckpointResult, type NativeBootstrapStatus, type NativeStartupPermitV1,
} from "@taki/shared/hindsight-deployment";
import { withSelectedCatalog } from "./catalog-selection.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { packet, type DeploymentDockerAdapter } from "./docker-adapter.ts";
import type { DeploymentAttempt, DeploymentRegistry, OwnedDeploymentRecord } from "./deployment-registry.ts";
import { DeploymentError } from "./deployment-error.ts";

export interface InjectionContext {
  request: DeploymentInvocation; effect: Extract<DeploymentEffectV1, { action: "inject" }>;
  installation: VerifiedInstallation; adapter: DeploymentDockerAdapter; registry: DeploymentRegistry;
  record: OwnedDeploymentRecord; attempt: DeploymentAttempt; signal: AbortSignal;
  requireCurrent(): void;
  checkpoint(value: InjectionCheckpointV1): Promise<InjectionCheckpointResult>;
}

export async function injectFakeCredentials(context: InjectionContext): Promise<NativeBootstrapStatus> {
  return withSelectedCatalog({ selection: context.effect.custody.input, installation: context.installation,
    signal: context.signal, requireCurrent: context.requireCurrent }, async (values, validate) => {
    if (!values.length || values.some((entry) => !C2A_FAKE_VALUE.test(entry.value))) throw new DeploymentError("denied");
    const checkpoint = makeCheckpoint(context);
    fence(context, { phase: "checkpoint-dispatched", checkpointId: checkpoint.checkpointId });
    const answer = InjectionCheckpointResultSchema.parse(await context.checkpoint(checkpoint));
    validate();
    if (answer.state !== "granted") throw new DeploymentError(answer.reason);
    const permit = answer.permit;
    // The checkpoint may cross a Host/engine restart. Inspect the original
    // resource again before granting, and once more before private delivery.
    const beforeGrant = await context.adapter.inspectOwned(context.effect.plan, context.signal);
    validate();
    if (beforeGrant.container?.id !== context.effect.containerId || !beforeGrant.container.running) {
      throw new DeploymentError("ownership-conflict");
    }
    requirePermit(context, permit, checkpoint.checkpointId);
    fence(context, { phase: "grant-dispatched", startupAuthorizationId: permit.binding.authorizationId,
      startupDeadlineAt: permit.binding.deadlineAt });
    const granted = await context.adapter.control(context.effect.containerId, { version: 1, action: "authorize", permit }, context.signal);
    validate();
    requireStatusBinding(granted, permit);
    if (granted.state !== "waiting-for-credentials") throw new DeploymentError("outcome-unknown");
    const owned = await context.adapter.inspectOwned(context.effect.plan, context.signal);
    validate();
    if (owned.container?.id !== context.effect.containerId || !owned.container.running) throw new DeploymentError("ownership-conflict");
    requirePermit(context, permit, checkpoint.checkpointId);
    const credentials = context.effect.custody.input.selection.map(({ slot, source }) => source === "catalog"
      ? { slot, source, value: values.find((entry) => entry.slot === slot)?.value } : { slot, source });
    const bytes = Buffer.from(JSON.stringify({ version: 1, ...permit.binding, credentials }));
    if (bytes.length > HINDSIGHT_CUSTODY_LIMITS.privateFrameBytes) throw new DeploymentError("input-oversize");
    let frame: Buffer | undefined;
    try {
      validate();
      fence(context, { phase: "submit-dispatched" });
      frame = packet(bytes);
      const status = await context.adapter.submit(context.effect.containerId, frame, context.signal);
      validate();
      requireStatusBinding(status, permit);
      if (status.state !== "running" && status.state !== "stopped") throw new DeploymentError("outcome-unknown");
      fence(context, { phase: "observed" });
      return status;
    } finally { bytes.fill(0); frame?.fill(0); }
  });
}

function fence(context: InjectionContext, update: Partial<DeploymentAttempt>): void {
  context.requireCurrent();
  Object.assign(context.attempt, update);
  context.record.revision++;
  context.registry.publish(context.record);
}
function makeCheckpoint({ request, effect }: InjectionContext): InjectionCheckpointV1 {
  return { version: 1, requestId: request.requestId, control: request.control,
    ...(request.authorization ? { authorization: request.authorization } : {}), checkpointId: randomUUID(),
    deploymentId: effect.plan.deploymentId, containerId: effect.containerId, startupId: effect.startupId,
    configurationDigest: effect.plan.configurationDigest, custodySnapshotId: effect.custody.input.snapshotId };
}
function requirePermit(context: InjectionContext, permit: NativeStartupPermitV1, checkpointId: string): void {
  const binding = permit.binding;
  const limit = Math.min(Date.parse(context.effect.custody.deadlineAt), Date.parse(context.request.control.deadlineAt),
    context.request.control.expiresAt ? Date.parse(context.request.control.expiresAt) : Infinity);
  if (permit.checkpointId !== checkpointId || binding.startupId !== context.effect.startupId
    || binding.configurationDigest !== context.effect.plan.configurationDigest
    || binding.operationId !== context.effect.plan.operationId || binding.attemptId !== context.request.control.attemptId
    || Date.parse(binding.deadlineAt) > limit || Date.now() >= Date.parse(binding.deadlineAt)
    || JSON.stringify(permit.selection) !== JSON.stringify(context.effect.custody.input.selection.map(({ slot, source }) => ({ slot, source })))) {
    throw new DeploymentError("snapshot-stale");
  }
}
function requireStatusBinding(status: NativeBootstrapStatus, permit: NativeStartupPermitV1): void {
  if (Object.entries(permit.binding).some(([key, value]) => status[key as keyof NativeBootstrapStatus] !== value)) {
    throw new DeploymentError("outcome-unknown");
  }
}
