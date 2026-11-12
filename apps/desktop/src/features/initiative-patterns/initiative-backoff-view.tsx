/**
 * INPUT: actual Core backoff evidence, read/mutation status and deliberate action callbacks.
 * OUTPUT: compact Chinese policy status with unknown values and an explicit reset control.
 * POS: existing Monitor policy card content; never derives frequency or counts in the browser.
 */
import type { InitiativeBackoffStatus } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import type { InitiativeBackoffState } from "./initiative-backoff-controller.ts";
import { readablePatternDate } from "./pattern-labels.ts";

const STAGES: Record<InitiativeBackoffStatus["stage"], string> = {
  normal: "正常（1 倍间隔）", double: "降低频率（2 倍间隔）", quadruple: "降低频率（4 倍间隔）", daily: "每天最多一次判断",
};
interface InitiativeBackoffViewProps {
  state: InitiativeBackoffState; available: boolean; refresh(): void; reset(): void;
}

export function InitiativeBackoffView({ state, available, refresh, reset }: InitiativeBackoffViewProps) {
  const data = state.data;
  return <section className="space-y-2 border-b border-border pb-3" aria-label="主动互动频率调整">
    <h3 className="font-medium">互动频率调整{data && state.stale ? " · 上次读取" : ""}</h3>
    <dl className="grid grid-cols-2 gap-2">
      <div><dt>当前阶段</dt><dd>{data ? STAGES[data.stage] : "未知"}</dd></div>
      <div><dt>最近七天有效未回应记录</dt><dd>{data ? `${data.qualifiedWeakCount} 次` : "未知"}</dd></div>
      <div><dt>当前日额度占用</dt><dd>{data ? `${data.dailyJudgments} 次判断` : "未知"}</dd></div>
      <div><dt>退避等待至</dt><dd>{data ? readablePatternDate(data.nextEligibleAt, "当前无退避等待") : "未知"}</dd></div>
    </dl>
    <p className="text-text-secondary">仅统计已展示且具备回应机会的互动，不代表已读。重置不会增加全局额度，也不表示相关事情已经解决。</p>
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={!available || state.pending || state.loading} busy={state.loading} onClick={refresh}>刷新退避状态</ActionButton>
      <ActionButton disabled={!available || state.pending || state.loading || state.stale || !data} busy={state.pending} onClick={reset}>重置互动退避</ActionButton>
    </div>
    {state.error && <FeedbackLine tone="danger">{state.error}</FeedbackLine>}
    {state.feedback && <FeedbackLine tone={state.feedback.tone}>{state.feedback.message}</FeedbackLine>}
  </section>;
}
