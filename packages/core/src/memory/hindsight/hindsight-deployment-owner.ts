/**
 * INPUT:  operator intent, persisted Runs, protected registration and live C1 custody handles
 * OUTPUT: admitted C2 effects, one-use startup permits and bounded original-resource observations
 * POS:    core/memory/hindsight — orchestration only; no Docker/process effects or trusted setup receipts
 */
import { randomUUID } from "node:crypto";
import { TriggerRequestSchema, type Run, type TriggerRequest } from "@taki/shared";
import {
  DeploymentStartParamsSchema, DeploymentStatusV1Schema, NativeStartupPermitV1Schema,
  type CustodyLinkV1, type DeploymentEffectV1, type DeploymentPlanV1, type DeploymentStartParams,
  type DeploymentStatusV1, type HindsightDeploymentRegistrationV1, type InjectionCheckpointV1,
} from "@taki/shared/hindsight-deployment";
import type { RunService } from "../../harness/run-service.ts";
import type { CapabilityRouteRequest, InteractiveOperator, RouteResult } from "../../capabilities/route-capability.ts";
import type { CapabilityAcceptedResult, CapabilityIssuedRequest } from "../../capabilities/capability-observers.ts";
import type { AcceptedCustody, HindsightCustodyOwner } from "./hindsight-custody-owner.ts";

export interface DeploymentRegistrationSnapshot { registration: HindsightDeploymentRegistrationV1; sha256: string }
export interface HindsightDeploymentDeps {
  runs: RunService<InteractiveOperator>; custody: HindsightCustodyOwner;
  registration(): DeploymentRegistrationSnapshot | null;
  route(request: CapabilityRouteRequest, operator?: InteractiveOperator): Promise<RouteResult>;
}
interface LiveDeployment {
  runId: string; attemptId: string; plan: DeploymentPlanV1; registration: DeploymentRegistrationSnapshot;
  evidence: AcceptedCustody; custody: CustodyLinkV1; operator?: InteractiveOperator;
}
const START = "hindsight-deployment:start:v1:";
const STARTUP = "hindsight-deployment:startup:v1:";
const PROVIDER = "hindsight-deployment-v1";
const CONFIG = "hindsight-config:";

export class HindsightDeploymentOwner {
  private readonly deps: HindsightDeploymentDeps;
  private readonly starting = new Map<string, { digest: string; result: Promise<DeploymentStatusV1> }>();
  private active = true;
  constructor(deps: HindsightDeploymentDeps) { this.deps = deps; }

  async start(candidate: DeploymentStartParams, operator?: InteractiveOperator): Promise<DeploymentStatusV1> {
    try {
      const input = DeploymentStartParamsSchema.parse(candidate);
      const request = trigger({ key: `${START}${input.idempotencyKey}`, id: input.idempotencyKey, digest: input.expectedConfigurationDigest });
      const existing = this.deps.runs.findByIdempotency(request.idempotencyKey);
      if (existing) { requireRun(existing, request); return this.observe(existing.runId, operator); }
      const pending = this.starting.get(request.idempotencyKey);
      if (pending) {
        if (pending.digest !== input.expectedConfigurationDigest) throw new Error("DEPLOYMENT_INPUT_CONFLICT");
        await pending.result;
        const original = this.deps.runs.findByIdempotency(request.idempotencyKey);
        if (!original) throw new Error("DEPLOYMENT_RUN_UNAVAILABLE");
        requireRun(original, request);
        return this.observe(original.runId, operator);
      }
      const result = this.initial(request, operator);
      this.starting.set(request.idempotencyKey, { digest: input.expectedConfigurationDigest, result });
      try { return await result; }
      finally { this.starting.delete(request.idempotencyKey); }
    } catch { return unavailable("snapshot-stale"); }
  }

