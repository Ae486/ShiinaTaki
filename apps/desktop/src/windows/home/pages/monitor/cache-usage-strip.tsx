/**
 * INPUT: a typed coherent cache/latest-request view, transport availability and deliberate read retry.
 * OUTPUT: compact cache-window status plus latest-request occupancy/composition with honest coverage and freshness.
 * POS: ui/monitor — overall usage strip below policy and above the Run workspace; Core owns measurement and reset.
 */
import type { CacheUsageWindowSnapshot } from "@taki/shared";
import type { CacheUsageView } from "./cache-usage-controller.ts";
import css from "./cache-usage-strip.module.css";
import { RequestContextStrip } from "./request-context-strip.tsx";

type CacheUsageStripProps = { view: CacheUsageView; connected: boolean; retry: () => void };
const FORMULA = "输入缓存命中率 = 有效请求的缓存读取令牌总数 ÷ 同一批请求的输入令牌总数；包含已记录的对话与后台请求，不随所选运行或筛选改变。";

export function CacheUsageStrip({ view, connected, retry }: CacheUsageStripProps) {
  const snapshot = view.snapshot;
  const stale = view.phase === "stale" || view.phase === "refreshing" || view.phase === "error";
  const retryable = view.phase === "error" || snapshot?.reason === "read-failed" || view.latestPrimaryRequest?.reason === "read-failed";
  return <div className={css.group}><section className={css.strip} aria-label="整体输入缓存命中率" title={FORMULA}>
    <div className={css.metric}>
      <span className={css.label}>输入缓存命中率</span>
      <strong className={css.ratio}>{snapshot?.status === "ready" && snapshot.ratio !== null
        ? `${(snapshot.ratio * 100).toFixed(1)}%` : "--"}</strong>
      <span>{snapshot?.summaryRevision === 0 ? "首次摘要前" : "本次摘要以来"}</span>
    </div>
    <div className={css.coverage}>
      <span>包含对话与后台请求</span>
      <span>{coverageLabel(snapshot)}</span>
    </div>
    <div className={css.status} role="status">
      <span>{statusLabel(view)}</span>
      {snapshot && <time dateTime={snapshot.computedAt}>更新于 {formatTime(snapshot.computedAt)}</time>}
      {stale && snapshot && <span className={css.stale}>上次结果已过期</span>}
      <span className={css.retrySlot}>{retryable && <button type="button" onClick={retry}
        disabled={!connected || view.phase === "refreshing"}>重试</button>}</span>
    </div>
  </section><RequestContextStrip view={view} /></div>;
}

function coverageLabel(snapshot: CacheUsageWindowSnapshot | null): string {
  if (!snapshot || snapshot.status === "unavailable") return "有效缓存数据未知";
  return `有效缓存数据 ${snapshot.pairedRequests} / ${snapshot.observedRequests} 次请求`;
}

function statusLabel(view: CacheUsageView): string {
  if (view.phase === "disabled") return "运行监视未启用";
  if (view.error) return view.error;
  if (!view.snapshot) return view.phase === "loading" ? "正在读取统计…" : "等待连接恢复";
  if (view.snapshot.status === "empty") return "暂无有效数据";
  switch (view.snapshot.reason) {
    case "boundary-unknown": return "摘要统计边界未知";
    case "data-inconsistent": return "统计数据不一致";
    case "read-failed": return "缓存统计读取失败";
    case "monitor-disabled": return "运行监视未启用";
    default: return "";
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
