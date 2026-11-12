/**
 * INPUT: latest-primary facts from the coherent aggregate subscription and its connection/read phase.
 * OUTPUT: honest input/window occupancy, requested/response model labels and estimated composition.
 * POS: ui/monitor — latest completed primary request, independent of the cumulative cache window and selected Run.
 */
import type { CacheUsageView } from "./cache-usage-controller.ts";
import { latestRequestStatus, requestOccupancy, formatCount, formatPercent } from "./request-composition-display.ts";
import { RequestCompositionView } from "./request-composition.tsx";
import css from "./request-context.module.css";

type RequestContextStripProps = { view: CacheUsageView };
export function RequestContextStrip({ view }: RequestContextStripProps) {
  const snapshot = view.latestPrimaryRequest;
  const request = snapshot?.request ?? null;
  const occupancy = requestOccupancy(request);
  const status = latestRequestStatus(snapshot);
  return <section className={css.root} aria-label="最新主对话请求上下文">
    <div className={css.header}>
      <div className={css.metric}><span className={css.label}>最新请求输入占用</span>
        <strong className={css.value}>{occupancy.value}</strong>
        <span className={css.percent}>{formatPercent(occupancy.ratio)}</span>
        <span>{occupancy.basis}</span>
      </div>
      {request && <div className={css.identity}>
        <span className={css.model} title={`请求模型：${request.provider} / ${request.modelId}`}>{request.modelId}</span>
        {request.responseModelId && request.responseModelId !== request.modelId
          && <span className={css.model} title={`响应模型：${request.responseModelId}`}>响应模型：{request.responseModelId}</span>}
        {request.stepNumber !== null && <span>循环第 {request.stepNumber + 1} 步</span>}
        <span>{outcomeLabel(request.outcome)}</span>
        <time dateTime={request.completedAt}>完成于 {new Date(request.completedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time>
      </div>}
    </div>
    <div className={css.scope}>仅最新主对话请求 · 按请求完成更新 · 与上方摘要以来的缓存统计范围不同</div>
    {request?.window && <details className={css.window}><summary>有效窗口依据</summary>
      <span>请求发送时捕获的运行配置 / 溢出调整窗口：声明 {formatCount(request.window.declaredRealTokens)} tokens，
        有效 {formatCount(request.window.effectiveRealTokens)} tokens；此值不证明自定义端点的硬上限。</span>
    </details>}
    {status && <div className={css.notice} role="status">{!snapshot ? pendingRequestStatus(view.phase, status) : status}</div>}
    {request && (view.phase === "stale" || view.phase === "refreshing" || view.phase === "error")
      && <div className={css.notice} role="status">最新请求统计为上次结果 · 等待恢复</div>}
    <RequestCompositionView composition={request?.composition ?? null} />
  </section>;
}

function outcomeLabel(outcome: string): string {
  if (outcome === "completed") return "已完成";
  if (outcome === "cancelled") return "已取消";
  if (outcome === "failed") return "请求失败";
  if (outcome === "deadline_exceeded") return "请求超时";
  if (outcome === "outcome_unknown") return "请求结果未知";
  if (outcome === "reconciliation_required") return "请求结果待核对";
  return "请求已结束";
}

function pendingRequestStatus(phase: CacheUsageView["phase"], fallback: string): string {
  if (phase === "loading") return "正在读取请求统计…";
  if (phase === "stale") return "等待连接恢复后读取请求统计";
  if (phase === "disabled") return "运行监视未启用";
  return fallback;
}
