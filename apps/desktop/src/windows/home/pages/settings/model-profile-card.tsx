/**
 * INPUT: one Core profile status, read freshness and editor action bindings.
 * OUTPUT: Main/Utility card with separate saved/active truth and explicit cost-labelled testing.
 * POS: Settings model configuration presentation using existing Home fields, badges and buttons.
 */
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import type { ProfileEditorInput } from "./model-profile-editor-controller.ts";
import { useModelProfileEditor } from "./use-model-profile-editor.ts";
import { ModelProfileFields } from "./model-profile-fields.tsx";
import { completeProfile, profileIssueMessage } from "./model-profile-form.ts";

export function ModelProfileCard({ input }: { input: ProfileEditorInput }) {
  const editor = useModelProfileEditor(input);
  const { state } = editor;
  const status = input.status;
  const disabled = !input.client || !input.fresh || state.pending !== null || state.conflict || state.unconfirmed;
  const feedback = state.feedback?.kind === "save" && status.applicationState !== "applied" ? null : state.feedback;
  return <section aria-label={status.slot === "main" ? "主模型 Main" : "后台模型 Utility"}
    className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card"
    onFocusCapture={() => editor.focus(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) editor.focus(false);
    }} onCompositionStart={() => editor.compose(true)} onCompositionEnd={() => editor.compose(false)}>
    <div className="flex items-start justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-text-strong">{status.slot === "main" ? "主模型 Main" : "后台模型 Utility"}</h3>
        <p className="mt-1 text-xs text-text-secondary">{status.slot === "main" ? "用于聊天与新任务。" : "用于记忆整理等后台工作。"}</p></div>
      <Badge tone={status.state === "ready" ? "ok" : "neutral"}>{status.state === "ready" ? "已启用" : status.state === "disabled" ? "已停用" : "待配置"}</Badge>
    </div>
    <ProfileActiveSummary input={input} />
    <ModelProfileFields status={status} form={state.form} change={editor.change} />
    {state.dirty && <p className="text-xs text-text-secondary">有未保存的修改。</p>}
    {status.applicationState === "draft" && <FeedbackLine tone="info">草稿已保存；补全后保存即可应用。</FeedbackLine>}
    {(status.applicationState === "failed" || status.issues.length > 0) && <FeedbackLine tone="warn">
      {status.applicationState === "failed" && (status.active ? "草稿已保存，应用失败；原可用配置保留。" : "草稿已保存，应用失败，暂未启用模型。")}
      {status.issues.map(profileIssueMessage).join(" ")}
    </FeedbackLine>}
    {state.conflict && <FeedbackLine tone="warn" action={{ label: "载入最新配置", onClick: editor.useLatest }}>配置已在别处修改，当前输入已保留。请核对后继续。</FeedbackLine>}
    {state.conflict && <ActionButton disabled={!input.fresh || state.pending !== null} onClick={editor.keepEdits}>保留输入，基于最新配置继续编辑</ActionButton>}
    {feedback && <FeedbackLine tone={feedback.tone}>{feedback.message}</FeedbackLine>}
    <div className="mt-auto flex flex-wrap items-center gap-2">
      <ActionButton tone="primary" disabled={disabled} busy={state.pending === "save"} onClick={editor.save}>保存</ActionButton>
      <ActionButton disabled={disabled || state.form.mode === "disabled" || !completeProfile(state.form, status)}
        busy={state.pending === "test"} onClick={editor.test}>测试连接（可能产生费用）</ActionButton>
    </div>
    <p className="text-xs text-text-secondary">保存不会调用模型；信息不完整时保存为草稿。</p>
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">更多操作</summary>
      <p className="my-2">恢复后移除应用中的配置，重新使用环境配置或默认值。</p>
      <ActionButton disabled={disabled} onClick={editor.reset}>恢复环境配置／默认值</ActionButton>
    </details>
  </section>;
}

function ProfileActiveSummary({ input }: { input: ProfileEditorInput }) {
  const active = input.status.active;
  const source = active?.source === "application" ? "应用配置" : active?.source === "inherited" ? "继承主模型" : "环境配置";
  return <div className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
    {active ? <><p className="break-all">当前使用：{active.model} · {source}</p><p className="mt-1 break-all">{active.baseUrl}</p></>
      : <p>当前没有可用模型。配置、历史和资源管理仍可使用。</p>}
    {!input.fresh && <p className="mt-1">正在等待确认最新状态，当前显示上次读取结果。</p>}
  </div>;
}
