/**
 * INPUT:  the visible Home template controller and genuine Core scope/status catalogs
 * OUTPUT: complete Operations template management section with explicit editor, preview and original-plan recovery
 * POS:    ui/operations — no independent authority, browser persistence or Native credential flow
 */
import { PageCard } from "../../page-card.tsx";
import { ActionButton } from "../../action-button.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { TemplateEditor } from "./hindsight-template-editor.tsx";
import { TemplatePreview } from "./hindsight-template-preview.tsx";
import { TemplatePlan } from "./hindsight-template-plan.tsx";
import { useHindsightTemplates } from "./use-hindsight-templates.ts";

export function HindsightTemplateSection() {
  const view = useHindsightTemplates();
  return <HindsightTemplateCard view={view} />;
}

export function HindsightTemplateCard({ view }: { view: ReturnType<typeof useHindsightTemplates> }) {
  const { state, controller, connectionReady } = view;
  const frame = state.frame;
  const locked = !connectionReady || state.loading || !!state.error || state.busyKey !== null;
  return <PageCard title="Hindsight 模板与用户定制">
    <p className="mb-3 text-xs text-text-secondary">预览后再应用。Native 原有行为是基础，Taki 模板提供补充，用户定制优先。移除 Taki 模板不会停用 Hindsight。</p>
    {!connectionReady && <p role="status" className="text-xs text-text-secondary">等待 Core 连接；恢复连接后读取原计划，不会重提变更。</p>}
    {state.error && <FeedbackLine tone="danger" action={{ label: "重试模板状态", onClick: () => void controller.refresh() }}>{state.error}</FeedbackLine>}
    {connectionReady && state.loading && <p role="status" className="text-xs text-text-secondary">正在读取模板状态…</p>}
    {frame && <div className="flex flex-col gap-3">
      <label className="text-xs text-text-body">模板管理范围<select aria-label="模板管理范围" disabled={!connectionReady || state.busyKey !== null} value={state.bankId ?? ""}
        className="ml-2 max-w-full rounded border border-border bg-surface p-2" onChange={(event) => controller.selectBank(event.target.value || null)}>
        <option value="">全部 Bank 与新 Bank 默认模板</option>
        {frame.authority.hindsight?.banks.filter((bank) => bank.nativeBankId !== null).map((bank) => <option key={bank.nativeBankId} value={bank.nativeBankId ?? ""}>
          {bank.scope === "global" ? "全局" : `角色 ${bank.characterId}`} · {bank.nativeBankId}</option>)}
      </select></label>
      {frame.template.bank && <div className="text-xs text-text-body"><p>管理记录：{frame.template.bank.enrollment === "managed" ? "已管理" : frame.template.bank.enrollment === "enrolled" ? "已记录原有配置" : "未接管，不能推断历史所有权"}</p>
        <p>已选择模板：{frame.template.bank.selected?.templateRevision === "none" ? "无 Taki 贡献" : frame.template.bank.selected?.templateRevision ?? "尚未选择"} · 已选择用户版本 {frame.template.bank.selected?.user.revision ?? "无"} · 最新用户版本 {frame.template.bank.latestUser?.revision ?? "无"}</p>
        {frame.template.bank.pending && <p>待完成的模板：{frame.template.bank.pending.templateRevision} · 用户版本 {frame.template.bank.pending.userRevision}</p>}
      </div>}
      {!frame.template.supported && <p className="text-xs text-text-secondary">当前运行时尚未确认模板管理支持；只有可用的实际预览才能核实当前实例。</p>}
      {state.draft && <TemplateEditor key={`${state.bankId ?? "defaults"}:${state.editorRevision}`} frame={frame} draft={state.draft} locked={locked}
        edit={(draft) => controller.edit(draft)} resourceEditing={(editing) => controller.setResourceEditing(editing)} />}
      {state.draftStale && <FeedbackLine tone="warn">其他操作已改变模板或用户版本。请重新载入草稿并核对，不能直接覆盖。</FeedbackLine>}
      {state.draft && state.draft.refresh.length > 0 && <div className="text-xs text-text-body"><p>本次拟生成：{state.draft.refresh.map((entry) => `${entry.bankId}：${entry.modelIds.join("、")}`).join("；")}</p>
        <ActionButton tone="link" disabled={locked} onClick={() => { if (state.draft) controller.edit({ ...state.draft, refresh: [] }); }}>清除本次生成请求</ActionButton></div>}
      <div className="flex flex-wrap gap-2"><ActionButton tone="primary" disabled={locked || state.draftStale || state.editorPending || !frame.template.previewAvailable}
        busy={state.previewLoading} onClick={() => void controller.preview()}>预览模板变更</ActionButton>
        <ActionButton tone="ghost" disabled={locked} onClick={() => controller.resetDraft()}>重新载入草稿</ActionButton></div>
      <TemplatePreview state={state} controller={controller} />
      {state.feedback && <FeedbackLine tone={state.feedback.tone}>{state.feedback.message}</FeedbackLine>}
      <TemplatePlan state={state} controller={controller} />
    </div>}
  </PageCard>;
}
