/**
 * INPUT: current Home connection and private-conversation controller
 * OUTPUT: bounded child navigation, continuous Chat viewport and non-displacing recovery feedback
 * POS: registered Home page — transcript owns its scroll; closing/navigation never stops child work
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { useSubagents } from "@/features/subagents/use-subagents.js";
import { SubagentList } from "@/features/subagents/subagent-list.js";
import { SubagentDetail } from "@/features/subagents/subagent-detail.js";
import { SubagentInboxRecovery } from "@/features/subagents/subagent-inbox-recovery.js";
import { PageHeader } from "../../page-chrome.tsx";
import { ActionButton } from "../../action-button.tsx";

export function SubagentsPage() {
  const model = useSubagents();
  const retry = () => void model.controller.refresh();
  return <>
    <PageHeader title="子代理" hint="持续的私有工作会话；主对话可同时继续。" busy={model.state.loading} />
    <div className="@container flex min-h-0 flex-1 flex-col bg-surface-muted">
      {!model.connected && <div role="status" className="shrink-0 px-4 py-2 text-xs text-text-secondary">连接正在恢复，记录与草稿已保留，当前无法提交操作。</div>}
      {model.state.readError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: retry }}>{model.state.readError}</FeedbackLine>}
      {model.state.feedback && <FeedbackLine tone={model.state.feedback.tone}>{model.state.feedback.message}</FeedbackLine>}
      <div className="flex min-h-0 flex-1 flex-col @xl:flex-row">
        <aside className="max-h-36 shrink-0 overflow-y-auto border-b border-border p-3 @xl:max-h-none @xl:w-60 @xl:border-r @xl:border-b-0">
          <ActionButton disabled={!model.connected || !!model.state.pending} busy={model.state.loading} onClick={retry}>刷新状态</ActionButton>
          <SubagentList model={model} />
          <SubagentInboxRecovery />
        </aside>
        <SubagentDetail model={model} />
      </div>
    </div>
  </>;
}
