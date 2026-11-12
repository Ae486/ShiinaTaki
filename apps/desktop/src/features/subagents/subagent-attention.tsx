/**
 * INPUT: Core-reported attention facts and local navigation intent
 * OUTPUT: persistent Home sidebar explanation, exact navigation and explicit inbox recovery
 * POS: ui/subagents — no child-state writer; Core validates each deliberate recovery action
 */
import { ActionButton } from "@/windows/home/action-button.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { useSubagentAttention } from "./use-subagent-attention.ts";
import { ATTENTION_LABEL } from "./subagent-attention-controller.ts";
import { openSubagentConversation } from "./subagent-navigation.ts";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { inboxRecoveryReason } from "./subagent-labels.ts";

export function SubagentAttention() {
  const { state, controller } = useSubagentAttention();
  if (!state.page?.entries.length && !state.error) return null;
  return <section aria-label="子代理待处理" className="mt-3 min-h-0 border-t border-border pt-3 text-xs text-text-secondary">
    <p className="font-medium text-text-body">子代理待处理{state.page?.entries.length ? `（${state.page.entries.length}${state.page.nextCursor ? "+" : ""}）` : ""}
      <PendingIndicator active={state.loading} label="正在核对待处理状态" /></p>
    {!state.fresh && <p role="status">上次记录尚未核对，以恢复后的当前状态为准。</p>}
    {state.error && <p role="status">{state.error}</p>}
    {state.feedback && <p role="status">{state.feedback}</p>}
    <div className="mt-2 max-h-52 space-y-3 overflow-y-auto">
      {state.page?.entries.map((entry) => <div key={entry.attentionId}>
        <p className="break-words font-medium">{entry.label}</p>
        <p>{ATTENTION_LABEL[entry.kind]}</p>
        <p className="mt-1">{entry.kind === "reconciliation_needed"
          ? "已有处理记录需要核对；只有运行时允许后才能明确继续，不会自动重做。"
          : entry.kind === "inbox_retry_exhausted" ? "主助手尚未开始处理这些消息，自动重试暂已结束。可明确请求再次尝试。"
          : entry.kind === "check_in_user" ? "此检查点必须由你明确继续或调整方向，主助手无法代为放行。"
            : "主助手已请求你的决定；请在这项私有工作中补充说明。"}</p>
        {entry.kind === "needs_user_input" && <p className="mt-1 whitespace-pre-wrap break-words">{entry.reason}</p>}
        {entry.kind === "reconciliation_needed" && <p className="mt-1">{inboxRecoveryReason(entry.reason)}</p>}
        <ActionButton tone="ghost" onClick={() => openSubagentConversation({ characterId: ACTIVE_CHARACTER_ID,
          subagentId: entry.subagentId, workInputId: entry.workInputId })}>
          {entry.kind === "reconciliation_needed" ? "核对主助手恢复记录" : entry.kind === "inbox_retry_exhausted" ? "查看相关工作" : "打开工作并决定"}
        </ActionButton>
        {(entry.kind === "reconciliation_needed" || entry.kind === "inbox_retry_exhausted") && entry.canResume && <ActionButton
          disabled={!state.fresh || !!state.pending} busy={state.pending === entry.attentionId}
          onClick={() => void controller.resume(entry.attentionId)}>{entry.kind === "inbox_retry_exhausted" ? "重试接入主助手" : "继续主助手处理"}</ActionButton>}
      </div>)}
    </div>
    <div className="mt-2 flex flex-wrap gap-1">
      <ActionButton tone="ghost" disabled={state.loading} onClick={() => void controller.refresh()}>刷新待处理</ActionButton>
      {state.page?.nextCursor && <ActionButton tone="ghost" disabled={!state.fresh || state.loading} onClick={() => controller.older()}>下一批</ActionButton>}
      {state.older && <ActionButton tone="ghost" disabled={state.loading} onClick={() => controller.newest()}>返回首批</ActionButton>}
    </div>
  </section>;
}
