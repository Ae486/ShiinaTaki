/**
 * INPUT:  one sealed Host pending record plus optional Core Effect lifecycle authority
 * OUTPUT: preflight-to-wait/intent transitions and exact terminal settlement for the same Core Effect
 * POS:    core/capabilities — Host Effect coordinator; preflight alone never creates target intent
 */
import type { ApprovalDecisionBinding } from "@taki/shared";
import type { CapabilityBrokerState, PendingCapability } from "./capability-broker-state.ts";
import type { CapabilityOutcome } from "./capability-broker.ts";

export function prepareHostIntent(state: CapabilityBrokerState, pending: PendingCapability): boolean {
  if (!state.effects || !pending.control.coreAttemptId || !pending.control.effectId) return true;
  try {
    const effect = state.effects.prepare(effectInput(pending));
    pending.effect = { id: effect.effectId, version: effect.version, state: "intent_committed" };
    return true;
  } catch {
    return false;
  }
}

export function prepareHostWaiting(input: {
  state: CapabilityBrokerState;
  pending: PendingCapability;
  approvalId: string;
  binding: ApprovalDecisionBinding;
}): boolean {
  const { state, pending, approvalId, binding } = input;
  if (!state.effects?.prepareWaiting || !pending.control.coreAttemptId || !pending.control.effectId) return true;
  try {
    const effect = state.effects.prepareWaiting({
      ...effectInput(pending),
      approvalRef: {
        approvalId,
        policyGeneration: pending.control.policyGeneration,
        approvalGeneration: pending.control.approvalGeneration,
        bindingDigest: binding.decisionScopeDigest,
        expiresAt: pending.control.deadlineAt,
      },
    });
    pending.effect = { id: effect.effectId, version: effect.version, state: "waiting" };
    return true;
  } catch {
    return false;
  }
}

export function commitHostIntent(state: CapabilityBrokerState, pending: PendingCapability): boolean {
  if (!pending.effect || pending.effect.state === "intent_committed") return true;
  if (!state.effects?.commitIntent || !pending.control.coreAttemptId) return false;
  const committed = state.effects.commitIntent({
    effectId: pending.effect.id,
    runId: pending.control.runId,
    attemptId: pending.control.coreAttemptId,
    expectedVersion: pending.effect.version,
  });
  if (committed.stale || committed.effect.state !== "intent_committed") return false;
  pending.effect = { id: committed.effect.effectId, version: committed.effect.version, state: "intent_committed" };
  return true;
}

export function settleHostEffect(state: CapabilityBrokerState, pending: PendingCapability, outcome: CapabilityOutcome): boolean {
  if (!pending.effect || !state.effects || !pending.control.coreAttemptId) return true;
  const terminal = effectOutcome(outcome);
  const input = {
    effectId: pending.effect.id,
    runId: pending.control.runId,
    attemptId: pending.control.coreAttemptId,
    expectedVersion: pending.effect.version,
    outcome: terminal.outcome,
    errorCode: terminal.errorCode,
  };
  try {
    const settled = pending.effect.state === "waiting" && state.effects.settleWaiting
      ? state.effects.settleWaiting({ ...input, outcome: waitingOutcome(terminal.outcome) })
      : state.effects.settle(input);
    return !settled.stale;
  } catch {
    return false;
  }
}

function effectInput(pending: PendingCapability) {
  return {
    effectId: pending.control.effectId,
    runId: pending.control.runId,
    attemptId: pending.control.coreAttemptId!,
    kind: "tool" as const,
    sourceRef: { type: "host" as const, operationId: pending.control.operationId },
    executorRef: { type: "host" as const, hostId: pending.control.targetHostId, connectionGeneration: pending.control.connectionGeneration },
    inputDigest: pending.control.inputDigest,
    replayPosture: pending.execution === "read" ? "safe" as const : "never" as const,
    capturedGenerationRef: String(pending.control.connectionGeneration),
    idempotencyKey: pending.control.idempotencyKey,
  };
}

function effectOutcome(outcome: CapabilityOutcome) {
  if (outcome.ok) return { outcome: "completed" as const, errorCode: undefined };
  const state: "outcome_unknown" | "cancelled" | "deadline_exceeded" | "failed" = outcome.code === "OUTCOME_UNKNOWN" ? "outcome_unknown"
    : outcome.code === "CANCELLED" ? "cancelled"
      : outcome.code === "CAPABILITY_TIMEOUT" ? "deadline_exceeded" : "failed";
  return { outcome: state, errorCode: outcome.code.toLowerCase() };
}

function waitingOutcome(outcome: "completed" | "failed" | "cancelled" | "deadline_exceeded" | "outcome_unknown") {
  return outcome === "outcome_unknown" ? "failed" as const : outcome;
}
