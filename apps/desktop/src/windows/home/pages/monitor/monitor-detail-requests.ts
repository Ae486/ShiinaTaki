/**
 * INPUT:  current Monitor selection scopes, committed-event invalidations, and Inspector selection actions
 * OUTPUT: independently guarded Inspector requests and one-in-flight/one-trailing summary revalidation
 * POS:    ui/monitor — request coordination only; summary updates never replace rows or history/reading cursors
 */
import { monitorError, monitorUnavailable, type MonitorRequestScope, type MonitorSelectionAccess } from "./monitor-request-state.ts";

interface SummaryRefresh { scope: MonitorRequestScope; dirty: boolean }

export class MonitorDetailRequests {
  private inspectorEpoch = 0;
  private summary?: SummaryRefresh;
  private readonly access: MonitorSelectionAccess;

  constructor(access: MonitorSelectionAccess) { this.access = access; }

  retire(): void {
    this.inspectorEpoch += 1;
    this.summary = undefined;
    this.access.publish({ loadingInspector: false, refreshingSummary: false });
  }

  closeInspector(): void {
    this.inspectorEpoch += 1;
    this.access.publish({ inspector: undefined, inspectedRowKey: undefined, loadingInspector: false, inspectorError: null });
  }

  async inspect(rowKey: string, refresh = false): Promise<void> {
    const scope = this.access.capture();
    if (!scope) return;
    if (!refresh && this.access.read().inspectedRowKey === rowKey) { this.closeInspector(); return; }
    const epoch = ++this.inspectorEpoch;
    this.access.publish({ inspectedRowKey: rowKey, loadingInspector: true, inspectorError: null,
      ...(refresh ? {} : { inspector: undefined }) });
    try {
      const inspector = await scope.target.monitorInspect({ characterId: scope.characterId, runKey: scope.runKey, rowKey });
      if (!this.access.current(scope) || epoch !== this.inspectorEpoch) return;
      this.access.publish({ inspector, loadingInspector: false });
    } catch (cause) {
      if (!this.access.current(scope) || epoch !== this.inspectorEpoch) return;
      if (monitorUnavailable(cause)) this.access.failed(cause);
      else this.access.publish({ loadingInspector: false, inspectorError: monitorError(cause) });
    }
  }

  refreshSummary(): void {
    const scope = this.access.capture();
    if (!scope) return;
    if (this.summary && this.access.current(this.summary.scope)) { this.summary.dirty = true; return; }
    const refresh = { scope, dirty: false };
    this.summary = refresh;
    this.access.publish({ refreshingSummary: true });
    void this.readSummary(refresh);
  }

  private async readSummary(refresh: SummaryRefresh): Promise<void> {
    const scope = refresh.scope;
    try {
      do {
        refresh.dirty = false;
        try {
          const page = await scope.target.monitorTrajectory({
            characterId: scope.characterId, runKey: scope.runKey, afterSeq: 0, tail: true, limit: 1,
          });
          if (!this.access.current(scope)) return;
          const view = this.access.read();
          if (!view.trajectory) return;
          // A live append or forward recovery may already have accepted a newer snapshot while this read waited.
          // Its dirty flag still drives one trailing read when those newer events need a fresh summary.
          if (page.cursor.seq < view.trajectory.cursor.seq) continue;
          this.access.publish({
            trajectory: { ...view.trajectory, run: page.run },
            runs: view.runs.map((run) => run.key === scope.runKey ? page.run : run),
          });
        } catch (cause) {
          if (!this.access.current(scope)) return;
          this.access.failed(cause);
        }
      } while (refresh.dirty && this.access.current(scope));
    } finally {
      if (this.summary === refresh) {
        this.summary = undefined;
        if (this.access.current(scope)) this.access.publish({ refreshingSummary: false });
      }
    }
  }
}
