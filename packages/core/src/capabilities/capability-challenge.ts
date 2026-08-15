/**
 * INPUT:  Host capability.challenge frames, the broker's sealed pending attempts, and the Approval interaction
 * OUTPUT: challenge provenance/digest validation, operator bridging, single-use resume authorization minting
 * POS:    core/capabilities — the ONE Host ask bridge; never a second dialog, never raw input beyond the pending record
 */
import { createHash, randomUUID } from "node:crypto";
import {
  APPROVAL_BINDING_REVISION,
  CANONICAL_GOVERNANCE_REGISTRY,
  HOST_CONTROL_METHODS,
  canonicalCapabilityChallenge,
  canonicalHostOperationControl,
  governanceDescriptor,
  type ApprovalDecisionBinding,
  type ApprovalDecisionScope,
  type CapabilityChallenge,
  type CapabilityRespondResult,
  type HostFrameRejectReason,
  type HostGovernanceEvidence,
  type HostOperationControl,
} from "@taki/shared";
import { approvalDecisionScopeDigest, validateCurrentApprovalDecisionBinding } from "../approval/approval-binding.ts";
import type { ApprovalInteractionDecision } from "../approval/approval-interaction-service.ts";
import { notifyHostCancel } from "./capability-broker-state.ts";
import {
  TIMEOUT_MESSAGE,
  interruptedOutcome,
  settlePending,
  type CapabilityBrokerState,
  type PendingCapability,
} from "./capability-broker-state.ts";
import { sameControl } from "./capability-response.ts";
import type { CapabilityOutcome } from "./capability-broker.ts";

const UNATTENDED_MESSAGE = "approval requires an active operator connection";
const DENIED_MESSAGE = "approval was not granted";

/** Validates one Host challenge against the sealed attempt and bridges it to the owning operator connection. */
export function acceptCapabilityChallenge(
  state: CapabilityBrokerState,
  params: CapabilityChallenge,
  provenance: { hostId: string; connectionGeneration: number },
): CapabilityRespondResult {
  const pending = state.pending.get(params.requestId);
  if (!pending) return reject("unknown_request");
  if (provenance.hostId !== pending.control.targetHostId) return reject("wrong_host");
  if (provenance.connectionGeneration !== pending.control.connectionGeneration) return reject("stale_generation");
  if (pending.challenge || pending.authorization) return reject("duplicate");
  const failure = challengeFrameFailure(pending, params);
  if (failure || !pending.target.isCurrent()
    || state.approval.approvalGeneration() !== pending.control.approvalGeneration) {
    retireForInvalidChallenge(state, params.requestId);
    return reject(failure ?? "stale_generation");
  }
  const binding = challengeBinding(pending, params.governance);
  if (!binding || binding.decisionScopeDigest !== params.decisionScopeDigest) {
    retireForInvalidChallenge(state, params.requestId);
    return reject("stale_generation");
  }
  return bridgeToOperator({ state, requestId: params.requestId, params, binding });
}

/** Generation listener: retire stale-lineage pendings; keep only the minted G+1 atomic exception. */
export function retireChallengesForGeneration(state: CapabilityBrokerState, generation: number): void {
  for (const [requestId, pending] of [...state.pending]) {
    if (pending.authorization?.value.approvalGeneration === generation) continue;
    // Cancel resolves an unanswered prompt through its own decision microtask; an already-answered
    // one (the session/always atomic exception) keeps its challenge record and mints at the new generation.
    pending.challenge?.handle?.cancel();
    if (!pending.challenge) settleInvalidated(state, requestId, "approval generation changed");
  }
}

/** Policy listener: retire pendings sealed under a superseded dispatch policy. */
export function retireChallengesForPolicy(state: CapabilityBrokerState, policyGeneration: number): void {
  for (const [requestId, pending] of [...state.pending]) {
    if (pending.control.policyGeneration === policyGeneration) continue;
    pending.challenge?.handle?.cancel();
    if (!pending.challenge) settleInvalidated(state, requestId, "governance policy changed");
  }
}

