/**
 * INPUT:  the exact pending C2 effect and a provenance-checked Host terminal outcome
 * OUTPUT: semantic Effect success/refusal/unknown, without confusing transport completion with deployment success
 * POS:    core/capabilities — C2-only final binding check before durable Effect settlement
 */
import { DeploymentEffectV1Schema, DeploymentStatusV1Schema } from "@taki/shared/hindsight-deployment";
import type { CapabilityOutcome } from "./capability-broker.ts";
import type { PendingCapability } from "./capability-broker-state.ts";

export function deploymentOutcome(pending: PendingCapability, outcome: CapabilityOutcome): CapabilityOutcome {
  if (!outcome.ok || pending.control.capabilityId !== "hindsight-deployment") return outcome;
  const status = DeploymentStatusV1Schema.safeParse(outcome.output);
  const input = DeploymentEffectV1Schema.safeParse(pending.input);
  if (!status.success || !input.success) return deploymentUnknown();
  const value = status.data;
  const effect = input.data;
  if (value.state === "outcome-unknown" || value.reason === "outcome-unknown") return deploymentUnknown();
  if (value.state === "unavailable") {
    if (value.reason === "snapshot-stale" && pending.targetDispatched) return deploymentUnknown();
    const code = value.reason === "approval-required" ? "APPROVAL_REQUIRED" : value.reason === "denied" ? "DENIED" : "EXEC_FAILED";
    return { ok: false, code, message: "Hindsight deployment was refused" };
  }
  if (value.deploymentId !== effect.plan.deploymentId || value.configurationDigest !== effect.plan.configurationDigest
    || (effect.action !== "create" && value.containerId !== effect.containerId)
    || (effect.action === "inject" && (value.startupId !== effect.startupId || value.attemptId !== pending.control.attemptId))) {
    return deploymentUnknown();
  }
  return outcome;
}

export function deploymentUnknown(): CapabilityOutcome {
  return { ok: false, code: "OUTCOME_UNKNOWN", state: "outcome_unknown", message: "Hindsight deployment requires original-resource observation" };
}

export function isDispatchedDeployment(pending: PendingCapability): boolean {
  return pending.control.capabilityId === "hindsight-deployment" && pending.targetDispatched === true;
}
