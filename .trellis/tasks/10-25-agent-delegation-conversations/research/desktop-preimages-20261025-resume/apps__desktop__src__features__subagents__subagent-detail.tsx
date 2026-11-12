/**
 * INPUT: one coherently committed private conversation and its explicit work selection
 * OUTPUT: task/progress, addressed controls, private transcript and linked results
 * POS: ui/subagents — Home detail view reusing existing Chat message/tool presentation
 */
import { useMemo } from "react";
import { TimelineMessage } from "@/windows/home/pages/chat/timeline-message.js";
import { ChatClientContext } from "@/windows/home/pages/chat/chat-client-context.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { SubagentComposer } from "./subagent-composer.tsx";
import { SubagentInputs } from "./subagent-inputs.tsx";
import { SubagentResults } from "./subagent-results.tsx";
import { projectSubagentTranscript } from "./subagent-transcript.ts";
import { displayedTarget } from "./subagent-state.ts";
import { CHILD_STATE, RUN_STATE } from "./subagent-labels.ts";
import type { useSubagents } from "./use-subagents.ts";

export function SubagentDetail({ model }: { model: ReturnType<typeof useSubagents> }) {
  const { state, controller, available } = model;
  const detail = state.detail;
  const inputs = detail?.inputs.filter((row) => row.workInputId === state.workInputId) ?? [];
  const executions = detail?.executions.filter((row) => row.workInputId === state.workInputId) ?? [];
  const runIds = new Set(executions.map((row) => row.runId));
  const messages = useMemo(() => projectSubagentTranscript((detail?.messages ?? []).filter((row) =>
    detail?.executions.some((execution) => execution.runId === row.runId && execution.workInputId === state.workInputId))), [detail, state.workInputId]);
  const target = displayedTarget(state);
  if (!detail || !target) return <p className="p-4 text-sm text-text-secondary">{state.detailLoading ? "正在读取私有会话…" : "选择一个子代理查看工作与会话。"}</p>;
  const works = detail.inputs.filter((row) => row.kind === "work");
  const root = works.find((row) => row.inputId === state.workInputId);
  const results = detail.results.filter((row) => row.result.child.workInputId === state.workInputId);
  return <ChatClientContext.Provider value={model.mediaClient}><div className="space-y-4" data-subagent-id={detail.conversation.subagentId}>
    <header className="space-y-2">
      <div className="flex items-center gap-2"><h2 className="break-words text-base font-semibold text-text-strong">{detail.conversation.label}</h2>
        <PendingIndicator active={state.detailLoading} label="正在读取会话" /></div>
      <p className="text-xs text-text-secondary">{CHILD_STATE[detail.conversation.state]}</p>
      <label className="block text-xs text-text-secondary" htmlFor="subagent-work">查看的工作</label>
      <select id="subagent-work" disabled={!!state.pending} value={state.workInputId ?? ""} onChange={(event) => controller.selectWork(event.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-body">
        {!root && <option value={state.workInputId ?? ""}>所选工作尚未加载，请读取更多记录</option>}
        {works.map((work, index) => <option key={work.inputId} value={work.inputId}>{index + 1}. {work.direction.slice(0, 70) || "未命名工作"}</option>)}
      </select>
      {root && <p className="text-xs text-text-secondary">{root.completionPolicy === "record_only" ? "完成后仅保留结果" : "完成后请求主助手处理"}</p>}
      {executions.map((run) => <p key={run.runId} className="text-xs text-text-secondary">执行记录 · {RUN_STATE[run.state]}</p>)}
    </header>
    <SubagentComposer key={`${target.subagentId}:${target.workInputId}`} target={target} child={detail.conversation}
      controller={controller} available={available && !!root} pending={state.pending} />
    <SubagentInputs inputs={inputs} />
    <section className="space-y-3" aria-label="子代理私有会话">
      <h3 className="text-sm font-semibold text-text-body">私有工作会话</h3>
      {messages.length === 0 && <p className="text-xs text-text-secondary">{runIds.size ? "尚无保留的输出；执行状态见上方。" : "这项工作尚无执行记录。"}</p>}
      {messages.map((item) => <div key={item.key} data-private-message={item.key}><TimelineMessage item={item} /></div>)}
    </section>
    <SubagentResults results={results} />
    {(detail.nextMessageSeq || detail.nextInputSeq || detail.nextCompletionId) && <ActionButton busy={state.detailLoading}
      disabled={!model.connected || state.detailLoading} onClick={() => controller.loadMoreHistory()}>读取更多工作记录</ActionButton>}
  </div></ChatClientContext.Provider>;
}
