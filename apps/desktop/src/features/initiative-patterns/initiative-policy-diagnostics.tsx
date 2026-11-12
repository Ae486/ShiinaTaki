/**
 * INPUT: Core-produced bounded pre-admission reason/counter projection on the existing Monitor.
 * OUTPUT: compact collapsible semantic diagnostics with actual counts and retryable last-good state.
 * POS: Monitor adjunct; no raw IDs/cursors, fake zeroes or parallel monitoring surface.
 */
import { ActionButton } from "@/windows/home/action-button.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { useInitiativePolicy } from "./use-initiative-policy.ts";
import { WAKE_REASON_LABELS, WAKE_SOURCE_LABELS } from "./initiative-wake-labels.ts";
import { readablePatternDate } from "./pattern-labels.ts";
import { useInitiativeBackoff } from "./use-initiative-backoff.ts";
import { InitiativeBackoffView } from "./initiative-backoff-view.tsx";

export function InitiativePolicyDiagnostics({ enabled }: { enabled: boolean }) {
  const { state, refresh } = useInitiativePolicy(enabled);
  const backoff = useInitiativeBackoff(enabled);
  if (!enabled) return null;
  return <details className="shrink-0 border-b border-border bg-surface px-3 py-2">
    <summary className="cursor-pointer text-xs font-medium">主动互动判断{state.stale && state.data ? " · 上次读取" : ""}</summary>
    <div className="mt-2 max-h-64 space-y-3 overflow-y-auto text-xs">
      <InitiativeBackoffView {...backoff} />
      <ActionButton busy={state.loading} onClick={refresh}>刷新判断记录</ActionButton>
      {state.error && <FeedbackLine tone="danger">{state.error}</FeedbackLine>}
      {!state.data && !state.error && <p>{state.loading ? "正在读取判断记录…" : "暂无可用判断记录。"}</p>}
      {state.data && <>
        <p className="text-text-secondary">自 {readablePatternDate(state.data.since, "未知")} 起的实际策略检查；未进入运行的机会也在此说明。</p>
        <dl className="grid grid-cols-2 gap-2">{state.data.counters.map((counter) => <div key={counter.reason}><dt>{WAKE_REASON_LABELS[counter.reason]}</dt><dd>{counter.count} 次</dd></div>)}</dl>
        {state.data.recent.length === 0 && <p>尚无最近判断记录。</p>}
        <ol className="space-y-2">{state.data.recent.map((event, index) => <li key={`${event.occurredAt}:${index}`}>
          <time>{readablePatternDate(event.occurredAt, "未知")}</time> · {WAKE_SOURCE_LABELS[event.source]} · {WAKE_REASON_LABELS[event.reason]} · 匹配 {event.matchedCount} 条
        </li>)}</ol>
      </>}
    </div>
  </details>;
}