  async observe(deploymentId: string, operator?: InteractiveOperator): Promise<DeploymentStatusV1> {
    try {
      const original = this.original(deploymentId);
      const registration = this.deps.registration();
      if (!this.active || !registration) return unavailable("unsupported-installation");
      const result = await this.deps.route({ capabilityId: "hindsight-deployment-observe",
        input: { version: 1, deploymentId: original.runId }, targetHostId: registration.registration.executionHostId,
        ownerCurrent: () => this.active && operator?.signal?.aborted !== true }, operator);
      if (!result.ok) return routeFailure(result);
      const status = DeploymentStatusV1Schema.parse(result.output);
      if (status.deploymentId !== original.runId || status.configurationDigest !== configDigest(original)) {
        return unavailable("ownership-conflict");
      }
      return status;
    } catch { return unavailable("registry-unavailable"); }
  }

  async resumeStartup(deploymentId: string, operator?: InteractiveOperator): Promise<DeploymentStatusV1> {
    try {
      const original = this.original(deploymentId);
      const status = await this.observe(deploymentId, operator);
      if (["queued", "running", "waiting", "cancel_requested"].includes(original.state)
        || status.state !== "waiting" || !status.startupId || !status.containerId || status.attemptId) return status;
      const request = trigger({ key: `${STARTUP}${deploymentId}:${status.startupId}`, id: status.startupId,
        digest: configDigest(original), parentRunId: deploymentId });
      const existing = this.deps.runs.findByIdempotency(request.idempotencyKey);
      if (existing) { requireRun(existing, request); return this.observe(deploymentId, operator); }
      const admitted = await this.deps.runs.admit(request, operator && { ...operator });
      if (admitted.reused) return this.observe(deploymentId, operator);
      if (!this.deps.runs.start(admitted.run.runId, admitted.attempt.attemptId)) return unavailable("snapshot-stale");
      return await this.runAttempt({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, request,
        deploymentId, operator, startup: { containerId: status.containerId, startupId: status.startupId } });
    } catch { return unavailable("snapshot-stale"); }
  }

  dispose(): void { this.active = false; }

  private async initial(request: TriggerRequest, operator?: InteractiveOperator): Promise<DeploymentStatusV1> {
    if (!this.active) return unavailable("host-unavailable");
    // Snapshot capture enriches its interactive object with Run metadata.
    // Keep that mutation out of C1's independently owned custody attempt.
    const admitted = await this.deps.runs.admit(request, operator && { ...operator });
    if (admitted.reused) return this.observe(admitted.run.runId, operator);
    if (!this.deps.runs.start(admitted.run.runId, admitted.attempt.attemptId)) return unavailable("snapshot-stale");
    return this.runAttempt({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, request,
      deploymentId: admitted.run.runId, operator });
  }

  private async runAttempt(input: {
    runId: string; attemptId: string; request: TriggerRequest; deploymentId: string; operator?: InteractiveOperator;
    startup?: { containerId: string; startupId: string };
  }): Promise<DeploymentStatusV1> {
    let status: DeploymentStatusV1;
    try {
      const live = await this.prepare(input);
      let startup = input.startup;
      if (!startup) {
        const created = await this.dispatch(live, { version: 1, action: "create", plan: live.plan, custody: live.custody });
        if (!created.containerId || created.state === "unavailable" || created.state === "outcome-unknown") return this.settle(input, created);
        const started = await this.dispatch(live, { version: 1, action: "start", plan: live.plan, custody: live.custody, containerId: created.containerId });
        if (started.state !== "waiting" || !started.startupId) return this.settle(input, started);
        startup = { containerId: created.containerId, startupId: started.startupId };
        // Create/start may consume the admission budget. Capture a NEW C1 handle;
        // never refresh an old snapshot or reconstruct one from public fields.
        const refreshed = await this.prepare(input);
        live.evidence = refreshed.evidence; live.custody = refreshed.custody;
      }
      status = await this.dispatch(live, { version: 1, action: "inject", plan: live.plan, custody: live.custody, ...startup });
    } catch (error) { status = unavailable(error instanceof PreparationRefusal ? error.reason : "snapshot-stale"); }
    return this.settle(input, status);
  }

