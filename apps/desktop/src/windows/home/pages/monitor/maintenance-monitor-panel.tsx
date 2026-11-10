/**
 * INPUT: read-only background operation summaries and proved model-call details
 * OUTPUT: distinct maintenance list, progress and request usage without normal cache/occupancy metrics
 * POS: ui/monitor — existing compact Monitor visual language; opaque correlation stays internal
 */
import type { MaintenanceMonitorSummary, AuxiliaryModelCall } from "@taki/shared";
import type { MaintenanceMonitorController, MaintenanceMonitorView } from "./maintenance-monitor-controller.ts";
import css from "./maintenance-monitor.module.css";

const STATUS: Record<MaintenanceMonitorSummary["status"], string> = {
  running: "进行中", completed: "已完成", partial: "部分完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
};
const FAILURE: Record<NonNullable<MaintenanceMonitorSummary["failure"]>, string> = {
  timeout: "处理超时，已保存的进度仍保留。", "tool-errors": "仍有操作未能完成。", "review-stale": "整理依据已变化。",
  unfinished: "尚未完成最终确认。", "input-too-large": "输入超过本批预算，请检查整理设置。", "execution-failed": "执行失败，请检查配置后重试。",
  "source-changed": "原始内容已变化，本次摘要未采用。", "summary-failed": "摘要生成未能完成。", interrupted: "任务已中断，完整结果尚未确认。",
};
const kindLabel = (row: MaintenanceMonitorSummary) => row.ref.kind === "tidy" ? "记忆整理" : "上下文压缩";

export function MaintenanceMonitorPanel({ view, controller }: { view: MaintenanceMonitorView; controller: MaintenanceMonitorController }) {
  const snapshot = view.snapshot;
  const detail = snapshot?.detail;
  return <section className={css.panel} aria-label="后台维护监控">
    <header className={css.header}><strong>后台维护</strong><span>调用用量单独展示，不计入常规缓存命中率与输入占用。</span>
      <button type="button" onClick={controller.retry} disabled={view.phase === "loading"}>刷新</button>
    </header>
    {view.phase === "disabled" ? <p className={css.empty}>运行监视未启用。</p> : <>
      <div role="status" className={css.notice}>{view.error ?? (view.phase === "loading" ? "正在读取后台维护记录…"
        : view.phase === "stale" ? "当前为上次读取的记录，等待连接恢复。" : "")}</div>
      <div className={css.workspace}>
        <aside className={css.list} aria-label="后台维护任务">
          {snapshot?.rows.map((row) => <button type="button" key={`${row.ref.kind}:${row.ref.operationId}`}
            className={detail?.operation.ref.operationId === row.ref.operationId ? css.selected : ""}
            onClick={() => controller.select(row.ref)}>
            <span><strong>{kindLabel(row)}</strong><span>{STATUS[row.status]}</span></span>
            <time dateTime={row.startedAt}>{time(row.startedAt)}</time>
          </button>)}
          {snapshot?.rows.length === 0 && <p className={css.empty}>暂无后台维护记录。</p>}
          <div className={css.paging}><button type="button" onClick={() => controller.latest()}>最新记录</button>
            <button type="button" disabled={!snapshot?.nextCursor || view.phase === "loading"} onClick={() => controller.older()}>较早记录</button></div>
        </aside>
        <div className={css.detail}>{detail ? <>
          <header className={css.detailHeader}><strong>{kindLabel(detail.operation)}</strong><span>{STATUS[detail.operation.status]}</span></header>
          <dl className={css.facts}>
            <dt>开始时间</dt><dd>{time(detail.operation.startedAt)}</dd>
            <dt>总历时</dt><dd>{duration(detail.operation.startedAt, detail.operation.finishedAt)}</dd>
            {detail.operation.attempt !== undefined && <><dt>尝试次数</dt><dd>{detail.operation.attempt}</dd></>}
            {detail.operation.progress && <>
              <dt>已检查 / 待检查</dt><dd>{detail.operation.progress.reviewed ?? "未知"} / {detail.operation.progress.remaining ?? "未知"} 条</dd>
              <dt>已保存改动</dt><dd>{detail.operation.progress.edits} 处</dd>
              <dt>执行步骤</dt><dd>{detail.operation.progress.steps}</dd>
            </>}
            <dt>已关联模型调用</dt><dd>{detail.association === "linked" ? `${detail.calls.totalCalls} 次` : "尚无可确认的调用关联"}</dd>
            <dt>已知输入 / 输出</dt><dd>{tokens(detail.calls.tokenCounts.inputTokens.sum)} / {tokens(detail.calls.tokenCounts.outputTokens.sum)}</dd>
            {detail.association === "linked" && <><dt>用量记录覆盖</dt><dd>输入 {detail.calls.tokenCounts.inputTokens.knownCount} / {detail.calls.totalCalls} 次；输出 {detail.calls.tokenCounts.outputTokens.knownCount} / {detail.calls.totalCalls} 次</dd></>}
          </dl>
          {detail.operation.failure && <p role="status">{FAILURE[detail.operation.failure]}</p>}
          <p className={css.hint}>仅统计明确关联到本任务的模型调用；历史记录缺少关联或用量时显示未知。</p>
          <table className={css.calls}><thead><tr><th>模型调用</th><th>状态</th><th>历时</th><th>输入 / 输出 token</th></tr></thead>
            <tbody>{detail.calls.rows.map((call) => <CallRow key={call.callId} call={call} />)}</tbody></table>
          {detail.calls.nextCursor && <button type="button" disabled={view.phase === "loading"} onClick={() => controller.olderCalls()}>更早的模型调用</button>}
        </> : <p className={css.empty}>选择任务查看进度与模型调用。</p>}</div>
      </div>
    </>}
  </section>;
}

function CallRow({ call }: { call: AuxiliaryModelCall }) {
  const status = { started: "进行中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" }[call.status];
  return <tr><td><strong>{call.modelId}</strong><small>{time(call.startedAt)}</small></td><td>{status}</td>
    <td>{duration(call.startedAt, call.finishedAt)}</td><td>{tokens(call.usage.inputTokens)} / {tokens(call.usage.outputTokens)}</td></tr>;
}
function tokens(value: number | null): string { return value === null ? "未知" : value.toLocaleString("zh-CN"); }
function time(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function duration(start: string, end: string | null): string {
  return end === null ? "尚未结束" : `${Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000).toFixed(1)} 秒`;
}
