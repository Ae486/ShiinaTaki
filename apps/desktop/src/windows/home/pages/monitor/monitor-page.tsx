/**
 * INPUT:  Home's current client/visibility generation and disposable Monitor controller state
 * OUTPUT: the full-height Run browser, DSH trajectory workspace, and explicit connection/read states
 * POS:    ui/monitor — Monitor alone owns its page scroll geometry; see third-party-notices.md (DeepSeek MIT)
 */
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { connectionKindLabel, monitorModeLabel } from "./monitor-labels.ts";
import { MonitorRunBrowser } from "./monitor-run-browser.tsx";
import { TrajectoryWorkspace } from "./trajectory-workspace.tsx";
import { useMonitorController } from "./use-monitor-controller.ts";
import css from "./monitor-workspace.module.css";
import type { ReactNode } from "react";
import { InitiativePolicyDiagnostics } from "@/features/initiative-patterns/initiative-policy-diagnostics.js";

export function MonitorPage() {
  const monitor = useMonitorController();
  return <MonitorWorkspace {...monitor} policy={<InitiativePolicyDiagnostics enabled={monitor.view.mode !== "DISABLED"} />} />;
}

interface MonitorWorkspaceProps {
  view: MonitorViewState;
  controller: MonitorController;
  connectionKind: string;
  visible: boolean;
  policy?: ReactNode;
}

export function MonitorWorkspace({ view, controller, connectionKind, visible, policy }: MonitorWorkspaceProps) {
  return <section className={css.root} aria-label="运行监视">
    {policy}
    {view.error && <div className={css.notice} role="alert"><span>{view.error}</span>
      <button type="button" onClick={() => void (view.retryRunKey ? controller.select(view.retryRunKey) : controller.refresh())}>
        {view.retryRunKey ? "重试切换" : "重试"}
      </button>
    </div>}
    <div className={css.workspace}>
      {view.mode === "DISABLED" ? <div className={css.empty} role="status">
        <strong>{view.loadingRuns ? "正在读取运行监视…" : "运行监视未启用"}</strong>
        {!view.loadingRuns && <span>可在设置中开启运行监视。</span>}
      </div> : <>
        <MonitorRunBrowser view={view} controller={controller} active={visible} />
        <TrajectoryWorkspace key={view.selectedRunKey ?? "none"} view={view} controller={controller} active={visible} />
      </>}
    </div>
    <footer className={css.footer} aria-label="监视状态">
      <span>{connectionKindLabel(connectionKind)}</span>
      <span className={css.readStatus}><span role="status">{monitorReadStatus(view)}</span>
        <PendingIndicator active={visible && (view.loadingRuns || view.loadingTrajectory || view.recovering || view.refreshingSummary)}
          label={monitorPendingLabel(view)} />
      </span>
      <span>{monitorModeLabel(view.mode)} · 只读</span>
    </footer>
  </section>;
}

function monitorReadStatus(view: MonitorViewState): string {
  if (view.stale) return "当前为上次读取的记录";
  if (view.trajectory) return `已载入 ${view.trajectory.rows.length} 条记录`;
  if (view.loadingTrajectory) return "正在载入轨迹…";
  if (view.loadingRuns && view.runs.length === 0) return "正在读取运行记录…";
  return "";
}

function monitorPendingLabel(view: MonitorViewState): string {
  if (view.loadingTrajectory) return "正在载入所选运行的轨迹";
  if (view.recovering) return "正在补读记录";
  if (view.refreshingSummary) return "正在更新统计";
  return "正在读取运行记录";
}
