/**
 * INPUT: one continuous conversation and explicitly addressed work selection
 * OUTPUT: readable child lifecycle, historical ordering disclosure and composer target selector
 * POS: ui/subagents — work focus changes addressing only; history remains continuous
 */
import type { SubagentConversationResult } from "@taki/shared";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { CHILD_STATE } from "./subagent-labels.ts";

interface HeaderProps {
  detail: SubagentConversationResult; workId: string; loading: boolean; pending: boolean;
  selectWork(workId: string): void;
}

export function SubagentConversationHeader({ detail, workId, loading, pending, selectWork }: HeaderProps) {
  const ids = [...new Set([detail.conversation.activeWorkInputId, detail.conversation.latestWorkInputId,
    workId, ...detail.entries.map((entry) => entry.workInputId)].filter((id): id is string => id !== null))];
  return <header className="shrink-0 space-y-2 border-b border-border bg-surface px-4 py-3">
    <div className="flex items-center gap-2"><h2 className="break-words text-base font-semibold text-text-strong">{detail.conversation.label}</h2>
      <span className="text-xs text-text-secondary">{CHILD_STATE[detail.conversation.state]}</span>
      <PendingIndicator active={loading} label="正在读取会话" /></div>
    <label className="flex items-center gap-2 text-xs text-text-secondary" htmlFor="subagent-work">输入发送至
      <select id="subagent-work" disabled={pending} value={workId} onChange={(event) => selectWork(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-body">
        {ids.map((id) => {
          const root = detail.entries.find((entry) => entry.kind === "input" && entry.input.inputId === id);
          const label = root?.kind === "input" ? root.input.direction.slice(0, 70) : id === detail.conversation.latestWorkInputId ? "最近的工作" : "较早的工作（可加载历史查看）";
          return <option key={id} value={id}>{label}{id === detail.conversation.activeWorkInputId ? " · 执行中" : ""}</option>;
        })}
      </select>
    </label>
    {detail.entries.some((entry) => entry.historicalOrder) && <p className="text-xs text-text-faint">部分早期记录按历史时间整理，无法确认同一时刻的先后顺序。</p>}
  </header>;
}