function bridgeToOperator(args: {
  state: CapabilityBrokerState;
  requestId: string;
  params: CapabilityChallenge;
  binding: ApprovalDecisionBinding;
}): CapabilityRespondResult {
  const { state, requestId, params, binding } = args;
  const pending = state.pending.get(requestId);
  if (!pending) return reject("unknown_request");
  const operator = pending.target.operator;
  if (!operator?.connection.notify) {
    settlePending(state, requestId, {
      outcome: { ok: false, code: "APPROVAL_REQUIRED", message: UNATTENDED_MESSAGE },
      terminalReason: "late",
    });
    notifyHostCancel(pending, requestId, "approval_denied");
    return { accepted: true };
  }
  const remainingMs = Math.max(1, Date.parse(pending.control.deadlineAt) - state.now());
  const handle = state.approval.request({
    owner: operator.connection,
    policyGeneration: pending.control.policyGeneration,
    binding,
    presentation: params.presentation,
    timeoutMs: remainingMs,
  });
  pending.challenge = { value: params, binding, handle };
  const onAbort = (): void => void handle.cancel();
  operator.signal?.addEventListener("abort", onAbort, { once: true });
  pending.abortListener = () => operator.signal?.removeEventListener("abort", onAbort);
  void handle.result.then(
    (decision) => settleChallengeDecision(state, requestId, decision),
    () => settleChallengeDecision(state, requestId, invalidatedDecision(state)),
  );
  return { accepted: true };
}

function settleChallengeDecision(
  state: CapabilityBrokerState,
  requestId: string,
  decision: ApprovalInteractionDecision,
): void {
  const pending = state.pending.get(requestId);
  if (!pending?.challenge) return; // settled elsewhere; nothing left to resume or deny here
  if (decision.allowed) return resumeAuthorized(state, requestId, decision);
  settlePending(state, requestId, { outcome: decisionOutcome(pending, decision.reason), terminalReason: "late" });
  notifyHostCancel(pending, requestId, decision.reason === "denied" ? "approval_denied" : "approval_invalidated");
}

function resumeAuthorized(
  state: CapabilityBrokerState,
  requestId: string,
  decision: Extract<ApprovalInteractionDecision, { allowed: true }>,
): void {
  const pending = state.pending.get(requestId);
  if (!pending?.challenge) return;
  // Revalidate before dispatch: route currency and the exact post-decision approval lineage.
  if (!pending.target.isCurrent() || state.approval.approvalGeneration() !== decision.approvalGeneration) {
    settlePending(state, requestId, {
      outcome: { ok: false, code: "CANCELLED", message: "approval authorization was invalidated", state: "cancelled" },
      terminalReason: "late",
    });
    notifyHostCancel(pending, requestId, "approval_invalidated");
    return;
  }
  const { value: challenge, binding } = pending.challenge;
  const authorization = {
    authorizationId: randomUUID(),
    approvalGeneration: decision.approvalGeneration,
    decisionScope: decision.scope,
    controlDigest: challenge.controlDigest,
    challengeDigest: challenge.challengeDigest,
    decisionScopeDigest: binding.decisionScopeDigest,
    issuedAt: new Date(state.now()).toISOString(),
    expiresAt: pending.control.deadlineAt,
  };
  pending.authorization = { value: authorization };
  pending.challenge = undefined;
  pending.abortListener?.();
  pending.abortListener = undefined;
  try {
    pending.target.notify(HOST_CONTROL_METHODS.resume, {
      requestId,
      control: pending.control,
      challengeId: challenge.challengeId,
      authorization,
    });
  } catch {
    settlePending(state, requestId, {
      outcome: interruptedOutcome(pending.execution, "Host resume delivery failed"),
      terminalReason: "late",
    });
    return;
  }
  state.log.info({ requestId, scope: decision.scope }, "capability resume authorized");
}

