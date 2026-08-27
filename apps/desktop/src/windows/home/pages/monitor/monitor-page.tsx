/**
 * INPUT:  Home's disposable operator WsClient generation
 * OUTPUT: readable DSH-style Run list/trajectory monitor with filters, paging, live/reconnect and explicit inspector
 * POS:    ui/windows/home/pages/monitor — operator-only developer surface; no technical identifiers in primary rows
 */
import { useEffect, useMemo, useState } from "react";
import type { MonitorMode, RunInitiator, RunState } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { ActionButton } from "../../action-button.tsx";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorFilters, type MonitorViewState } from "./monitor-controller.ts";
import { groupTrajectoryRows, InspectorFields } from "./monitor-view.tsx";

const INITIATORS: Array<[RunInitiator, string]> = [
  ["primary", "Primary"], ["scheduled", "Scheduled Task"], ["heartbeat", "Heartbeat"],
  ["flush", "Maintenance"], ["subagent", "Subagent"], ["webhook", "Webhook"],
];
const STATES: Array<[RunState, string]> = [
  ["queued", "Queued"], ["running", "Running"], ["waiting", "Waiting"], ["recovering", "Recovering"],
  ["completed", "Completed"], ["failed", "Failed"], ["cancelled", "Cancelled"], ["skipped", "Skipped"],
  ["deadline_exceeded", "Deadline exceeded"], ["outcome_unknown", "Outcome unknown"],
];

function readableTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

// eslint-disable-next-line max-lines-per-function
export function MonitorPage() {
  const { client, status } = useHomeClient();
  const [view, setView] = useState<MonitorViewState>(INITIAL_MONITOR_STATE);
  const controller = useMemo(() => createMonitorController(setView), []);
  const [draft, setDraft] = useState<MonitorFilters>(INITIAL_MONITOR_STATE.filters);

  useEffect(() => {
    controller.bind(client);
    return () => controller.dispose();
  }, [client, controller]);

  const modeHint: Record<MonitorMode, string> = {
    DISABLED: "开发监控已关闭；Run 正确性证据仍由 Core 保留。",
    FEEDBACK_ONLY: "仅展示有界生命周期反馈。",
    FULL_LOCAL: "展示有界、脱敏的本地开发细节。",
  };

  return (
    <>
      <PageHeader title="运行监视" hint={`${modeHint[view.mode]} 这是只读开发面板。`} busy={view.loadingRuns || view.loadingTrajectory} />
      <PageBody>
        {view.error && <PageAlert>{view.error}</PageAlert>}
        {view.stale && <PageAlert>实时流已落后，正在从 durable cursor 重新读取。</PageAlert>}
        {view.mode === "DISABLED" ? <PageCard title="监控未启用"><p className="text-xs text-slate-500">请在 Core 配置中启用 FEEDBACK_ONLY 或 FULL_LOCAL。</p></PageCard> : (
          <>
            <PageCard title="筛选" action={<ActionButton tone="primary" onClick={() => void controller.applyFilters(draft)} disabled={view.loadingRuns}>应用</ActionButton>}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs text-slate-500">搜索
                  <input value={draft.text} maxLength={100} onChange={(event) => setDraft((prev) => ({ ...prev, text: event.target.value }))} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700" placeholder="触发器 / 摘要" />
                </label>
                <label className="text-xs text-slate-500">发起方
                  <select value={draft.initiator} onChange={(event) => setDraft((prev) => ({ ...prev, initiator: event.target.value as RunInitiator | "" }))} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700">
                    <option value="">全部</option>{INITIATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500">状态
                  <select value={draft.state} onChange={(event) => setDraft((prev) => ({ ...prev, state: event.target.value as RunState | "" }))} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-700">
                    <option value="">全部</option>{STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
            </PageCard>
            <PageCard title="Runs" action={view.nextCursor ? <ActionButton onClick={() => void controller.loadOlderRuns()} disabled={view.loadingRuns}>加载更早记录</ActionButton> : undefined}>
              <div className="flex flex-col gap-2">
                {view.runs.map((run) => <button key={run.key} type="button" aria-pressed={run.key === view.selectedRunKey} className={`rounded-lg border p-3 text-left ${run.key === view.selectedRunKey ? "border-rose-300 bg-rose-50" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => void controller.select(run.key)}>
                  <p className="text-sm font-medium text-slate-800">{run.title}</p>
                  <p className="text-xs text-slate-500">角色：{run.characterId} · {run.initiatorLabel} · {run.triggerLabel} · {run.deliveryLabel}</p>
                  <p className="mt-1 text-xs text-slate-500">{run.outcome ? `${run.state} / ${run.outcome}` : run.state} · {readableTime(run.queuedAt)} · {run.attemptCount} attempts / {run.effectCount} effects</p>
                </button>)}
                {!view.loadingRuns && view.runs.length === 0 && <p className="text-xs text-slate-400">没有符合条件的 Run。</p>}
              </div>
            </PageCard>
            {view.trajectory && <PageCard title={`轨迹 · ${view.trajectory.run.title}`} action={view.trajectory.hasMore ? <ActionButton onClick={() => void controller.loadMoreTrajectory()} disabled={view.loadingTrajectory}>加载更多</ActionButton> : undefined}>
              <div className="flex flex-col gap-2">
                {groupTrajectoryRows(view.trajectory.rows).map((group) => <section key={group.key} aria-label={group.label} className="flex flex-col gap-1.5"><h3 className="text-xs font-semibold text-slate-500">{group.label}</h3>{group.rows.map((row) => <button key={row.rowKey} type="button" className="rounded border border-slate-100 p-2 text-left hover:bg-slate-50" onClick={() => void controller.inspect(row.rowKey)}>
                  <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-700">{row.label}</p><span className="text-[11px] text-slate-400">{row.surface}</span></div>
                  <LabeledRows rows={[{ label: "阶段", value: row.phase }, { label: "状态", value: row.outcome ? `${row.status} / ${row.outcome}` : row.status }, ...(row.contextLabel ? [{ label: "上下文", value: row.contextLabel }] : []), ...(row.kind === "attempt" ? [{ label: "Attempt", value: String(row.attemptOrdinal) }] : []), ...(row.kind === "effect" ? [{ label: "Effect", value: row.effectKind }] : []), { label: "时间", value: readableTime(row.occurredAt) }, ...(row.summary ? [{ label: "摘要", value: row.summary }] : []), ...(row.errorReason ? [{ label: "原因", value: row.errorReason }] : [])]} />
                </button>)}</section>)}
                {view.trajectory.rows.length === 0 && <p className="text-xs text-slate-400">该 Run 暂无轨迹事件。</p>}
              </div>
            </PageCard>}
            {view.inspector && <PageCard title={`开发检查器 · ${view.inspector.title}`}><p className="mb-3 text-xs text-slate-500">{view.inspector.redactionNotice}</p><InspectorFields inspector={view.inspector} /></PageCard>}
          </>
        )}
        <p className="text-xs text-slate-400">连接：{status.kind}{view.loadingInspector ? " · 检查器读取中…" : ""}</p>
      </PageBody>
    </>
  );
}
