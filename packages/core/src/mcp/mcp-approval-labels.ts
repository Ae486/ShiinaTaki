/**
 * INPUT:  a lazy current MCP snapshot reader and stored Approval decisions
 * OUTPUT: exact Host/subject/revision-matched MCP names for one approval-list projection
 * POS:    core/mcp read-only adapter; current-generation evidence is required and names never become authority
 */
import { formatMcpToolDisplayName, type ApprovalSafeLabels } from "@taki/shared";
import type { ApprovalLabelResolver } from "../approval/approval-labels.ts";
import type { McpToolSnapshot } from "./mcp-manager.ts";

export function createMcpApprovalLabelResolver(readSnapshot: () => readonly McpToolSnapshot[]): ApprovalLabelResolver {
  return (decisions) => {
    const names = currentNames(readSnapshot());
    const labels = new Map<string, ApprovalSafeLabels>();
    for (const decision of decisions) {
      const { identity } = decision.binding;
      if (identity.capabilityId !== "mcp.tool.call" || !identity.subject) continue;
      const name = names.get(subjectKey(identity.ownerHostId, identity.subject.subjectId, identity.subject.revision));
      if (name !== undefined && name !== null) labels.set(decision.decisionId, { subject: name });
    }
    return labels;
  };
}

function currentNames(snapshot: readonly McpToolSnapshot[]): ReadonlyMap<string, string | null> {
  const names = new Map<string, string | null>();
  for (const entry of snapshot) {
    if (!isCurrent(entry)) continue;
    const key = subjectKey(entry.ownerHostId, entry.ref.subjectId, entry.ref.subjectRevision);
    // A duplicate exact binding is ambiguous even if a faulty source gives it two plausible names.
    names.set(key, names.has(key) ? null : formatMcpToolDisplayName(entry.ref));
  }
  return names;
}

function isCurrent(entry: McpToolSnapshot): boolean {
  try {
    return Number.isSafeInteger(entry.generation) && entry.generation > 0 && entry.isCurrent();
  } catch {
    // One failed liveness probe must not hide other current names or the stored decision itself.
    return false;
  }
}

function subjectKey(ownerHostId: string, subjectId: string, subjectRevision: string): string {
  return JSON.stringify([ownerHostId, subjectId, subjectRevision]);
}
