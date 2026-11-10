/**
 * INPUT: the Core-owned tidy operation, read state, and explicit submit/refresh actions.
 * OUTPUT: durable progress, completed/partial/interrupted outcomes and actionable recovery guidance.
 * POS: Home Operations presentation; every execution claim comes from Core, never a pending RPC.
 */
import type { MemoryOperation } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import type { MemoryOperationsFeedback } from "./memory-operations-controller.ts";
import { memoryTidyView } from "./memory-tidy-state.ts";
import { tidyDefectRows } from "./operations-state.ts";

export interface MemoryTidyCardProps {
  operation: MemoryOperation | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  active: boolean;
  feedback: MemoryOperationsFeedback | null;
  connectionReady: boolean;
  runTidy(): Promise<void>;
  refresh(): Promise<void>;
}

export function MemoryTidyCard(props: MemoryTidyCardProps) {
  const view = props.operation ? memoryTidyView(props.operation) : null;
  const busy = props.submitting || props.active || view?.pending === true;
  const feedback = props.operation?.terminalAt && props.feedback?.operationId === props.operation.operationId ? null : props.feedback;
  return (
    <PageCard title="记忆整理">
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="primary" busy={busy} onClick={() => void props.runTidy()}
          disabled={!props.connectionReady || props.loading || Boolean(props.error) || busy}>
          {view?.buttonLabel ?? "立即整理"}
        </ActionButton>
        <ActionButton tone="ghost" onClick={() => void props.refresh()} disabled={!props.connectionReady || props.loading}>刷新整理状态</ActionButton>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {props.error && <PageAlert>{props.error}</PageAlert>}
        {!props.connectionReady && <p className="text-xs text-text-secondary">连接恢复后将重新读取整理状态；当前显示的是上次确认的结果。</p>}
        {props.loading && props.connectionReady && !view && <p className="text-xs text-text-secondary">正在核对最新整理状态…</p>}
        {view && <>
          <FeedbackLine tone={view.tone}>{view.headline}</FeedbackLine>
          <LabeledRows rows={view.progress} />
          {view.detail && <p className="text-xs text-text-body">{view.detail}</p>}
          <LabeledRows rows={view.issues} />
          {view.nextAction && <p className="text-xs text-text-body">{view.nextAction}</p>}
          {view.outcome && <><p className="text-xs text-text-secondary">本次检查时的候选与提示（不代表已确认错误）</p><LabeledRows rows={tidyDefectRows(view.outcome)} /></>}
        </>}
        {!view && !props.loading && !props.error && <p className="text-xs text-text-secondary">整理已有的长期记忆，并维护记忆索引和对用户的理解。</p>}
        {props.active && !view?.pending && <p className="text-xs text-text-body">当前有其他记忆整理正在执行，请等待其完成。</p>}
        {feedback && <FeedbackLine tone={feedback.tone}>{feedback.message}</FeedbackLine>}
      </div>
    </PageCard>
  );
}
