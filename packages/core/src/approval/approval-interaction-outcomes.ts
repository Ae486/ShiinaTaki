/**
 * INPUT:  Approval terminal reasons, bounded response statuses, and already-computed generations
 * OUTPUT: small resolved handles plus canonical denied/respond result objects
 * POS:    core/approval — pure lifecycle outcome helpers shared by the transient interaction state machine
 */
import type {
  ApprovalClosedReason,
  CanonicalApprovalRespondResult,
} from "@taki/shared";
import type {
  ApprovalInteractionDecision,
  ApprovalRequestHandle,
} from "./approval-interaction-service.ts";

export function resolvedAuthority(
  scope: "session" | "always",
  approvalGeneration: number,
): ApprovalRequestHandle {
  return {
    approvalId: null,
    result: Promise.resolve({ allowed: true, scope, approvalGeneration }),
    cancel: () => false,
  };
}

export function resolvedFailure(
  reason: "operator_unavailable" | "notification_failed",
  approvalGeneration: number,
): ApprovalRequestHandle {
  return {
    approvalId: null,
    result: Promise.resolve({ allowed: false, reason, approvalGeneration }),
    cancel: () => false,
  };
}

export function deniedDecision(
  reason: ApprovalClosedReason,
  approvalGeneration: number,
): ApprovalInteractionDecision {
  const mapped = reason === "denied" || reason === "expired" || reason === "cancelled" || reason === "operator_disconnected"
    ? reason
    : "invalidated";
  return { allowed: false, reason: mapped, approvalGeneration };
}

export function approvalResponse(
  status: CanonicalApprovalRespondResult["status"],
  approvalGeneration: number,
): CanonicalApprovalRespondResult {
  return { status, approvalGeneration };
}
