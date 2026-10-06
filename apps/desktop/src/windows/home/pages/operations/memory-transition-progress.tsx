/**
 * INPUT: one original operation with Core-projected transition progress and permissions.
 * OUTPUT: separate commit, runtime, Native/surviving evidence and queue facts plus explicit recovery/cancel.
 * POS: ui/operations — historical operations remain visible under Local or an unavailable target.
 */
import type { MemoryTransitionOverview } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows } from "../../page-card.tsx";
import { MEMORY_OPERATION_KIND_LABEL, MEMORY_OPERATION_STATE_LABEL } from "./memory-authority-state.ts";
import { transitionProgressRows, TRANSITION_REASON, TRANSITION_NATIVE_PHASE } from "./memory-transition-state.ts";
import { MemoryTransitionDisclosure } from "./memory-transition-disclosure.tsx";
import type { MemoryTransitionsView } from "./use-memory-transitions.ts";
type Props = { entry: MemoryTransitionOverview["entries"][number]; view: MemoryTransitionsView; locked: boolean };

export function MemoryTransitionProgress({ entry, view, locked }: Props) {
  const { operation, status } = entry;
  return <article className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
    <p className="text-xs font-semibold text-text-strong">{MEMORY_OPERATION_KIND_LABEL[operation.kind]} · {MEMORY_OPERATION_STATE_LABEL[operation.state]}</p>
    <LabeledRows rows={transitionProgressRows(status, entry.currentAuthority)} />
    <p className="text-xs text-text-secondary">意图已结算包含成功、拒绝或冲突；切换完成不代表每条写入成功。</p>
    {entry.emergency ? <MemoryTransitionDisclosure disclosure={entry.emergency} /> : <div className="text-xs text-text-body">
      {status.progress.banks.map((bank, index) => <p key={bank.sourceBankId}>Bank {index + 1}：原生阶段 {bank.nativePhase ? TRANSITION_NATIVE_PHASE[bank.nativePhase] : "未知"}；活动写入 {bank.activeWriters ?? "未知"}；已受理 {bank.acceptedOperations ?? "未知"}；最终证明{bank.finalProof ? "已取得" : "未取得"}</p>)}
    </div>}
    {operation.state === "outcome_unknown" && <p className="text-xs text-warning">结果未知；请观察原操作，不要把断线当作取消。</p>}
    {entry.recovery.reason && operation.state === "outcome_unknown" && <p className="text-xs text-text-secondary">{TRANSITION_REASON[entry.recovery.reason]}</p>}
    <div className="flex flex-wrap gap-2">
      {entry.cancel.allowed && <ActionButton disabled={locked} onClick={() => void view.cancel(operation.operationId)}>取消未认领操作</ActionButton>}
      {entry.recovery.allowed && <ActionButton disabled={locked} onClick={() => void view.openPreview(status.transition.intent.request.kind, status.transition.intent.transitionId)}>预览恢复原操作</ActionButton>}
    </div>
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">技术诊断</summary>
      <div className="mt-2 break-all"><LabeledRows rows={[{ label: "操作", value: operation.operationId },
        { label: "转换", value: status.transition.intent.transitionId }, { label: "提交凭据", value: status.transition.receipt?.receiptId ?? "无" },
        { label: "错误代码", value: operation.errorCode ?? "无" }, { label: "创建时间", value: operation.createdAt }]} /></div>
    </details>
  </article>;
}
