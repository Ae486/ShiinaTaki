/**
 * INPUT:  canonical Approval bindings plus the active registry and durable decision authority
 * OUTPUT: exact binding equality, allowed-choice ceilings, and usable durable-authority lookup
 * POS:    core/approval — pure trusted-binding helpers for the transient interaction state machine
 */
import {
  CANONICAL_GOVERNANCE_REGISTRY,
  governanceCell,
  governanceDescriptor,
  type ApprovalChoice,
  type ApprovalDecisionBinding,
  type ApprovalStoredDurableDecisionBinding,
} from "@taki/shared";
import type { ApprovalDecisionService } from "./approval-decision-service.ts";

type ComparableBinding = ApprovalDecisionBinding | ApprovalStoredDurableDecisionBinding;

export function sameApprovalBinding(left: ComparableBinding, right: ComparableBinding): boolean {
  return left.bindingRevision === right.bindingRevision
    && left.descriptorRevision === right.descriptorRevision
    && left.classifierId === right.classifierId
    && left.classifierRevision === right.classifierRevision
    && left.cellKey === right.cellKey
    && left.decisionScopeDigest === right.decisionScopeDigest
    && JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

export function allowedApprovalChoices(binding: ApprovalDecisionBinding): ApprovalChoice[] {
  const descriptor = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, binding.identity.capabilityId);
  const cell = descriptor ? governanceCell(descriptor, binding.cellKey) : undefined;
  if (!cell) throw new Error("approval binding cell is unavailable");
  return cell.approvalMemory === "rememberable"
    ? ["allow_once", "allow_session", "allow_always", "deny"]
    : ["allow_once", "deny"];
}

export function hasUsableDurableAuthority(
  authority: ApprovalDecisionService,
  binding: ApprovalDecisionBinding,
): boolean {
  return authority.list().some((decision) => decision.usability.usable && sameApprovalBinding(decision.binding, binding));
}
