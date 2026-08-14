/**
 * INPUT:  transient Approval state operations, exact Connection provenance, and the durable decision authority
 * OUTPUT: request/respond/revoke/invalidate/disconnect transitions for ApprovalInteractionService
 * POS:    core/approval — internal state machine; owns pending/session maps and targeted lifecycle notifications
 */
import { randomUUID } from "node:crypto";
import {
  APPROVAL_DISCLOSURE_REVISION,
  APPROVAL_METHODS,
  ApprovalClosedSchema,
  CANONICAL_GOVERNANCE_REGISTRY,
  CanonicalApprovalRequestSchema,
  type ApprovalClosedReason,
  type ApprovalDecisionBinding,
  type ApprovalRevokeResult,
  type CanonicalApprovalRespondParams,
  type CanonicalApprovalRespondResult,
} from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { validateCurrentApprovalDecisionBinding } from "./approval-binding.ts";
import type { ApprovalDecisionService } from "./approval-decision-service.ts";
import type {
  ApprovalInteractionDecision,
  ApprovalInteractionRequest,
  ApprovalRequestHandle,
} from "./approval-interaction-service.ts";
import {
  approvalResponse,
  deniedDecision,
  resolvedAuthority,
  resolvedFailure,
} from "./approval-interaction-outcomes.ts";
import { ApprovalGenerationConflictError } from "./approval-state-repo.ts";
import {
  allowedApprovalChoices,
  hasUsableDurableAuthority,
  sameApprovalBinding,
} from "./approval-interaction-binding.ts";
import {
  connectionIds,
  connectionSessions,
  type ApprovalInteractionState,
  type PendingApproval,
} from "./approval-interaction-store.ts";
export { createApprovalInteractionState, type ApprovalInteractionState } from "./approval-interaction-store.ts";

