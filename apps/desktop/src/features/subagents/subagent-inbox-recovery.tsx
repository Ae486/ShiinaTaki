/**
 * INPUT: Core-reported unfinished parent handling and explicit operator recovery authority
 * OUTPUT: compact discoverable recovery list, refusal/unknown feedback and deliberate continuation
 * POS: ui/subagents — parent inbox reconciliation, independent of child user-stop controls
 */
import { ActionButton } from "@/windows/home/action-button.js";
import { useSubagentInbox } from "./use-subagent-inbox.ts";

const REASONS: Record<string, string> = {
  missing_disposition: "处理已中断，可明确继续核对已有记录。",
  SUBAGENT_INBOX_NOT_QUIESCENT: "此前执行尚未结束，请等待当前运行状态更新。",
  SUBAGENT_INBOX_UNCERTAIN_EFFECT: "此前工具操作结果未知，需先核对该操作。",
  SUBAGENT_INBOX_ALREADY_RESUMING: "已存在后续处理，请查看当前执行状态。",
  SUBAGENT_INBOX_RECONCILIATION_REQUIRED: "处理状态已变化，请刷新核对。",
};

export function SubagentInboxRecovery() {
  const { state, controller, ready } = useSubagentInbox();
  return <details className="mt-4 border-t border-border pt-3 text-xs text-text-secondary">
    <summary className="cursor-pointer font-medium">主助手处理恢复{state.page?.entries.length ? `（${state.page.entries.length}）` : ""}</summary>
    <div className="mt-2 space-y-2">
      <p>已接入但中断的消息需要明确继续；此操作不会解除子代理的用户停止状态。</p>
      <ActionButton tone="ghost" disabled={!ready || !!state.pending} busy={state.loading} onClick={() => controller.refresh()}>刷新恢复状态</ActionButton>
      {state.error && <p role="status">{state.error}</p>}{state.feedback && <p role="status">{state.feedback}</p>}
      {state.page?.entries.length === 0 && <p>当前没有待恢复的主助手处理。</p>}
      {state.page?.entries.map((entry, index) => <div key={entry.consumerId} className="rounded-lg border border-border p-2">
        <p>待恢复处理 {index + 1} · {entry.events.length} 条消息</p>
        <p>{REASONS[entry.reason] ?? "运行时尚未允许继续，需要先核对执行结果。"}</p>
        {entry.actions.length > 0 && <p>已保存 {entry.actions.length} 项处理记录，继续时保留。</p>}
        <ActionButton disabled={!ready || !state.fresh || !!state.pending || !entry.canResume} busy={state.pending === entry.consumerId}
          onClick={() => void controller.resume(entry.consumerId)}>继续主助手处理</ActionButton>
      </div>)}
      {state.page?.nextCursor && <ActionButton disabled={!ready || state.loading} onClick={() => controller.older()}>读取更多恢复记录</ActionButton>}
    </div>
  </details>;
}
