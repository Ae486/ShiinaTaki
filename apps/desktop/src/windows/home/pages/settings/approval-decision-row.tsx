/**
 * INPUT:  one Core durable decision, its safe labels/usability, and the existing revoke readiness/callback.
 * OUTPUT: <ApprovalDecisionRow> — readable operation, target fallback, creation time, and precisely bound revoke action.
 * POS:    ui/windows/home/pages/settings — presentation only; names never determine decision validity or authority.
 */
import { getCapabilityLabel, getPermissionCellDisplay, type ApprovalDecisionListItem } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { Badge } from "../../badge.tsx";

interface ApprovalDecisionRowProps {
  decision: ApprovalDecisionListItem;
  disabled: boolean;
  pending: boolean;
  onRevoke(decisionId: string): void;
}

export function ApprovalDecisionRow({ decision, disabled, pending, onRevoke }: ApprovalDecisionRowProps) {
  const capability = decision.labels?.capability ?? getCapabilityLabel(decision.binding.identity.capabilityId);
  const target = decision.labels?.subject ?? (decision.binding.identity.subject
    ? "暂无法显示原授权目标的名称。"
    : getPermissionCellDisplay(decision.binding.cellKey).label);
  const createdAt = new Date(decision.createdAt).toLocaleString("zh-CN");
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-text-body">{capability}</p>
        {target !== capability && <p className="mt-1 break-words text-xs text-text-secondary">{target}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <Badge tone={decision.usability.usable ? "ok" : "muted"}>{decision.usability.usable ? "授权有效" : "当前不适用"}</Badge>
          <span>创建于 <time dateTime={decision.createdAt}>{createdAt}</time></span>
        </div>
      </div>
      <ActionButton tone="secondary" disabled={disabled} onClick={() => onRevoke(decision.decisionId)}>
        {pending ? "撤销中…" : "撤销"}
      </ActionButton>
    </div>
  );
}
