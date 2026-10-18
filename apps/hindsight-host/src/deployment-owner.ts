/**
 * INPUT:  post-gate C2 invocations, protected registration/registry and a fixed Docker adapter
 * OUTPUT: one durably owned fake deployment and original-resource observation without effect replay
 * POS:    hindsight-host — resident resource owner; reopened records carry facts, never renewed authority
 */
import {
  DeploymentInvocationSchema, DeploymentStatusV1Schema, HINDSIGHT_DEPLOYMENT_LIMITS, canonicalDeploymentPlan,
  type DeploymentEffectV1, type DeploymentInvocation, type DeploymentPlanV1, type DeploymentStatusV1,
  type HindsightDeploymentRegistrationV1, type InjectionCheckpointResult, type InjectionCheckpointV1,
  type NativeBootstrapStatus,
} from "@taki/shared/hindsight-deployment";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import type { VerifiedInstallation } from "./installation.ts";
import { sha256 } from "./installed-files.ts";
import { DeploymentError, deploymentReason } from "./deployment-error.ts";
import { DeploymentRegistry, type DeploymentAttempt, type OwnedDeploymentRecord } from "./deployment-registry.ts";
import type { DeploymentDockerAdapter, OwnedInspection } from "./docker-adapter.ts";
import { injectFakeCredentials } from "./deployment-injection.ts";

export interface DeploymentOwnerDeps {
  registration: HindsightDeploymentRegistrationV1; registrationSha256: string;
  installation: VerifiedInstallation; registry: DeploymentRegistry; adapter: DeploymentDockerAdapter;
  validate(): void;
}
export class DeploymentOwner {
  private readonly deps: DeploymentOwnerDeps;
  private busy = false;
  constructor(deps: DeploymentOwnerDeps) { this.deps = deps; }

  async execute(candidate: DeploymentInvocation, checkpoint: (input: InjectionCheckpointV1) => Promise<InjectionCheckpointResult>): Promise<DeploymentStatusV1> {
    if (this.busy) return this.failure(new DeploymentError("outcome-unknown"));
    this.busy = true;
    let request: DeploymentInvocation | undefined;
    try {
      request = DeploymentInvocationSchema.parse(candidate);
      const signal = AbortSignal.timeout(Math.max(1, Date.parse(request.control.deadlineAt) - Date.now()));
      this.requireCurrent(request, signal);
      if (!("action" in request.input)) return await this.observe(request.input.deploymentId, signal);
      const effect = request.input;
      this.requirePlan(effect.plan);
      if (!request.control.coreAttemptId || !request.control.effectId || request.control.operationId !== effect.plan.operationId
        || (effect.action !== "inject" && request.control.runId !== effect.plan.deploymentId)) throw new DeploymentError("denied");
      if (effect.action === "create") return await this.create(request, effect, signal);
      const record = this.owned(effect.plan.deploymentId);
      if (canonicalDeploymentPlan(record.plan) !== canonicalDeploymentPlan(effect.plan)
        || record.containerId !== effect.containerId) throw new DeploymentError("ownership-conflict");
      if (effect.action === "start") return await this.start(request, record, signal);
      return await this.inject({ request, effect, record, signal, checkpoint });
    } catch (error) { return this.failure(error, request); }
    finally { this.busy = false; }
  }

  async observe(deploymentId: string, signal: AbortSignal): Promise<DeploymentStatusV1> {
    const record = this.owned(deploymentId);
    this.requirePlan(record.plan);
    const inspected = await this.deps.adapter.inspectOwned(record.plan, signal);
    this.deps.validate(); this.deps.registry.validate();
    recoverResources(record, inspected);
    this.save(record);
    if (!record.containerId || !inspected.container) return status(record, "outcome-unknown");
    if (!inspected.container.running) return status(record, "stopped");
    const native = await this.deps.adapter.control(record.containerId, { version: 1, action: "status" }, signal);
    this.deps.validate(); this.deps.registry.validate();
    return observedStatus(record, native);
  }

