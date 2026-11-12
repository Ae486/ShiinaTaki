/**
 * INPUT:  the Local onboarding hook's Core-owned status, preview, diagnostics and explicit actions
 * OUTPUT: guided preview/preparation/exclusion/recovery/activation with separate authority and runtime facts
 * POS:    ui/windows/home/pages/operations — existing Home primitives; no mutation occurs from rendering this card
 */
import type { MemoryOnboardingStatus, MemoryOperation } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { ONBOARDING_ACTION_LABEL, onboardingActionAllowed, type OnboardingAction } from "./local-onboarding-actions.ts";
import { LocalOnboardingExceptions } from "./local-onboarding-exceptions.tsx";
import { ONBOARDING_PHASE, onboardingHeadline, onboardingProgress } from "./local-onboarding-state.ts";
import type { LocalOnboardingView } from "./use-local-onboarding.ts";
import { MEMORY_RUNTIME_UNAVAILABLE_LABEL } from "./memory-authority-state.ts";

const OPERATION_STATE: Record<MemoryOperation["state"], string> = {
  admitted: "已受理，尚未开始", running: "执行中", waiting: "等待处理", completed: "已完成", failed: "失败", cancelled: "已取消", outcome_unknown: "结果未知",
};
const RUNTIME_REASON = MEMORY_RUNTIME_UNAVAILABLE_LABEL;
const ACTIONS = Object.keys(ONBOARDING_ACTION_LABEL) as OnboardingAction[];

export function LocalOnboardingCard({ onboarding }: { onboarding: LocalOnboardingView }) {
  const locked = !onboarding.connectionReady || onboarding.stale || onboarding.refreshing || onboarding.busyKey !== null;
  return (
    <PageCard title="本地记忆引导">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">无需配置 Hindsight 或向量服务。</p>
          <ActionButton tone="ghost" disabled={!onboarding.connectionReady || onboarding.loading || onboarding.refreshing}
            busy={onboarding.refreshing} onClick={() => void onboarding.refresh()}>刷新状态</ActionButton>
        </div>
        {!onboarding.connectionReady && <FeedbackLine tone="warn">连接恢复后将重新读取 Core 状态。</FeedbackLine>}
        {onboarding.error && <FeedbackLine tone="danger">状态读取失败：{onboarding.error}</FeedbackLine>}
        {onboarding.stale && onboarding.status && <p className="text-xs text-text-secondary">正在等待最新状态，操作暂不可用。</p>}
        {onboarding.status ? <OnboardingBody onboarding={onboarding} locked={locked} />
          : onboarding.connectionReady && onboarding.loading ? <Skeleton lines={4} /> : <p className="text-xs text-text-secondary">暂无可用的引导状态。</p>}
        {onboarding.feedback && <FeedbackLine tone={onboarding.feedback.tone}>{onboarding.feedback.message}</FeedbackLine>}
      </div>
    </PageCard>
  );
}

function OnboardingBody({ onboarding, locked }: { onboarding: LocalOnboardingView; locked: boolean }) {
  const status = onboarding.status;
  if (!status) return null;
  return (
    <>
      <p className="text-sm font-semibold text-text-strong">{onboardingHeadline(status)}</p>
      <OnboardingFacts status={status} />
      <OnboardingGuidance status={status} />
      <PreviewSummary onboarding={onboarding} />
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((action) => onboardingActionAllowed(status, action)).map((action) => (
          <ActionButton key={action} tone={action === "activate" ? "primary" : "secondary"}
            disabled={locked || ((action === "prepare" || action === "replace") && !onboarding.preview)}
            busy={onboarding.busyKey === action} onClick={() => void onboarding.execute(action)}>{ONBOARDING_ACTION_LABEL[action]}</ActionButton>
        ))}
      </div>
      <LocalOnboardingExceptions onboarding={onboarding} locked={locked} />
      <OnboardingDiagnostics status={status} />
    </>
  );
}

