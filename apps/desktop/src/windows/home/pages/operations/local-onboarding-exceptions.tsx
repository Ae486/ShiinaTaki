/**
 * INPUT:  current-generation source diagnostics, per-source exclusion permissions and reason drafts
 * OUTPUT: bounded exception rows with explicit source-specific exclusion and pagination controls
 * POS:    ui/windows/home/pages/operations — presentation only; Core supplies admissibility and authenticated audit identity
 */
import { useId, useState } from "react";
import type { MemoryOnboardingExceptionsResult } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import type { LocalOnboardingView } from "./use-local-onboarding.ts";

export function LocalOnboardingExceptions({ onboarding, locked }: { onboarding: LocalOnboardingView; locked: boolean }) {
  if (!onboarding.status?.run) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="来源诊断">
      <p className="text-xs font-semibold text-text-strong">来源诊断</p>
      {onboarding.exceptionsError && <FeedbackLine tone="danger">来源诊断读取失败：{onboarding.exceptionsError}。请刷新状态后重试。</FeedbackLine>}
      {onboarding.exceptions?.items.length === 0 && <p className="text-xs text-text-secondary">当前没有来源异常。</p>}
      {onboarding.exceptions?.items.map((source) => (
        <ExceptionRow key={`${onboarding.status?.run?.runId}:${source.sourceId}`} source={source} onboarding={onboarding} locked={locked} />
      ))}
      {onboarding.exceptions?.nextCursor && (
        <ActionButton disabled={locked || !!onboarding.exceptionsError} busy={onboarding.busyKey === "exceptions"} onClick={() => void onboarding.loadMore()}>
          加载更多来源
        </ActionButton>
      )}
    </section>
  );
}

function ExceptionRow({ source, onboarding, locked }: {
  source: MemoryOnboardingExceptionsResult["items"][number]; onboarding: LocalOnboardingView; locked: boolean;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <p className="break-all text-xs font-medium text-text-body">{source.relativePath ?? "来源路径不可用"}</p>
      <p className="break-words text-xs text-text-secondary">诊断：{source.code}</p>
      {source.canExclude ? (
        <>
          <label htmlFor={reasonId} className="text-xs text-text-body">排除此来源的理由</label>
          <textarea id={reasonId} value={reason} maxLength={512} rows={2} disabled={locked} placeholder="说明为何排除这个来源"
            onChange={(event) => setReason(event.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-xs text-text-body disabled:opacity-40" />
          <p className="text-xs text-text-secondary">该来源将不进入本次准备，原始文件仍保留。</p>
          <ActionButton tone="danger-soft" disabled={locked || !!onboarding.exceptionsError || !reason.trim()}
            busy={onboarding.busyKey === `exclude:${source.sourceId}`} onClick={() => void onboarding.exclude(source.sourceId, reason)}>
            排除此来源
          </ActionButton>
        </>
      ) : <p className="text-xs text-text-secondary">Core 当前不允许排除此来源。</p>}
      <details className="text-xs text-text-secondary"><summary className="cursor-pointer">来源标识</summary><p className="mt-1 break-all">{source.sourceId}</p></details>
    </div>
  );
}
