/**
 * INPUT: private-conversation hook and shared Home visual primitives
 * OUTPUT: navigable child work, addressed controls and retained failure/reconnect diagnostics
 * POS: registered Home page; child work remains distinct from the Character relationship history
 */
import { MasterDetail } from "@/components/ui/master-detail.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { useSubagents } from "@/features/subagents/use-subagents.js";
import { SubagentList } from "@/features/subagents/subagent-list.js";
import { SubagentDetail } from "@/features/subagents/subagent-detail.js";
import { PageBody, PageHeader } from "../../page-chrome.tsx";
import { ActionButton } from "../../action-button.tsx";

export function SubagentsPage() {
  const model = useSubagents();
  const retry = () => void model.controller.refresh();
  return <>
    <PageHeader title="子代理" hint="查看委派工作的私有会话、输入与结果。" busy={model.state.loading} />
    <PageBody>
      <div className="flex justify-end"><ActionButton disabled={!model.connected || !!model.state.pending} busy={model.state.loading} onClick={retry}>刷新状态</ActionButton></div>
      {model.state.readError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: retry }}>{model.state.readError}</FeedbackLine>}
      {model.state.feedback && <FeedbackLine tone={model.state.feedback.tone}>{model.state.feedback.message}</FeedbackLine>}
      <div className="@container"><MasterDetail list={<SubagentList model={model} />} detail={<>
        {model.state.detailError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: retry }}>{model.state.detailError}</FeedbackLine>}
        <SubagentDetail model={model} />
      </>} /></div>
    </PageBody>
  </>;
}