function challengeFrameFailure(pending: PendingCapability, params: CapabilityChallenge): HostFrameRejectReason | undefined {
  if (!sameControl(params.control, pending.control)) return "stale_generation";
  const controlDigest = createHash("sha256").update(canonicalHostOperationControl(pending.control), "utf8").digest("hex");
  if (params.controlDigest !== controlDigest) return "stale_generation";
  const challengeDigest = createHash("sha256").update(canonicalCapabilityChallenge(params), "utf8").digest("hex");
  if (params.challengeDigest !== challengeDigest) return "stale_generation";
  return challengeEvidenceFailure(pending.control.governanceProjection, params.governance);
}

function challengeEvidenceFailure(
  projection: HostOperationControl["governanceProjection"],
  evidence: HostGovernanceEvidence,
): HostFrameRejectReason | undefined {
  if (evidence.descriptorRevision !== projection.descriptorRevision
    || evidence.classifierRevision !== projection.classifierRevision) return "stale_generation";
  const projected = projection.cells.find((cell) => cell.key === evidence.cellKey)?.posture;
  if (!projected || rank(evidence.effectivePosture) < rank(projected) || evidence.effectivePosture !== "ask") {
    return "stale_generation";
  }
  if (evidence.constraint === "none" && evidence.effectivePosture !== projected) return "stale_generation";
  return undefined;
}

function rank(posture: "auto" | "ask" | "deny"): number {
  return { auto: 0, ask: 1, deny: 2 }[posture];
}

function challengeBinding(pending: PendingCapability, evidence: HostGovernanceEvidence): ApprovalDecisionBinding | undefined {
  const descriptor = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, pending.control.capabilityId);
  if (!descriptor) return undefined;
  const scope: ApprovalDecisionScope = {
    bindingRevision: APPROVAL_BINDING_REVISION,
    identity: { capabilityId: pending.control.capabilityId, ownerHostId: pending.target.hostId },
    descriptorRevision: descriptor.descriptorRevision,
    classifierId: descriptor.classifier.classifierId,
    classifierRevision: descriptor.classifier.classifierRevision,
    cellKey: evidence.cellKey,
  };
  try {
    return validateCurrentApprovalDecisionBinding(CANONICAL_GOVERNANCE_REGISTRY, {
      ...scope,
      decisionScopeDigest: approvalDecisionScopeDigest(scope),
    });
  } catch {
    return undefined;
  }
}

function decisionOutcome(pending: PendingCapability, reason: string): CapabilityOutcome {
  if (reason === "denied") return { ok: false, code: "DENIED", message: DENIED_MESSAGE };
  if (reason === "expired") {
    // The Host deadline bounds the whole attempt; an effect-kind expiry keeps the conservative unknown outcome.
    return pending.execution === "effect"
      ? { ok: false, code: "OUTCOME_UNKNOWN", message: TIMEOUT_MESSAGE, state: "outcome_unknown" }
      : { ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE };
  }
  if (reason === "operator_unavailable" || reason === "notification_failed") {
    return { ok: false, code: "APPROVAL_REQUIRED", message: UNATTENDED_MESSAGE };
  }
  return { ok: false, code: "CANCELLED", message: `approval request ${reason.replaceAll("_", " ")}`, state: "cancelled" };
}

function settleInvalidated(state: CapabilityBrokerState, requestId: string, message: string): void {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  settlePending(state, requestId, { outcome: interruptedOutcome(pending.execution, message), terminalReason: "late" });
  notifyHostCancel(pending, requestId, "approval_invalidated");
}

function retireForInvalidChallenge(state: CapabilityBrokerState, requestId: string): void {
  settleInvalidated(state, requestId, "Host capability challenge was rejected");
}

function invalidatedDecision(state: CapabilityBrokerState): ApprovalInteractionDecision {
  return { allowed: false, reason: "invalidated", approvalGeneration: state.approval.approvalGeneration() };
}

function reject(reason: HostFrameRejectReason): CapabilityRespondResult {
  return { accepted: false, reason };
}
