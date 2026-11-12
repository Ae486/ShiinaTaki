/**
 * INPUT:  stored Approval decisions and an optional batch of read-only presentation labels
 * OUTPUT: bounded capability/target labels with honest fallbacks for unavailable or historical targets
 * POS:    core/approval projection only; label resolution never changes bindings, usability, storage, or generations
 */
import {
  ApprovalSafeLabelsSchema, getCapabilityLabel, getPermissionCellDisplay,
  type ApprovalDurableDecision, type ApprovalSafeLabels,
} from "@taki/shared";

export type ApprovalLabelResolver = (
  decisions: readonly ApprovalDurableDecision[],
) => ReadonlyMap<string, ApprovalSafeLabels>;

export function approvalDecisionLabels(
  decisions: readonly ApprovalDurableDecision[],
  resolveLabels?: ApprovalLabelResolver,
): ReadonlyMap<string, ApprovalSafeLabels> {
  const resolved = readLabels(decisions, resolveLabels);
  return new Map(decisions.map((decision) => {
    const fallback = fallbackLabels(decision);
    const parsed = ApprovalSafeLabelsSchema.safeParse(resolved?.get(decision.decisionId));
    return [decision.decisionId, parsed.success ? { ...fallback, ...parsed.data } : fallback];
  }));
}

function readLabels(decisions: readonly ApprovalDurableDecision[], resolveLabels?: ApprovalLabelResolver) {
  try {
    return resolveLabels?.(decisions);
  } catch {
    // Optional current-catalog names cannot make durable approvals disappear when their source is unavailable.
    return undefined;
  }
}

function fallbackLabels(decision: ApprovalDurableDecision): ApprovalSafeLabels {
  const { identity, cellKey } = decision.binding;
  const capability = getCapabilityLabel(identity.capabilityId);
  if (identity.capabilityId === "mcp.tool.call") {
    return { capability, subject: "当前无法确认服务器与工具名称" };
  }
  if (identity.subject) return { capability, subject: "当前无法确认目标名称" };
  return { capability, subject: getPermissionCellDisplay(cellKey).label };
}
