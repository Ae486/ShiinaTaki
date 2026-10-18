/**
 * INPUT:  original Core operation/plan, publication facts and a separately requested child observation
 * OUTPUT: partial/recovery/runtime/derived presentation without reinterpreting historical records as live success
 * POS:    ui/operations — recovery controls use only Core-advertised original plan identity
 */
import { ActionButton } from "../../action-button.tsx";
import type { TemplatesController, TemplatesState } from "./hindsight-template-controller.ts";
import { TEMPLATE_CHILD_LABEL, TEMPLATE_ERROR_LABEL, TEMPLATE_PHASE_LABEL, derivedNotice } from "./hindsight-template-state.ts";

export function TemplatePlan({ state, controller }: { state: TemplatesState; controller: TemplatesController }) {
  const frame = state.frame; const plan = frame?.template.plan;
  if (!frame || !plan) return <p className="text-xs text-text-secondary">尚无模板变更计划。</p>;
  const result = frame.original?.result?.kind === "template" ? frame.original.result : null;
  const locked = state.loading || !!state.error || state.busyKey !== null;
  return <div className="rounded border border-border-subtle p-3 text-xs text-text-body" role="region" aria-label="原模板计划状态">
    <h3 className="mb-2 font-semibold">原计划 · {TEMPLATE_PHASE_LABEL[plan.phase]}</h3>
    <p>Native 已确认：{plan.banks.filter((bank) => bank.receiptHash !== null).length} / {plan.banks.length} 个 Bank</p>
    <p>Core 选择发布：{plan.publicationId ? "已发布" : "尚未发布"} · 当前记忆运行时：{frame.authority.runtime.available ? "可用" : "不可用"}</p>
    <p>{plan.hold === "active" ? "原计划仍占用记忆变更通道；请观察或恢复该计划。" : plan.hold === "quarantined" ? "原计划已隔离，不能自动重新激活。" : plan.hold === "cancelled" ? "该计划已取消。" : "该计划的选择已经发布。"}</p>
    {result && <p>原操作记录：{OUTCOME_LABEL[result.outcome]}（{result.appliedBanks} / {result.totalBanks}）</p>}
    {plan.errorCode && <p className="mt-1 text-danger">{TEMPLATE_ERROR_LABEL[plan.errorCode]}</p>}
    <div className="my-2 flex gap-2"><ActionButton disabled={locked || frame.template.recoverPlanId === null} busy={state.busyKey === "template:recover"}
      onClick={() => void controller.recover()}>恢复原模板计划</ActionButton>
      <ActionButton tone="ghost" disabled={state.loading || state.busyKey !== null} onClick={() => void controller.refresh()}>刷新原计划状态</ActionButton></div>
    {frame.template.recoverUnavailableReason && <p className="text-text-secondary">{RECOVERY_LABEL[frame.template.recoverUnavailableReason]}</p>}
    {plan.banks.map((bank) => <div key={bank.bank.target.bank_id} className="mt-3 border-t border-border-subtle pt-2">
      <p className="font-medium">{bank.bank.scope === "global" ? "全局" : "角色"} · {bank.bank.target.bank_id}</p>
      <p>{bank.receiptHash ? "Native 配置已确认" : bank.dispatched ? "已发出请求，结果尚未确认" : "尚未发出请求"} · {bank.selectionRevision ? `选择版本 ${bank.selectionRevision}` : "未发布选择"}</p>
      {bank.derived.length === 0 ? <p className="text-text-secondary">本计划未记录生成任务；不能据此判断已有内容是否新鲜。</p>
        : bank.derived.map((child) => <div key={child.childId} className="my-2 rounded bg-surface-sunken p-2">
          <p>{child.modelId} · 应用时记录：{TEMPLATE_CHILD_LABEL[child.state]} · {child.observedAt ?? "当时未观测"}</p>
          <p className="text-text-secondary">这是历史记录，不代表当前生成进度。</p>
          <ActionButton disabled={locked || state.derivedLoading} busy={state.derivedLoading && state.child?.childId === child.childId}
            onClick={() => void controller.observeChild({ planId: plan.planId, bankId: bank.bank.target.bank_id, childId: child.childId })}>读取当前生成结果</ActionButton>
          {state.child?.childId === child.childId && <p role="status" className="mt-1">{state.derivedLoading ? "正在读取当前结果…" : state.derivedError
            ?? (state.derived ? derivedNotice(state.derived) : "尚未读取当前结果")}</p>}
        </div>)}
    </div>)}
    <details className="mt-2 text-text-secondary"><summary>原操作标识</summary><p className="break-all">计划 {plan.planId} · 原操作 {plan.originalOperationId}</p></details>
  </div>;
}

const OUTCOME_LABEL = { bound: "当次执行已完成绑定", binding_unavailable: "选择已发布，绑定尚未完成", partial: "部分 Bank 已应用",
  outcome_unknown: "结果未知", cancelled: "已取消", quarantined: "已隔离" } as const;
const RECOVERY_LABEL = { no_plan: "暂无可恢复计划。", busy: "其他操作正在占用通道。", active: "执行者仍在运行，请继续观察。",
  already_bound: "Core 已确认该计划完成绑定，无需恢复。", cancelled: "已取消的计划不能恢复。",
  quarantined: "隔离计划不能恢复。", stale: "当前身份已变化，不能按旧计划恢复。", unavailable: "暂不能恢复，请刷新并核对连接。" } as const;