function OnboardingFacts({ status }: { status: MemoryOnboardingStatus }) {
  const progress = onboardingProgress(status);
  const mode = status.authority.mode === "canonical-local" ? "Canonical Local" : status.authority.mode === "hindsight" ? "Hindsight" : "Legacy Markdown";
  const runtime = status.runtime.available ? "可用" : `不可用：${RUNTIME_REASON[status.runtime.unavailableReason ?? "connection_unavailable"]}`;
  return <LabeledRows rows={[
    { label: "当前权威", value: mode }, { label: "当前运行时", value: runtime },
    ...(progress ? [{ label: "准备阶段", value: ONBOARDING_PHASE[progress.phase] },
      { label: "来源", value: `${progress.resolvedCount ?? "未知"} 已处理 / ${progress.sourceCount ?? "未知"} 总计 / ${progress.blockingCount ?? "未知"} 阻塞` }] : []),
    ...(status.operation ? [{ label: "最近操作", value: OPERATION_STATE[status.operation.state] }] : []),
    ...(status.custody.recoverableGroups > 0 ? [{ label: "待恢复来源组", value: String(status.custody.recoverableGroups) }] : []),
  ]} />;
}

function OnboardingGuidance({ status }: { status: MemoryOnboardingStatus }) {
  if (status.authority.mode === "canonical-local") {
    return <p className="text-xs text-text-secondary">{status.runtime.available
      ? "本地记忆运行时可用。可直接使用本地记忆；有待恢复来源时，请执行来源恢复。"
      : "本地权威已经生效。恢复运行时将使用已提交的同一份记录，不会再次启用或退回 Legacy。"}</p>;
  }
  if (status.authority.mode === "hindsight") return <p className="text-xs text-text-secondary">已有记忆权威，不提供新的本地引导。</p>;
  if (status.operation?.state === "outcome_unknown") return <FeedbackLine tone="warn">执行结果尚未确认。请读取最新状态，并使用 Core 提供的恢复操作。</FeedbackLine>;
  if (status.operation?.state === "running") return <p className="text-xs text-text-secondary">工作由 Core 继续执行，关闭页面不会中断。开始执行后不支持取消。</p>;
  if (status.run?.status === "ready") return <p className="text-xs text-text-secondary">准备完成尚未切换权威。点击“启用本地记忆”后，Core 会再次校验来源。</p>;
  return <p className="text-xs text-text-secondary">先预览当前工作区，再显式准备。原始文件与快照证据会保留；异常来源需逐项处理。</p>;
}

function PreviewSummary({ onboarding }: { onboarding: LocalOnboardingView }) {
  const preview = onboarding.preview;
  if (!preview) return null;
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <p className="mb-2 text-xs font-semibold text-text-strong">{preview.sourceCount === 0 ? "工作区为空，可准备本地记忆" : "来源预览"}</p>
      <LabeledRows rows={[{ label: "来源总数", value: String(preview.sourceCount) }, { label: "预计异常", value: String(preview.exceptional) },
        { label: "预计转换", value: `${preview.plannedZero} 空结果 / ${preview.plannedOne} 单条 / ${preview.plannedMany} 多条` }]} />
      {onboarding.status?.actions.replace && <p className="mt-2 text-xs text-text-secondary">重新准备将替换当前待启用记录，旧快照与原始文件仍保留。</p>}
    </div>
  );
}

function OnboardingDiagnostics({ status }: { status: MemoryOnboardingStatus }) {
  const operation = status.operation;
  return (
    <details className="text-xs text-text-secondary">
      <summary className="cursor-pointer">技术诊断</summary>
      <div className="mt-2 break-all"><LabeledRows rows={[
        { label: "读取时间", value: status.observedAt },
        { label: "Run", value: status.run?.runId ?? "无" }, { label: "Epoch", value: status.authority.epochId ?? "无" },
        { label: "快照", value: status.run?.snapshotId ?? "无" }, { label: "激活回执", value: status.run?.receipt?.transactionId ?? "无" },
        { label: "操作", value: operation?.operationId ?? "无" }, { label: "原因", value: operation?.reason ?? "无" },
        { label: "错误", value: operation?.errorCode ?? "无" },
      ]} /></div>
    </details>
  );
}
