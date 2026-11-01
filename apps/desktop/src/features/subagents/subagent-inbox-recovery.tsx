/**
 * INPUT: Core-reported unfinished parent handling and explicit operator recovery authority
 * OUTPUT: compact discoverable recovery list, refusal/unknown feedback and deliberate continuation
 * POS: ui/subagents — parent inbox reconciliation, independent of child user-stop controls
 */
import { ActionButton } from "@/windows/home/action-button.js";
import { useSubagentInbox } from "./use-subagent-inbox.ts";
import { inboxRecoveryReason } from "./subagent-labels.ts";

export function SubagentInboxRecovery() {
  const { state, controller, ready } = useSubagentInbox();
  return <details open={!!state.page?.entries.length} className="mt-4 border-t border-border pt-3 text-xs text-text-secondary">
    <summary className="cursor-pointer font-medium">主助手处理恢复{state.page?.entries.length ? `（${state.page.entries.length}）` : ""}</summary>
    <div className="mt-2 space-y-2">
      <p>已接入但中断的消息需要明确继续；此操作不会解除子代理的用户停止状态。</p>
      <ActionButton tone="ghost" disabled={!ready || !!state.pending} busy={state.loading} onClick={() => controller.refresh()}>刷新恢复状态</ActionButton>
      {state.error && <p role="status">{state.error}</p>}{state.feedback && <p role="status">{state.feedback}</p>}
      {state.page?.entries.length === 0 && <p>当前没有待恢复的主助手处理。</p>}
      {state.page?.entries.map((entry, index) => <div key={entry.consumerId} className="rounded-lg border border-border p-2">
        <p>待恢复处理 {index + 1} · {entry.events.length} 条消息</p>
        <p>{inboxRecoveryReason(entry.reason)}</p>
        {entry.actions.length > 0 && <p>已保存 {entry.actions.length} 项处理记录，继续时保留。</p>}
        <ActionButton disabled={!ready || !state.fresh || !!state.pending || !entry.canResume} busy={state.pending === entry.consumerId}
          onClick={() => void controller.resume(entry.consumerId)}>继续主助手处理</ActionButton>
      </div>)}
      {state.page?.nextCursor && <ActionButton disabled={!ready || state.loading} onClick={() => controller.older()}>读取更多恢复记录</ActionButton>}
    </div>
  </details>;
}
