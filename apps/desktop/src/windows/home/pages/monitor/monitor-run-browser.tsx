/**
 * INPUT:  authorized Run summaries, retained selection, and bounded list/filter actions
 * OUTPUT: compact Chinese Run browser with a visible older selection and dismissible filter controls
 * POS:    ui/monitor — TakiAgent selection adapter around DSH's trajectory; see third-party-notices.md
 */
import { useId, useState } from "react";
import type { RunMonitorSummary } from "@taki/shared";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import { MonitorRunFilters } from "./monitor-run-filters.tsx";
import { formatRunTime, runMetricsLabel, wireLabel } from "./monitor-labels.ts";
import { formatDuration } from "./trajectory-timing.ts";
import css from "./monitor-workspace.module.css";

interface BrowserProps { view: MonitorViewState; controller: MonitorController; active: boolean }

export function MonitorRunBrowser({ view, controller, active }: BrowserProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = useId();
  const selected = view.trajectory?.run;
  const pinned = selected && !view.runs.some((run) => run.key === selected.key) ? selected : undefined;
  return <aside className={css.browser} aria-label="执行记录">
    <div className={css.browserHeader}><h1>执行记录</h1><div className={css.browserActions}>
      <button type="button" className={css.plainButton} aria-label="刷新执行记录" disabled={view.loadingRuns}
        aria-busy={view.loadingRuns} onClick={() => void controller.refresh()}>刷新
        <PendingIndicator active={active && view.loadingRuns} label="正在读取运行记录" />
      </button>
      <button type="button" className={css.plainButton} aria-expanded={filtersOpen} aria-controls={filterId}
        onClick={() => setFiltersOpen((open) => !open)}>筛选</button>
    </div></div>
    <div className={css.filterPanel} id={filterId} data-open={filtersOpen} inert={!filtersOpen} aria-hidden={!filtersOpen}>
      <div className={css.filterInner}><MonitorRunFilters filters={view.filters} pending={active && view.loadingRuns}
        apply={(filters) => void controller.applyFilters(filters)} /></div>
    </div>
    <div className={css.runList}>
      {pinned && <><p className={css.pinnedLabel}>当前查看</p><RunButton run={pinned} selected pending={active && pinned.key === view.requestedRunKey}
        onSelect={() => void controller.select(pinned.key)} /></>}
      {view.runs.map((run) => <RunButton key={run.key} run={run} selected={run.key === view.selectedRunKey}
        pending={active && run.key === view.requestedRunKey} onSelect={() => void controller.select(run.key)} />)}
      {view.runs.length === 0 && <div className={css.empty} role="status">
        {view.loadingRuns && !pinned ? "正在读取记录…" : "没有符合条件的运行"}
      </div>}
    </div>
    {view.nextCursor && <button type="button" className={css.loadRuns} disabled={view.loadingRuns}
      aria-busy={view.loadingRuns} onClick={() => void controller.loadOlderRuns()}>载入更早运行
      <PendingIndicator active={active && view.loadingRuns} label="正在载入更早运行" />
    </button>}
  </aside>;
}

function RunButton({ run, selected, pending, onSelect }: { run: RunMonitorSummary; selected: boolean; pending: boolean; onSelect(): void }) {
  const metrics = runMetricsLabel(run);
  return <button type="button" className={css.runButton} aria-pressed={selected} aria-busy={pending} onClick={onSelect}>
    <span className={css.runTitle}><span className={css.runName}>{run.title}</span>
      <span className={css.runState} data-state={run.outcome ?? run.state}>{wireLabel(run.outcome ?? run.state)}</span>
    </span>
    <span className={css.runModel}>{run.initiatorLabel}{run.provider ? ` · ${run.provider}` : ""}{run.modelId ? ` / ${run.modelId}` : ""}</span>
    <span className={css.runCounts} title={metrics}>{metrics}</span>
    <span className={css.runTime}><span>{formatRunTime(run.queuedAt)}{run.durationMs !== undefined ? ` · ${formatDuration(run.durationMs)}` : ""}</span>
      <PendingIndicator active={pending} label="正在载入所选运行的轨迹" />
    </span>
  </button>;
}