interface StateAuthority {
  state: ApprovalInteractionState;
  authority: ApprovalDecisionService;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export function requestInteraction(args: StateAuthority & { input: ApprovalInteractionRequest }): ApprovalRequestHandle {
  const { state, authority, input } = args;
  const generation = authority.snapshot().approvalGeneration;
  const binding = validateCurrentApprovalDecisionBinding(CANONICAL_GOVERNANCE_REGISTRY, input.binding);
  const session = state.sessions.get(input.owner)?.get(binding.decisionScopeDigest);
  if (session && session.processEpoch === authority.processEpoch
    && session.approvalGeneration === generation
    && session.policyGeneration === input.policyGeneration
    && sameApprovalBinding(session.binding, binding)) {
    return resolvedAuthority("session", generation);
  }
  if (hasUsableDurableAuthority(authority, binding)) {
    return resolvedAuthority("always", generation);
  }
  if (typeof input.owner.notify !== "function") return resolvedFailure("operator_unavailable", generation);
  return createPending(args, binding, generation);
}

function createPending(
  args: StateAuthority & { input: ApprovalInteractionRequest },
  binding: ApprovalDecisionBinding,
  generation: number,
): ApprovalRequestHandle {
  const { state, input } = args;
  const notify = input.owner.notify;
  if (!notify) return resolvedFailure("operator_unavailable", generation);
  const approvalId = randomUUID();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowedChoices = allowedApprovalChoices(binding);
  const request = CanonicalApprovalRequestSchema.parse({
    approvalId,
    expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    policyGeneration: input.policyGeneration,
    approvalGeneration: generation,
    binding,
    disclosureRevision: allowedChoices.includes("allow_always") ? APPROVAL_DISCLOSURE_REVISION : undefined,
    allowedChoices,
    presentation: input.presentation,
  });
  let settle!: (decision: ApprovalInteractionDecision) => void;
  const result = new Promise<ApprovalInteractionDecision>((resolve) => (settle = resolve));
  const pending: PendingApproval = {
    approvalId, owner: input.owner, binding, allowedChoices: new Set(allowedChoices),
    approvalGeneration: generation, policyGeneration: input.policyGeneration, resolve: settle,
    timer: setTimeout(() => finish({ state, pending, reason: "expired", generation }), timeoutMs),
  };
  state.pending.set(approvalId, pending);
  connectionIds(state, input.owner).add(approvalId);
  try {
    notify(APPROVAL_METHODS.request, request);
  } catch {
    finish({
      state, pending, reason: "cancelled", generation, notify: false,
      decision: { allowed: false, reason: "notification_failed", approvalGeneration: generation },
    });
  }
  return { approvalId, result, cancel: () => cancel(state, approvalId) };
}

export function respondInteraction(
  args: StateAuthority & { connection: Connection; params: CanonicalApprovalRespondParams },
): CanonicalApprovalRespondResult {
  const { state, authority, connection, params } = args;
  const current = authority.snapshot().approvalGeneration;
  const pending = state.pending.get(params.approvalId);
  if (!pending) return approvalResponse("late", current);
  if (pending.owner !== connection) return approvalResponse("wrong_session", current);
  if (params.expectedApprovalGeneration !== current || pending.approvalGeneration !== current) {
    return approvalResponse("stale_generation", current);
  }
  if (!pending.allowedChoices.has(params.choice)) return approvalResponse("scope_not_allowed", current);
  if (params.choice === "deny") {
    finish({ state, pending, reason: "denied", generation: current });
    return approvalResponse("accepted", current);
  }
  if (params.choice === "allow_once") {
    finish({
      state, pending, reason: "answered", generation: current,
      decision: { allowed: true, scope: "once", approvalGeneration: current },
    });
    return approvalResponse("accepted", current);
  }
  return rememberResponse(args, pending, current);
}

function rememberResponse(
  args: StateAuthority & { params: CanonicalApprovalRespondParams },
  pending: PendingApproval,
  current: number,
): CanonicalApprovalRespondResult {
  try {
    return args.params.choice === "allow_always"
      ? allowAlways(args, pending, current)
      : allowSession(args, pending, current);
  } catch (error) {
    if (!(error instanceof ApprovalGenerationConflictError)) throw error;
    finish({
      state: args.state, pending, reason: "approval_generation_changed",
      generation: error.currentApprovalGeneration,
    });
    return approvalResponse("stale_generation", error.currentApprovalGeneration);
  }
}

function allowAlways(
  args: StateAuthority & { params: CanonicalApprovalRespondParams },
  pending: PendingApproval,
  current: number,
): CanonicalApprovalRespondResult {
  const disclosure = args.params.disclosure;
  if (disclosure?.revision !== APPROVAL_DISCLOSURE_REVISION || !disclosure.futureBackgroundUseAccepted) {
    return approvalResponse("disclosure_required", current);
  }
  const snapshot = args.authority.grantAlways({
    binding: { ...pending.binding, disclosureRevision: disclosure.revision },
    expectedApprovalGeneration: current,
  });
  const generation = snapshot.approvalGeneration;
  if (generation !== current) invalidateOtherPending(args.state, pending.approvalId, generation);
  finish({
    state: args.state, pending, reason: "answered", generation,
    decision: { allowed: true, scope: "always", approvalGeneration: generation },
  });
  return approvalResponse("accepted", generation);
}

function allowSession(args: StateAuthority, pending: PendingApproval, current: number): CanonicalApprovalRespondResult {
  const key = pending.binding.decisionScopeDigest;
  const material = !args.state.sessions.get(pending.owner)?.has(key);
  const generation = material ? args.authority.advanceGeneration(current).approvalGeneration : current;
  const sessions = connectionSessions(args.state, pending.owner);
  sessions.set(key, {
    binding: pending.binding,
    processEpoch: args.authority.processEpoch,
    approvalGeneration: generation,
    policyGeneration: pending.policyGeneration,
  });
  if (material) invalidateOtherPending(args.state, pending.approvalId, generation);
  finish({
    state: args.state, pending, reason: "answered", generation,
    decision: { allowed: true, scope: "session", approvalGeneration: generation },
  });
  return approvalResponse("accepted", generation);
}

export function disconnectConnection(args: StateAuthority & { connection: Connection }): void {
  const { state, authority, connection } = args;
  const sessions = state.sessions.get(connection);
  let generation = authority.snapshot().approvalGeneration;
  if (sessions && sessions.size > 0) {
    state.sessions.delete(connection);
    try {
      generation = authority.advanceGeneration(generation).approvalGeneration;
      invalidateExceptConnection(state, connection, generation);
    } catch (error) {
      if (!(error instanceof ApprovalGenerationConflictError)) throw error;
      generation = error.currentApprovalGeneration;
      invalidateOtherPending(state, "", generation);
    }
  }
  for (const id of [...(state.byConnection.get(connection) ?? [])]) {
    const pending = state.pending.get(id);
    if (pending) finish({ state, pending, reason: "operator_disconnected", generation });
  }
}

export function revokeDurableDecision(
  args: StateAuthority & { decisionId: string; expectedApprovalGeneration: number },
): ApprovalRevokeResult {
  const result = args.authority.revoke(args.decisionId, args.expectedApprovalGeneration);
  if (result.snapshot.approvalGeneration !== args.expectedApprovalGeneration) {
    invalidateOtherPending(args.state, "", result.snapshot.approvalGeneration);
  }
  return {
    status: result.revoked ? "revoked" : "not_found",
    approvalGeneration: result.snapshot.approvalGeneration,
  };
}

export function invalidatePolicyGeneration(args: StateAuthority & { policyGeneration: number }): void {
  let generation = args.authority.snapshot().approvalGeneration;
  let removedSession = false;
  for (const [connection, sessions] of args.state.sessions) {
    for (const [digest, session] of sessions) {
      if (session.policyGeneration !== args.policyGeneration) {
        sessions.delete(digest);
        removedSession = true;
      }
    }
    if (sessions.size === 0) args.state.sessions.delete(connection);
  }
  if (removedSession) {
    try {
      generation = args.authority.advanceGeneration(generation).approvalGeneration;
    } catch (error) {
      if (!(error instanceof ApprovalGenerationConflictError)) throw error;
      generation = error.currentApprovalGeneration;
    }
  }
  for (const pending of [...args.state.pending.values()]) {
    if (pending.policyGeneration !== args.policyGeneration) {
      finish({ state: args.state, pending, reason: "policy_changed", generation });
    }
  }
}

interface FinishArgs {
  state: ApprovalInteractionState;
  pending: PendingApproval;
  reason: ApprovalClosedReason;
  generation: number;
  decision?: ApprovalInteractionDecision;
  notify?: boolean;
}

function finish(args: FinishArgs): void {
  const { state, pending, reason, generation } = args;
  if (!state.pending.delete(pending.approvalId)) return;
  clearTimeout(pending.timer);
  const ids = state.byConnection.get(pending.owner);
  ids?.delete(pending.approvalId);
  if (ids?.size === 0) state.byConnection.delete(pending.owner);
  if (args.notify !== false) notifyClosed(pending, reason, generation);
  pending.resolve(args.decision ?? deniedDecision(reason, generation));
}

function notifyClosed(pending: PendingApproval, reason: ApprovalClosedReason, generation: number): void {
  try {
    pending.owner.notify?.(APPROVAL_METHODS.closed, ApprovalClosedSchema.parse({
      approvalId: pending.approvalId, reason, approvalGeneration: generation,
    }));
  } catch {
    // The pending state is already retired; a broken socket cannot strand authority.
  }
}

function invalidateOtherPending(state: ApprovalInteractionState, retainedId: string, generation: number): void {
  for (const pending of [...state.pending.values()]) {
    if (pending.approvalId !== retainedId) {
      finish({ state, pending, reason: "approval_generation_changed", generation });
    }
  }
}

function invalidateExceptConnection(state: ApprovalInteractionState, connection: Connection, generation: number): void {
  for (const pending of [...state.pending.values()]) {
    if (pending.owner !== connection) finish({ state, pending, reason: "approval_generation_changed", generation });
  }
}

function cancel(state: ApprovalInteractionState, approvalId: string): boolean {
  const pending = state.pending.get(approvalId);
  if (!pending) return false;
  finish({ state, pending, reason: "cancelled", generation: pending.approvalGeneration });
  return true;
}
