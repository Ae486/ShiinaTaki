/**
 * INPUT:  current Home WsClient generation and canonical Approval list/revoke methods
 * OUTPUT: <ApprovalDecisionsSection> — fresh in-memory durable allow list with optimistic revoke feedback
 * POS:    ui/windows/home/pages/settings — decision management only; pending prompts stay on their initiating socket
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionButton } from "../../action-button.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import { useHomeClient } from "../../home-client-context.ts";
import {
  createApprovalDecisionsController,
  type ApprovalDecisionsState,
} from "./approval-decisions-controller.ts";

const INITIAL_STATE: ApprovalDecisionsState = { kind: "loading", data: null, message: null };

export function ApprovalDecisionsSection() {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState<ApprovalDecisionsState>(INITIAL_STATE);
  const controller = useMemo(() => createApprovalDecisionsController(setState), []);
  useEffect(() => {
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);
  const refresh = useCallback(() => void controller.refresh(), [controller]);
  const revoke = useCallback((decisionId: string) => void controller.revoke(decisionId), [controller]);
  const data = state.data;
  const message = state.message;

  return (
    <section className="mt-6 space-y-3" aria-label="持久审批">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">持久审批</h2>
        <p className="mt-1 text-xs text-slate-500">仅列出 Core 中的长期允许；连接级允许不会持久化。</p>
      </div>
      {message && <PageAlert>审批管理失败：{message}</PageAlert>}
      {!data && !message && <p className="text-xs text-slate-400">正在读取审批状态…</p>}
      {state.kind === "error" && <ActionButton tone="secondary" disabled={!ready} onClick={refresh}>重试</ActionButton>}
      {data?.decisions.length === 0 && <p className="text-xs text-slate-400">暂无长期允许。</p>}
      {data?.decisions.map((decision) => (
        <div key={decision.decisionId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-700">{decision.labels?.capability ?? decision.binding.identity.capabilityId}</p>
            <p className="truncate text-xs text-slate-400">{decision.labels?.subject ?? decision.binding.cellKey}</p>
          </div>
          <ActionButton
            tone="secondary"
            disabled={!ready || (state.kind === "ready" && state.revokingId !== null)}
            onClick={() => revoke(decision.decisionId)}
          >
            {state.kind === "ready" && state.revokingId === decision.decisionId ? "撤销中…" : "撤销"}
          </ActionButton>
        </div>
      ))}
    </section>
  );
}