  private async prepare(input: { runId: string; attemptId: string; request: TriggerRequest; deploymentId: string; operator?: InteractiveOperator }): Promise<LiveDeployment> {
    const registration = this.deps.registration();
    if (!this.active || !registration) throw new Error("DEPLOYMENT_UNAVAILABLE");
    const result = await this.deps.custody.prepare(input.operator);
    if (result.status.state === "unavailable") throw new PreparationRefusal(result.status.reason);
    const custody = result.evidence ? this.deps.custody.describeAccepted(result.evidence) : null;
    if (!result.evidence || !custody || `${CONFIG}${custody.input.configurationDigest}` !== input.request.provenance.sourceRef) {
      throw new Error("DEPLOYMENT_CUSTODY_REFUSED");
    }
    const selected = registration.registration;
    const live: LiveDeployment = { runId: input.runId, attemptId: input.attemptId, registration,
      evidence: result.evidence, custody, operator: input.operator, plan: {
        version: 1, deploymentId: input.deploymentId, operationId: input.deploymentId,
        coreHostId: selected.coreHostId, executionHostId: selected.executionHostId, installationId: selected.installationId,
        deploymentRegistrationSha256: registration.sha256, engineId: selected.docker.engineId, imageId: selected.image.id,
        configurationDigest: custody.input.configurationDigest, consumer: "c2a-fake-v1", storage: "new-named-volume",
      } };
    if (!this.current(live)) throw new Error("DEPLOYMENT_OWNER_STALE");
    return live;
  }

  private async dispatch(live: LiveDeployment, input: DeploymentEffectV1): Promise<DeploymentStatusV1> {
    let issued: CapabilityIssuedRequest | undefined;
    let accepted: CapabilityAcceptedResult | undefined;
    const result = await this.deps.route({ capabilityId: "hindsight-deployment", input,
      targetHostId: live.plan.executionHostId, runId: live.runId, attemptId: live.attemptId,
      operationId: live.plan.operationId, effectId: randomUUID(), ownerCurrent: () => this.current(live),
      observers: {
        onIssued: (value) => { if (issued) throw new Error("DEPLOYMENT_ISSUED_TWICE"); issued = value; },
        onAccepted: (value) => { accepted = value; },
        ...(input.action === "inject" ? { beforeHindsightInjection: (checkpoint: InjectionCheckpointV1) => {
          if (!issued || checkpoint.requestId !== issued.requestId || !this.current(live)) throw new Error("DEPLOYMENT_CHECKPOINT_STALE");
          const deadline = Math.min(Date.parse(live.custody.deadlineAt), Date.parse(issued.control.deadlineAt), Date.now() + 90_000,
            issued.control.expiresAt ? Date.parse(issued.control.expiresAt) : Infinity);
          return NativeStartupPermitV1Schema.parse({ version: 1, checkpointId: checkpoint.checkpointId, binding: {
            startupId: input.startupId, configurationDigest: live.plan.configurationDigest, operationId: live.plan.operationId,
            attemptId: issued.control.attemptId, authorizationId: randomUUID(), deadlineAt: new Date(deadline).toISOString(),
          }, selection: live.custody.input.selection.map(({ slot, source }) => ({ slot, source })) });
        } } : {}),
      } }, live.operator);
    if (!result.ok) return routeFailure(result);
    if (!issued || !accepted || accepted.requestId !== issued.requestId || !this.current(live)) return unavailable("outcome-unknown");
    const status = DeploymentStatusV1Schema.parse(accepted.outcome.output);
    if (status.state !== "unavailable" && (status.deploymentId !== live.plan.deploymentId
      || status.configurationDigest !== live.plan.configurationDigest)) return unavailable("ownership-conflict");
    return status;
  }

