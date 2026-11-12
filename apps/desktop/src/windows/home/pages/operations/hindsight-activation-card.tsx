/**
 * INPUT:  the Hindsight activation hook's Core-owned status, disposable read/action state and explicit actions
 * OUTPUT: guided setup -> 启用 Hindsight -> progress -> 继续 / 恢复运行时 with separate authority and runtime facts
 * POS:    ui/windows/home/pages/operations — existing Home primitives; no mutation occurs from rendering this card
 */
import type { MemoryActivationStatus } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { ACTIVATION_ACTION_LABEL, activationActionAllowed, activationBusyKey, type ActivationAction } from "./hindsight-activation-actions.ts";
import { activationBankRows, activationBlockingLines, activationDiagnostics, activationFacts, activationGuidance, activationHeadline } from "./hindsight-activation-state.ts";
import type { HindsightActivationView } from "./use-hindsight-activation.ts";

const ACTIONS = Object.keys(ACTIVATION_ACTION_LABEL) as ActivationAction[];
const TONE: Record<ActivationAction, "primary" | "secondary" | "ghost"> = {
  validate: "secondary", apply: "secondary", activate: "primary", resume: "primary", recoverBinding: "primary", cancel: "ghost",
};

export function HindsightActivationCard({ activation }: { activation: HindsightActivationView }) {
  const { status, loading, error, connectionReady } = activation;
  const locked = !connectionReady || loading || error !== null || activation.busyKey !== null;
  return (
    <PageCard title="启用 Hindsight">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">从已启用的本地记忆切换到现有 Hindsight 实例。</p>
          <ActionButton tone="ghost" disabled={!connectionReady || loading} busy={loading && status !== null} onClick={() => void activation.refresh()}>刷新状态</ActionButton>
        </div>
        {!connectionReady && <FeedbackLine tone="warn">连接恢复后将重新读取 Core 状态。</FeedbackLine>}
        {error && <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void activation.refresh() }}>状态读取失败：{error}</FeedbackLine>}
        {loading && status && <p className="text-xs text-text-secondary">正在等待最新状态，操作暂不可用。</p>}
        {status ? <ActivationBody status={status} activation={activation} locked={locked} />
          : connectionReady && loading ? <Skeleton lines={4} /> : <p className="text-xs text-text-secondary">暂无可用的启用状态。</p>}
        {activation.feedback && <FeedbackLine tone={activation.feedback.tone}>{activation.feedback.message}</FeedbackLine>}
      </div>
    </PageCard>
  );
}

function ActivationBody({ status, activation, locked }: { status: MemoryActivationStatus; activation: HindsightActivationView; locked: boolean }) {
  const guidance = activationGuidance(status);
  return (
    <>
      <p className="text-sm font-semibold text-text-strong">{activationHeadline(status)}</p>
      <LabeledRows rows={activationFacts(status)} />
      {status.operation?.state === "outcome_unknown" ? <FeedbackLine tone="warn">{guidance}</FeedbackLine> : <p className="text-xs text-text-secondary">{guidance}</p>}
      <BankPrerequisites status={status} />
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((action) => activationActionAllowed(status, action)).map((action) => (
          <ActionButton key={action} tone={TONE[action]} disabled={locked} busy={activation.busyKey === activationBusyKey(status, action)}
            onClick={() => void activation.execute(action)}>{ACTIVATION_ACTION_LABEL[action]}</ActionButton>
        ))}
      </div>
      <details className="text-xs text-text-secondary">
        <summary className="cursor-pointer">技术诊断</summary>
        <div className="mt-2 break-all"><LabeledRows rows={activationDiagnostics(status)} /></div>
      </details>
    </>
  );
}

function BankPrerequisites({ status }: { status: MemoryActivationStatus }) {
  const banks = activationBankRows(status);
  const blocking = activationBlockingLines(status);
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <p className="mb-2 text-xs font-semibold text-text-strong">Bank 前置条件</p>
      {banks.length > 0 ? <LabeledRows rows={banks} /> : <p className="text-xs text-text-secondary">尚无本地 Bank 记录。</p>}
      {blocking.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-text-body">
          {blocking.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}
