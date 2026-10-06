/**
 * INPUT: transition hook state and Core-derived action availability.
 * OUTPUT: minimal repeated-switch/emergency Home surface with separate confirmation and durable history.
 * POS: ui/operations — keeps existing theme/primitives; no provider-only visibility guard.
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { MEMORY_OPERATION_KIND_LABEL } from "./memory-authority-state.ts";
import { transitionActionReason } from "./memory-transition-state.ts";
import { MemoryTransitionConfirmation } from "./memory-transition-confirmation.tsx";
import { MemoryTransitionProgress } from "./memory-transition-progress.tsx";
import type { MemoryTransitionsView } from "./use-memory-transitions.ts";
type Props = { view: MemoryTransitionsView };

export function MemoryTransitionsCard({ view }: Props) {
  const locked = !view.connectionReady || view.loading || !!view.error || !!view.busyKey;
  return <PageCard title="记忆模式切换与恢复"><div className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-text-secondary">当前权威：{view.status?.provider === "local" ? "Local" : view.status?.provider === "hindsight" ? "Hindsight" : "尚未读取或未启用"}</p>
      <ActionButton tone="ghost" disabled={!view.connectionReady || view.loading} onClick={() => void view.refresh()}>刷新转换状态</ActionButton>
    </div>
    {!view.connectionReady && <FeedbackLine tone="warn">连接恢复后读取原操作；不会自动重新提交。</FeedbackLine>}
    {view.error && <FeedbackLine tone="danger">{view.error}</FeedbackLine>}
    {!view.status && view.loading && <Skeleton lines={4} />}
    {view.status && <div className="flex flex-col gap-2">{view.status.actions.map((action) => <div key={action.kind}>
      <ActionButton tone={action.kind === "transition.emergency-local" ? "danger-soft" : "secondary"}
        disabled={locked || !action.allowed} onClick={() => void view.openPreview(action.kind)}>
        预览{MEMORY_OPERATION_KIND_LABEL[action.kind]}
      </ActionButton>
      {action.reason && <p className="mt-1 text-xs text-text-secondary">{transitionActionReason(action, view.status?.provider ?? null)}</p>}
    </div>)}</div>}
    {(view.preview || view.previewLoading || view.previewError) && <MemoryTransitionConfirmation view={view} locked={locked} />}
    {view.busyKey && <p role="status" className="text-xs text-text-secondary">正在等待 Core 受理结果…</p>}
    {view.feedback && <FeedbackLine tone={view.feedback.tone}>{view.feedback.message}</FeedbackLine>}
    {view.status?.entries.length === 0 && <p className="text-xs text-text-secondary">暂无转换历史。</p>}
    {view.status?.entries.map((entry) => <MemoryTransitionProgress key={entry.operation.operationId} entry={entry} view={view} locked={locked} />)}
    {view.status?.hasOlder && <p className="text-xs text-text-secondary">当前显示最近 50 条转换操作；较早历史仍保留在 Core。</p>}
  </div></PageCard>;
}