  private current(live: LiveDeployment): boolean {
    try {
      const run = this.deps.runs.status(live.runId).run;
      return this.active && live.operator?.signal?.aborted !== true && run.state === "running"
        && run.activeAttemptId === live.attemptId && this.deps.custody.validate(live.evidence)
        && JSON.stringify(this.deps.registration()) === JSON.stringify(live.registration);
    } catch { return false; }
  }
  private original(deploymentId: string): Run {
    const run = this.deps.runs.status(deploymentId).run;
    requireRun(run, trigger({ key: `${START}${run.triggerRequestId}`, id: run.triggerRequestId, digest: configDigest(run) }));
    return run;
  }
  private settle(input: { runId: string; attemptId: string; deploymentId: string; request: TriggerRequest }, status: DeploymentStatusV1): DeploymentStatusV1 {
    const outcome = status.state === "outcome-unknown" || status.reason === "outcome-unknown" ? "outcome_unknown" : status.state === "unavailable" ? "failed" : "completed";
    const original = { deploymentId: input.deploymentId, operationId: input.deploymentId,
      configurationDigest: input.request.provenance.sourceRef?.slice(CONFIG.length) };
    try {
      const settled = this.deps.runs.settle(input.runId, input.attemptId, outcome, { retryable: false, summary: "Hindsight deployment attempt settled" });
      const attempt = settled.attempts.find((entry) => entry.attemptId === input.attemptId);
      if (settled.run.runId === input.runId && settled.run.activeAttemptId === input.attemptId
        && settled.run.outcome === outcome && attempt?.outcome === outcome) {
        return { ...status, ...original, ...(outcome === "outcome_unknown" ? { state: "outcome-unknown" } : {}) };
      }
    } catch { /* A throw or unaccepted terminal transition cannot publish successful deployment evidence. */ }
    return { ...unavailable("outcome-unknown"), ...original, state: "outcome-unknown" };
  }
}

class PreparationRefusal extends Error {
  readonly reason: NonNullable<DeploymentStatusV1["reason"]>;
  constructor(reason: NonNullable<DeploymentStatusV1["reason"]>) { super("Deployment custody unavailable"); this.reason = reason; }
}

function trigger(input: { key: string; id: string; digest: string; parentRunId?: string }): TriggerRequest {
  return TriggerRequestSchema.parse({ triggerRequestId: input.id, idempotencyKey: input.key, characterId: "taki", initiator: "primary",
    deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: PROVIDER, triggerRequestId: input.id,
      sourceRef: `${CONFIG}${input.digest}`, ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}) } });
}
function requireRun(run: Run, request: TriggerRequest): void {
  if (run.idempotencyKey !== request.idempotencyKey || run.triggerRequestId !== request.triggerRequestId
    || run.characterId !== "taki" || run.initiator !== "primary" || run.deliveryClass !== "internal"
    || JSON.stringify(run.provenance) !== JSON.stringify(request.provenance)) throw new Error("DEPLOYMENT_INPUT_CONFLICT");
}
function configDigest(run: Run): string {
  const value = run.provenance.sourceRef;
  if (!value || !/^hindsight-config:[0-9a-f]{64}$/.test(value)) throw new Error("DEPLOYMENT_INPUT_CONFLICT");
  return value.slice(CONFIG.length);
}
function unavailable(reason: NonNullable<DeploymentStatusV1["reason"]>): DeploymentStatusV1 {
  return { version: 1, state: "unavailable", reason, deploymentReady: false };
}
function routeFailure(result: Extract<RouteResult, { ok: false }>): DeploymentStatusV1 {
  const reason = result.code === "APPROVAL_REQUIRED" ? "approval-required" : result.code === "DENIED" ? "denied"
    : result.code === "OUTCOME_UNKNOWN" || result.code === "CAPABILITY_TIMEOUT" ? "outcome-unknown" : "host-unavailable";
  return unavailable(reason);
}
