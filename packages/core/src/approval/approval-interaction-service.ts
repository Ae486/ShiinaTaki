/**
 * INPUT:  canonical Approval requests, exact operator Connection objects, and the durable ApprovalDecisionService
 * OUTPUT: connection-owned pending/session lifecycle with targeted request/closed notifications and bounded responses
 * POS:    core/approval — transient Core authority for interactive Core/MCP asks; raw execution input never enters here
 */
import {
  type ApprovalDecisionBinding,
  type ApprovalListResult,
  type ApprovalPresentation,
  type ApprovalRevokeResult,
  type CanonicalApprovalRespondParams,
  type CanonicalApprovalRespondResult,
  type RunEvent,
} from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import type { ApprovalDecisionService } from "./approval-decision-service.ts";
import {
  createApprovalInteractionState,
  disconnectConnection,
  invalidatePolicyGeneration,
  requestInteraction,
  respondInteraction,
  revokeDurableDecision,
  type ApprovalInteractionState,
} from "./approval-interaction-state.ts";
import { sameApprovalBinding } from "./approval-interaction-binding.ts";

export type ApprovalInteractionDecision =
  | { allowed: true; scope: "once" | "session" | "always"; approvalGeneration: number }
  | {
      allowed: false;
      reason: "denied" | "expired" | "cancelled" | "operator_disconnected" | "invalidated";
      approvalGeneration: number;
    }
  | { allowed: false; reason: "operator_unavailable" | "notification_failed"; approvalGeneration: number };

export interface ApprovalInteractionRequest {
  owner: Connection;
  policyGeneration: number;
  binding: ApprovalDecisionBinding;
  presentation: ApprovalPresentation;
  timeoutMs?: number;
  observation?: { runId: string; attemptId: string; capabilityId: string };
}

export interface ApprovalRequestHandle {
  approvalId: string | null;
  result: Promise<ApprovalInteractionDecision>;
  cancel(): boolean;
}

export interface ApprovalInteractionService {
  request(input: ApprovalInteractionRequest): ApprovalRequestHandle;
  respond(connection: Connection, params: CanonicalApprovalRespondParams): CanonicalApprovalRespondResult;
  list(): ApprovalListResult;
  revoke(decisionId: string, expectedApprovalGeneration: number): ApprovalRevokeResult;
  invalidatePolicy(policyGeneration: number): void;
  disconnect(connection: Connection): void;
  approvalGeneration(): number;
  onApprovalGenerationChanged(listener: (approvalGeneration: number) => void): void;
  onPolicyInvalidated(listener: (policyGeneration: number) => void): void;
  isCurrentAuthority(input: {
    connection: Connection;
    decision: Extract<ApprovalInteractionDecision, { allowed: true }>;
    binding: ApprovalDecisionBinding;
    approvedBinding: ApprovalDecisionBinding;
    policyGeneration: number;
    approvedPolicyGeneration: number;
  }): boolean;
}

export function createApprovalInteractionService(
  authority: ApprovalDecisionService,
  record?: (event: Omit<RunEvent, "eventId" | "seq">) => void,
): ApprovalInteractionService {
  const state: ApprovalInteractionState = createApprovalInteractionState();
  const generationListeners: Array<(approvalGeneration: number) => void> = [];
  const policyListeners: Array<(policyGeneration: number) => void> = [];
  const notifyGeneration = (before: number): void => {
    const after = authority.snapshot().approvalGeneration;
    if (after !== before) for (const listener of generationListeners) listener(after);
  };
  return {
    request(input) {
      const handle = requestInteraction({ state, authority, input });
      observeApproval(record, input.observation, handle);
      return handle;
    },
    respond(connection, params) {
      const before = authority.snapshot().approvalGeneration;
      const result = respondInteraction({ state, authority, connection, params });
      notifyGeneration(before);
      return result;
    },
    list: () => list(authority),
    revoke(decisionId, expectedApprovalGeneration) {
      const before = authority.snapshot().approvalGeneration;
      const result = revokeDurableDecision({ state, authority, decisionId, expectedApprovalGeneration });
      notifyGeneration(before);
      return result;
    },
    invalidatePolicy(policyGeneration) {
      const before = authority.snapshot().approvalGeneration;
      invalidatePolicyGeneration({ state, authority, policyGeneration });
      notifyGeneration(before);
      for (const listener of policyListeners) listener(policyGeneration);
    },
    disconnect(connection) {
      const before = authority.snapshot().approvalGeneration;
      disconnectConnection({ state, authority, connection });
      notifyGeneration(before);
    },
    approvalGeneration: () => authority.snapshot().approvalGeneration,
    onApprovalGenerationChanged: (listener) => generationListeners.push(listener),
    onPolicyInvalidated: (listener) => policyListeners.push(listener),
    isCurrentAuthority: (input) => isCurrentAuthority(state, authority, input),
  };
}

