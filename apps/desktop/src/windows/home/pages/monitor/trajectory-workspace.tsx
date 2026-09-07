/**
 * INPUT:  one selected Run's disposable trajectory/Inspector view and local visibility
 * OUTPUT: compact Toolbar, fixed Overview, measured ledger, and temporary Inspector composition
 * POS:    ui/monitor — direct DSH TrajectoryView presentation port; see third-party-notices.md (DeepSeek MIT)
 */
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import { InspectorPane } from "./monitor-layout.tsx";
import { TrajectoryLedger } from "./trajectory-ledger.tsx";
import { recordMatches } from "./trajectory-layout.ts";
import { TrajectoryOverview } from "./trajectory-overview.tsx";
import { TrajectoryToolbar } from "./trajectory-toolbar.tsx";
import { useTrajectoryWorkspace } from "./use-trajectory-workspace.ts";
import css from "./monitor-workspace.module.css";

interface WorkspaceProps { view: MonitorViewState; controller: MonitorController; active: boolean }

export function TrajectoryWorkspace({ view, controller, active }: WorkspaceProps) {
  const workspace = useTrajectoryWorkspace({ view, controller });
  if (!view.trajectory) return <div className={css.empty} role="status">
    {view.loadingTrajectory ? "正在载入执行轨迹…" : "选择一条运行查看执行轨迹"}
  </div>;
  const history = { hasOlder: view.trajectory.hasOlder === true, loading: view.loadingOlder, load: workspace.actions.loadOlder };
  const matches = new Set(workspace.records.filter((record) => recordMatches(record, workspace.filters)).map((record) => record.key));
  return <div className={css.main} aria-label="所选运行的轨迹">
    <TrajectoryToolbar model={{ records: workspace.records, filters: workspace.filters, groups: workspace.groups,
      folds: workspace.folds, actualDuration: workspace.actualDuration, range: workspace.range, run: view.trajectory.run }}
      actions={workspace.actions} active={active} />
    <TrajectoryOverview model={workspace.model} actualDuration={workspace.actualDuration} active={active}
      history={history} actions={workspace.actions} selection={{ range: workspace.range,
        recordKey: workspace.selected?.key, matches, focus: workspace.focusKeys }} />
    <div className={css.ledger} onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && view.inspectedRowKey) workspace.actions.closeInspector();
    }}>
      <TrajectoryLedger items={workspace.items} selection={{ rowKey: view.inspectedRowKey, focusKeys: workspace.focusKeys }}
        history={history} inspecting={view.inspectedRowKey !== undefined} active={active}
        actions={workspace.actions} handle={workspace.ledger} />
      <InspectorPane open={view.inspectedRowKey !== undefined} width={workspace.width} resizing={workspace.resizing}
        active={active} actions={workspace.inspectorActions} content={{ inspector: view.inspector,
          record: workspace.selected, loading: view.loadingInspector, error: view.inspectorError, rowKey: view.inspectedRowKey }} />
    </div>
  </div>;
}
