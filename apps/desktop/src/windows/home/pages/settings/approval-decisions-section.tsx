/**
 * INPUT:  current Home WsClient generation and canonical Approval list/revoke methods
 * OUTPUT: <ApprovalDecisionsSection> — readable durable allow list with current-generation revoke feedback
 * POS:    ui/windows/home/pages/settings — decision management only; pending prompts stay on their initiating socket
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionButton } from "../../action-button.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useHomeClient } from "../../home-client-context.ts";
import { ApprovalDecisionRow } from "./approval-decision-row.tsx";
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
    <section className="mt-6 space-y-3" aria-label="长期授权">
      <div>
        <h2 className="text-sm font-semibold text-text-strong">长期授权</h2>
        <p className="mt-1 text-xs text-text-secondary">管理长期允许的操作；本次及本连接期间的允许不会保存在这里。</p>
      </div>
      {message && <PageAlert>审批管理失败：{message}</PageAlert>}
      {!data && !message && <Skeleton lines={2} />}
      {state.kind === "error" && <ActionButton tone="secondary" disabled={!ready} onClick={refresh}>重试</ActionButton>}
      {data?.decisions.length === 0 && <EmptyState title="暂无长期授权" />}
      {data?.decisions.map((decision) => (
        <ApprovalDecisionRow
          key={decision.decisionId}
          decision={decision}
          disabled={!ready || (state.kind === "ready" && state.revokingId !== null)}
          pending={state.kind === "ready" && state.revokingId === decision.decisionId}
          onRevoke={revoke}
        />
      ))}
    </section>
  );
}