  private async create(request: DeploymentInvocation, effect: DeploymentEffectV1, signal: AbortSignal) {
    const current = this.deps.registry.snapshot();
    if (current.state === "owned") {
      if (canonicalDeploymentPlan(current.plan) !== canonicalDeploymentPlan(effect.plan)) throw new DeploymentError("ownership-conflict");
      return this.observe(current.plan.deploymentId, signal);
    }
    await this.deps.adapter.inspectEngine(signal);
    await this.deps.adapter.inspectImage(signal);
    const occupied = await this.deps.adapter.inspectOwned(effect.plan, signal);
    this.requireCurrent(request, signal);
    if (occupied.volume || occupied.container) throw new DeploymentError("ownership-conflict");
    const record: OwnedDeploymentRecord = { version: 1, state: "owned", revision: 0, plan: effect.plan,
      planDigest: sha256(canonicalDeploymentPlan(effect.plan)), steps: {}, attempts: [] };
    this.addAttempt(record, request, effect);
    this.save(record);
    record.steps.volume = "dispatched";
    this.save(record);
    await this.deps.adapter.createVolume(effect.plan, signal);
    this.requireCurrent(request, signal);
    const volume = await this.deps.adapter.inspectOwned(effect.plan, signal);
    this.requireCurrent(request, signal);
    if (!volume.volume || volume.container) throw new DeploymentError("ownership-conflict");
    recoverResources(record, volume);
    this.save(record);
    record.steps.container = "dispatched";
    this.save(record);
    await this.deps.adapter.createContainer(effect.plan, signal);
    this.requireCurrent(request, signal);
    return this.observe(record.plan.deploymentId, signal);
  }

  private async start(request: DeploymentInvocation, record: OwnedDeploymentRecord, signal: AbortSignal) {
    if (record.steps.start) return this.observe(record.plan.deploymentId, signal);
    const inspected = await this.deps.adapter.inspectOwned(record.plan, signal);
    await this.deps.adapter.inspectImage(signal);
    this.requireCurrent(request, signal);
    recoverResources(record, inspected);
    if (!record.containerId || !inspected.container || inspected.container.running) throw new DeploymentError("ownership-conflict");
    if (!("action" in request.input)) throw new DeploymentError("denied");
    this.addAttempt(record, request, request.input);
    record.steps.start = "dispatched";
    this.save(record);
    await this.deps.adapter.startContainer(record.containerId, signal);
    this.requireCurrent(request, signal);
    return this.observe(record.plan.deploymentId, signal);
  }

  private async inject(input: {
    request: DeploymentInvocation; effect: Extract<DeploymentEffectV1, { action: "inject" }>;
    record: OwnedDeploymentRecord; signal: AbortSignal;
    checkpoint(value: InjectionCheckpointV1): Promise<InjectionCheckpointResult>;
  }) {
    const { request, effect, record, signal, checkpoint } = input;
    if (record.attempts.some((entry) => entry.action === "inject" && entry.startupId === effect.startupId)) {
      return this.observe(record.plan.deploymentId, signal);
    }
    const before = await this.observe(record.plan.deploymentId, signal);
    this.requireCurrent(request, signal);
    if (before.state !== "waiting" || before.startupId !== effect.startupId || before.attemptId) throw new DeploymentError("snapshot-stale");
    // Observation may publish recovered facts. Continue from that exact new revision.
    const current = this.owned(record.plan.deploymentId);
    const attempt = this.addAttempt(current, request, effect);
    this.save(current);
    const native = await injectFakeCredentials({ request, effect, record: current, attempt, signal, checkpoint,
      installation: this.deps.installation, adapter: this.deps.adapter, registry: this.deps.registry,
      requireCurrent: () => this.requireCurrent(request, signal) });
    this.requireCurrent(request, signal);
    return observedStatus(current, native);
  }

