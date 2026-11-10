/**
 * INPUT:  Home's current client/visibility generation and disposable Monitor controller state
 * OUTPUT: overall cache strip, full-height Run browser, DSH trajectory workspace and explicit read states
 * POS:    ui/monitor — Monitor alone owns its page scroll geometry; see third-party-notices.md (DeepSeek MIT)
 */
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { connectionKindLabel, monitorModeLabel } from "./monitor-labels.ts";
import { MonitorRunBrowser } from "./monitor-run-browser.tsx";
import { TrajectoryWorkspace } from "./trajectory-workspace.tsx";
import { useMonitorController } from "./use-monitor-controller.ts";
import css from "./monitor-workspace.module.css";
import { useState, type ReactNode } from "react";
import { InitiativePolicyDiagnostics } from "@/features/initiative-patterns/initiative-policy-diagnostics.js";
import { CacheUsageStrip } from "./cache-usage-strip.tsx";
import { useCacheUsage } from "./use-cache-usage.ts";
import { useMaintenanceMonitor } from "./use-maintenance-monitor.ts";
import { MaintenanceMonitorPanel } from "./maintenance-monitor-panel.tsx";

export function MonitorPage() {
  const [section, setSection] = useState<"runs" | "maintenance">("runs");
  const monitor = useMonitorController(section === "runs");
  const cache = useCacheUsage(monitor.view.mode, section === "runs");
  const maintenance = useMaintenanceMonitor(monitor.view.mode, section === "maintenance");
  return <MonitorWorkspace {...monitor} policy={<InitiativePolicyDiagnostics enabled={monitor.view.mode !== "DISABLED"} />}
    cache={<CacheUsageStrip {...cache} />} section={section} onSectionChange={setSection}
    maintenance={<MaintenanceMonitorPanel {...maintenance} />} />;
}

interface MonitorWorkspaceProps {
  view: MonitorViewState;
  controller: MonitorController;
  connectionKind: string;
  visible: boolean;
  policy?: ReactNode;
  cache?: ReactNode;
  maintenance?: ReactNode;
  section?: "runs" | "maintenance";
  onSectionChange?: (section: "runs" | "maintenance") => void;
}

export function MonitorWorkspace({ view, controller, connectionKind, visible, policy, cache, maintenance,
  section = "runs", onSectionChange }: MonitorWorkspaceProps) {
  return <section className={css.root} aria-label="运行监视">
    {onSectionChange && view.mode !== "DISABLED" && <nav className={css.sections} aria-label="监控链路">
      <button type="button" aria-pressed={section === "runs"} onClick={() => onSectionChange("runs")}>正常链路</button>
      <button type="button" aria-pressed={section === "maintenance"} onClick={() => onSectionChange("maintenance")}>后台维护</button>
    </nav>}
    {section === "runs" && policy}
    {section === "runs" && view.mode !== "DISABLED" && cache}
    {section === "runs" && view.error && <div className={css.notice} role="alert"><span>{view.error}</span>
      <button type="button" onClick={() => void (view.retryRunKey ? controller.select(view.retryRunKey) : controller.refresh())}>
        {view.retryRunKey ? "重试切换" : "重试"}
      </button>
    </div>}
    <div className={css.workspace}>
      {view.mode === "DISABLED" ? <div className={css.empty} role="status">
        <strong>{view.loadingRuns ? "正在读取运行监视…" : "运行监视未启用"}</strong>
        {!view.loadingRuns && <span>可在设置中开启运行监视。</span>}
      </div> : section === "maintenance" ? maintenance : <>
        <MonitorRunBrowser view={view} controller={controller} active={visible} />
        <TrajectoryWorkspace key={view.selectedRunKey ?? "none"} view={view} controller={controller} active={visible} />
      </>}
    </div>
    <footer className={css.footer} aria-label="监视状态">
      <span>{connectionKindLabel(connectionKind)}</span>
      <span className={css.readStatus}><span role="status">{section === "runs" ? monitorReadStatus(view) : "后台维护独立记录"}</span>
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
