/**
 * INPUT:  one authenticated Node checkpoint and the actual live dispatched C2 pending
 * OUTPUT: at most one owner-created Native permit after committed Effect/current-lineage checks
 * POS:    core/capabilities — C2-local checkpoint; no ticket registry, replay or serialized callback
 */
import { DeploymentEffectV1Schema, InjectionCheckpointV1Schema, NativeStartupPermitV1Schema,
  type InjectionCheckpointV1, type InjectionCheckpointResult } from "@taki/shared/hindsight-deployment";
import type { CapabilityBrokerState, PendingCapability } from "./capability-broker-state.ts";
import { sameControl } from "./capability-response.ts";

export function authorizeHindsightInjection(state: CapabilityBrokerState, candidate: InjectionCheckpointV1,
  provenance: { hostId: string; connectionGeneration: number }): InjectionCheckpointResult {
  try {
    const input = InjectionCheckpointV1Schema.parse(candidate);
    const pending = state.pending.get(input.requestId);
    if (!pending || pending.hindsightCheckpointConsumed || !pending.targetDispatched
      || !pending.observers?.beforeHindsightInjection || !pending.target.ownerCurrent
      || pending.control.capabilityId !== "hindsight-deployment"
      || provenance.hostId !== pending.control.targetHostId || provenance.connectionGeneration !== pending.control.connectionGeneration
      || !sameControl(input.control, pending.control) || !current(state, pending, input)) throw new Error("checkpoint refused");
    const effect = DeploymentEffectV1Schema.parse(pending.input);
    if (effect.action !== "inject" || effect.plan.deploymentId !== input.deploymentId || effect.containerId !== input.containerId
      || effect.startupId !== input.startupId || effect.plan.configurationDigest !== input.configurationDigest
      || effect.custody.input.snapshotId !== input.custodySnapshotId) throw new Error("checkpoint mismatch");
    // Consumption is synchronous and precedes even a refused owner callback.
    // A lost response or Catalog ABA cannot mint another permit for this pending.
    pending.hindsightCheckpointConsumed = true;
    return { state: "granted", permit: NativeStartupPermitV1Schema.parse(pending.observers.beforeHindsightInjection(input)) };
  } catch { return { state: "unavailable", reason: "snapshot-stale" }; }
}

function current(state: CapabilityBrokerState, pending: PendingCapability, input: InjectionCheckpointV1): boolean {
  const authorization = pending.authorization?.value;
  const expected = authorization ? { authorizationId: authorization.authorizationId,
    approvalGeneration: authorization.approvalGeneration, challengeDigest: authorization.challengeDigest } : undefined;
  const control = pending.control;
  const effect = control.effectId ? state.effects?.get(control.effectId) : undefined;
  return JSON.stringify(expected) === JSON.stringify(input.authorization)
    && state.approval.approvalGeneration() === (authorization?.approvalGeneration ?? control.approvalGeneration)
    && state.now() < Date.parse(control.deadlineAt)
    && (control.expiresAt === undefined || state.now() < Date.parse(control.expiresAt))
    && pending.target.isCurrent() && pending.target.ownerCurrent?.() === true && pending.target.operator?.signal?.aborted !== true
    && pending.effect?.state === "intent_committed" && effect?.state === "intent_committed"
    && effect.version === pending.effect.version && effect.effectId === pending.effect.id
    && effect.runId === control.runId && effect.attemptId === control.coreAttemptId
    && effect.inputDigest === control.inputDigest && effect.replayPosture === "never"
    && effect.sourceRef.type === "host" && effect.sourceRef.operationId === control.operationId
    && effect.executorRef?.type === "host" && effect.executorRef.hostId === control.targetHostId
    && effect.executorRef.connectionGeneration === control.connectionGeneration;
}