  private addAttempt(record: OwnedDeploymentRecord, request: DeploymentInvocation, effect: DeploymentEffectV1): DeploymentAttempt {
    if (record.attempts.length >= HINDSIGHT_DEPLOYMENT_LIMITS.attempts) throw new DeploymentError("registry-full");
    const attempt: DeploymentAttempt = { requestId: request.requestId, control: request.control, custody: effect.custody,
      ...(request.authorization ? { authorization: request.authorization } : {}), action: effect.action, phase: "admitted",
      ...(effect.action === "inject" ? { startupId: effect.startupId } : {}) };
    record.attempts.push(attempt);
    return attempt;
  }
  private save(record: OwnedDeploymentRecord): void { record.revision++; this.deps.registry.publish(record); }
  private owned(deploymentId: string): OwnedDeploymentRecord {
    const record = this.deps.registry.snapshot();
    if (record.state !== "owned" || record.plan.deploymentId !== deploymentId) throw new DeploymentError("ownership-conflict");
    return record;
  }
  private requirePlan(plan: DeploymentPlanV1): void {
    const registration = this.deps.registration;
    if (plan.installationId !== registration.installationId || plan.coreHostId !== registration.coreHostId
      || plan.executionHostId !== registration.executionHostId || plan.engineId !== registration.docker.engineId
      || plan.imageId !== registration.image.id || plan.deploymentRegistrationSha256 !== this.deps.registrationSha256) {
      throw new DeploymentError("ownership-conflict");
    }
  }
  private requireCurrent(request: DeploymentInvocation, signal: AbortSignal): void {
    this.deps.validate(); this.deps.registry.validate(); this.deps.installation.validate();
    const control = request.control;
    if (signal.aborted || Date.now() >= Date.parse(control.deadlineAt)
      || (control.expiresAt && Date.now() >= Date.parse(control.expiresAt))
      || control.targetHostId !== this.deps.registration.executionHostId
      || JSON.stringify(request.owner) !== JSON.stringify(this.deps.installation.owner)
      || sha256(canonicalCapabilityInput(control.capabilityId, request.input)) !== control.inputDigest) throw new DeploymentError("snapshot-stale");
    if ("action" in request.input && (Date.now() >= Date.parse(request.input.custody.deadlineAt)
      || sha256(canonicalCapabilityInput("hindsight-custody", request.input.custody.input)) !== request.input.custody.mapping.inputDigest)) {
      throw new DeploymentError("snapshot-stale");
    }
  }
  private failure(error: unknown, request?: DeploymentInvocation): DeploymentStatusV1 {
    let record: OwnedDeploymentRecord | undefined;
    try { const value = this.deps.registry.snapshot(); if (value.state === "owned") record = value; }
    catch { /* Corrupt or missing ownership is never replaced or reflected from caller input. */ }
    const attempt = request && record?.attempts.find((entry) => entry.requestId === request.requestId
      && JSON.stringify(entry.control) === JSON.stringify(request.control));
    // Only this invocation's fence can make its result uncertain. An old
    // resource's completed fence never relabels a different refused caller.
    const dispatched = attempt && (attempt.action === "inject" ? attempt.phase !== "admitted"
      : attempt.action === "create" ? !!record?.steps.volume : !!record?.steps.start);
    const reason = dispatched ? "outcome-unknown" : deploymentReason(error);
    return DeploymentStatusV1Schema.parse({ ...(record ? status(record, "unavailable") : { version: 1, state: "unavailable", deploymentReady: false }),
      ...(reason === "outcome-unknown" && record ? { state: "outcome-unknown" } : {}), reason });
  }
}

function recoverResources(record: OwnedDeploymentRecord, inspected: OwnedInspection): void {
  if (record.volume && (!inspected.volume || record.volume.name !== inspected.volume.name
    || record.volume.driver !== inspected.volume.driver
    || Object.keys(record.volume.labels).length !== Object.keys(inspected.volume.labels).length
    || Object.entries(record.volume.labels).some(([key, value]) => inspected.volume?.labels[key] !== value))) {
    throw new DeploymentError("ownership-conflict");
  }
  if (record.containerId && record.containerId !== inspected.container?.id) throw new DeploymentError("ownership-conflict");
  if (inspected.volume) {
    if (!record.steps.volume) throw new DeploymentError("ownership-conflict");
    record.volume = inspected.volume; record.steps.volume = "verified";
  }
  if (inspected.container) {
    if (!record.steps.container || !record.volume) throw new DeploymentError("ownership-conflict");
    record.containerId = inspected.container.id; record.steps.container = "verified";
    if (inspected.container.running && record.steps.start) record.steps.start = "verified";
  }
}
function status(record: OwnedDeploymentRecord, state: DeploymentStatusV1["state"]): DeploymentStatusV1 {
  return { version: 1, state, deploymentId: record.plan.deploymentId, operationId: record.plan.operationId,
    configurationDigest: record.plan.configurationDigest, ...(record.containerId ? { containerId: record.containerId } : {}), deploymentReady: false };
}
function observedStatus(record: OwnedDeploymentRecord, native: NativeBootstrapStatus): DeploymentStatusV1 {
  if (native.configurationDigest !== record.plan.configurationDigest) throw new DeploymentError("ownership-conflict");
  const attempt = record.attempts.find((entry) => entry.action === "inject" && entry.startupId === native.startupId);
  if (native.operationId !== undefined && (!attempt || native.operationId !== record.plan.operationId
    || native.attemptId !== attempt.control.attemptId || native.authorizationId !== attempt.startupAuthorizationId
    || native.deadlineAt !== attempt.startupDeadlineAt)) throw new DeploymentError("ownership-conflict");
  if (native.state === "running" && (!native.operationId || !attempt
    || !["submit-dispatched", "observed"].includes(attempt.phase))) throw new DeploymentError("ownership-conflict");
  return DeploymentStatusV1Schema.parse({ ...status(record, native.state === "waiting-for-credentials" ? "waiting" : native.state),
    startupId: native.startupId, ...(attempt ? { attemptId: attempt.control.attemptId } : {}), ...(native.reason ? { reason: native.reason } : {}) });
}