function observeApproval(
  record: ((event: Omit<RunEvent, "eventId" | "seq">) => void) | undefined,
  observation: ApprovalInteractionRequest["observation"],
  handle: ApprovalRequestHandle,
): void {
  if (!record || !observation) return;
  if (handle.approvalId) {
    recordSafely(record, approvalEvent(observation, "approval.requested", {
      kind: "approval.requested", state: "pending", approvalId: handle.approvalId,
      capabilityId: observation.capabilityId,
    }));
  }
  void handle.result.then((decision) => {
    const state = decision.allowed ? "approved" as const : decision.reason;
    recordSafely(record, approvalEvent(observation, "approval.decided", {
      kind: "approval.decided", state,
      ...(handle.approvalId ? { approvalId: handle.approvalId } : {}),
      capabilityId: observation.capabilityId,
      ...(decision.allowed ? { scope: decision.scope } : { reasonCode: `approval_${decision.reason}` }),
    }));
  }).catch(() => { /* Approval result observation never changes Approval authority */ });
}

function approvalEvent(
  observation: NonNullable<ApprovalInteractionRequest["observation"]>,
  kind: "approval.requested" | "approval.decided",
  payload: Extract<RunEvent["payload"], { kind: "approval.requested" | "approval.decided" }>,
): Omit<RunEvent, "eventId" | "seq"> {
  return {
    runId: observation.runId, attemptId: observation.attemptId, schemaVersion: "run-event.v1",
    category: "governance", kind, occurredAt: new Date().toISOString(),
    source: "core.approval-authority", payload,
  };
}

function recordSafely(
  record: (event: Omit<RunEvent, "eventId" | "seq">) => void,
  event: Omit<RunEvent, "eventId" | "seq">,
): void {
  try { record(event); } catch { /* approval truth is independent from observer evidence */ }
}

function isCurrentAuthority(
  state: ApprovalInteractionState,
  authority: ApprovalDecisionService,
  input: {
    connection: Connection;
    decision: Extract<ApprovalInteractionDecision, { allowed: true }>;
    binding: ApprovalDecisionBinding;
    approvedBinding: ApprovalDecisionBinding;
    policyGeneration: number;
    approvedPolicyGeneration: number;
  },
): boolean {
  if (input.approvedPolicyGeneration !== input.policyGeneration
    || !sameApprovalBinding(input.approvedBinding, input.binding)
    || authority.snapshot().approvalGeneration !== input.decision.approvalGeneration) return false;
  if (input.decision.scope === "once") return true;
  if (input.decision.scope === "always") {
    return authority.list().some((decision) =>
      decision.usability.usable && sameApprovalBinding(decision.binding, input.binding));
  }
  const session = state.sessions.get(input.connection)?.get(input.binding.decisionScopeDigest);
  return session?.processEpoch === authority.processEpoch
    && session.approvalGeneration === input.decision.approvalGeneration
    && session.policyGeneration === input.policyGeneration
    && sameApprovalBinding(session.binding, input.binding);
}

function list(authority: ApprovalDecisionService): ApprovalListResult {
  const snapshot = authority.snapshot();
  return {
    approvalGeneration: snapshot.approvalGeneration,
    governanceRegistryRevision: snapshot.governanceRegistryRevision,
    disclosureRevision: snapshot.disclosureRevision as 1,
    decisions: authority.list(),
  };
}
