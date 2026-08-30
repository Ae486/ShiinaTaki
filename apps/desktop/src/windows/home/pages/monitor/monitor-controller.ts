/**
 * INPUT:  one disposable Home WsClient generation plus operator filter/selection actions
 * OUTPUT: generation-safe monitor state with durable paging, live continuation, and inspector reads
 * POS:    ui/windows/home/pages/monitor — framework-free state owner; Core remains the Run/Event authority
 */
import type {
  MonitorMode, RunInitiator, RunMonitorCursor, RunMonitorEvent, RunMonitorSummary, RunState,
  TrajectoryInspector, TrajectoryResult,
} from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { WsClient } from "@/lib/ws-client.js";

export interface MonitorFilters {
  characterId: string;
  text: string;
  initiator: RunInitiator | "";
  state: RunState | "";
}

export interface MonitorViewState {
  mode: MonitorMode;
  filters: MonitorFilters;
  runs: RunMonitorSummary[];
  nextCursor?: RunMonitorCursor;
  selectedRunKey?: string;
  trajectory?: TrajectoryResult;
  inspector?: TrajectoryInspector;
  /** The trajectory row whose inspector is open; clicking it again closes (U1 two-way disclosure). */
  inspectedRowKey?: string;
  loadingRuns: boolean;
  loadingTrajectory: boolean;
  loadingInspector: boolean;
  stale: boolean;
  error: string | null;
}

export const INITIAL_MONITOR_STATE: MonitorViewState = {
  mode: "DISABLED",
  filters: { characterId: ACTIVE_CHARACTER_ID, text: "", initiator: "", state: "" },
  runs: [], loadingRuns: false, loadingTrajectory: false, loadingInspector: false, stale: false, error: null,
};

export interface MonitorController {
  bind(client: WsClient | null): void;
  dispose(): void;
  applyFilters(filters: MonitorFilters): Promise<void>;
  refresh(): Promise<void>;
  loadOlderRuns(): Promise<void>;
  select(runKey: string): Promise<void>;
  loadMoreTrajectory(): Promise<void>;
  inspect(rowKey: string): Promise<void>;
  /** U1: the inspector is an explicitly opened surface — it must be explicitly closable. */
  closeInspector(): void;
}

class MonitorControllerImpl implements MonitorController {
  private state = INITIAL_MONITOR_STATE;
  private client: WsClient | null = null;
  private generation = 0;
  private removeLiveHandler: (() => void) | null = null;
  private readonly emit: (state: MonitorViewState) => void;

  constructor(emit: (state: MonitorViewState) => void) { this.emit = emit; }

  private publish(patch: Partial<MonitorViewState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(this.state);
  }

  private current(candidate: number, target: WsClient): boolean {
    return this.generation === candidate && this.client === target;
  }

  private report(cause: unknown): void {
    this.publish({ error: cause instanceof Error ? cause.message : "Monitor unavailable",
      loadingRuns: false, loadingTrajectory: false, loadingInspector: false });
  }

  private listParams(cursor?: RunMonitorCursor) {
    const filters = this.state.filters;
    return { characterId: filters.characterId, ...(filters.text.trim() ? { text: filters.text.trim() } : {}),
      ...(filters.initiator ? { initiators: [filters.initiator] } : {}),
      ...(filters.state ? { states: [filters.state] } : {}), ...(cursor ? { cursor } : {}), limit: 25 };
  }

  bind(next: WsClient | null): void {
    const previous = this.client;
    this.generation += 1;
    this.removeLiveHandler?.();
    this.removeLiveHandler = null;
    if (previous && previous !== next) void previous.unsubscribeMonitor?.().catch(() => undefined);
    this.client = next;
    if (!next) {
      this.publish({ loadingRuns: false, loadingTrajectory: false, loadingInspector: false,
        stale: this.state.runs.length > 0 });
      return;
    }
    const candidate = this.generation;
    this.removeLiveHandler = next.onMonitorEvent((event) => this.onLive(event));
    this.publish({ loadingRuns: true, error: null });
    void next.monitorState().then((monitor) => this.restore({ target: next, candidate, ...monitor }),
      (cause) => { if (this.current(candidate, next)) this.report(cause); });
  }

  private async restore(input: { target: WsClient; candidate: number; mode: MonitorMode; enabled: boolean }): Promise<void> {
    const { target, candidate, mode, enabled } = input;
    if (!this.current(candidate, target)) return;
    this.publish({ mode });
    if (!enabled) {
      this.publish({ runs: [], nextCursor: undefined, selectedRunKey: undefined, trajectory: undefined,
        inspector: undefined, inspectedRowKey: undefined, loadingRuns: false, stale: false });
      return;
    }
    await this.refresh();
  }

  dispose(): void {
    const previous = this.client;
    this.generation += 1;
    this.client = null;
    this.removeLiveHandler?.();
    this.removeLiveHandler = null;
    if (previous) void previous.unsubscribeMonitor?.().catch(() => undefined);
  }

  async applyFilters(filters: MonitorFilters): Promise<void> {
    this.publish({ filters: { ...filters, text: filters.text.slice(0, 100) }, selectedRunKey: undefined,
      trajectory: undefined, inspector: undefined, inspectedRowKey: undefined, stale: false });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const target = this.client;
    if (!target) return;
    const candidate = this.generation;
    this.publish({ loadingRuns: true, error: null });
    try {
      const result = await target.monitorList(this.listParams());
      if (!this.current(candidate, target)) return;
      const selectedRunKey = this.state.selectedRunKey && result.runs.some((run) => run.key === this.state.selectedRunKey)
        ? this.state.selectedRunKey : undefined;
      this.publish({ runs: result.runs, nextCursor: result.nextCursor, selectedRunKey, loadingRuns: false,
        ...(selectedRunKey ? {} : { trajectory: undefined, inspector: undefined, inspectedRowKey: undefined }) });
      if (selectedRunKey) await this.refreshTrajectory(target, candidate);
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  async loadOlderRuns(): Promise<void> {
    const target = this.client; const cursor = this.state.nextCursor;
    if (!target || !cursor) return;
    const candidate = this.generation;
    this.publish({ loadingRuns: true, error: null });
    try {
      const result = await target.monitorList(this.listParams(cursor));
      if (!this.current(candidate, target)) return;
      const seen = new Set(this.state.runs.map((run) => run.key));
      this.publish({ runs: [...this.state.runs, ...result.runs.filter((run) => !seen.has(run.key))],
        nextCursor: result.nextCursor, loadingRuns: false });
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  async select(runKey: string): Promise<void> {
    if (!this.state.runs.some((run) => run.key === runKey)) return;
    // U1: clicking the selected run again deselects it — a disclosure that opens both ways.
    if (this.state.selectedRunKey === runKey) {
      const target = this.client;
      if (target) void target.unsubscribeMonitor?.().catch(() => undefined);
      this.publish({ selectedRunKey: undefined, trajectory: undefined, inspector: undefined,
        inspectedRowKey: undefined, stale: false });
      return;
    }
    this.publish({ selectedRunKey: runKey, trajectory: undefined, inspector: undefined, inspectedRowKey: undefined, stale: false });
    if (this.client) await this.refreshTrajectory(this.client, this.generation);
  }

  private async refreshTrajectory(target: WsClient, candidate: number): Promise<void> {
    const runKey = this.state.selectedRunKey;
    if (!runKey) return;
    this.publish({ loadingTrajectory: true, error: null });
    try {
      const trajectory = await target.monitorTrajectory({ characterId: this.state.filters.characterId,
        runKey, afterSeq: 0, limit: 100 });
      if (!this.current(candidate, target) || this.state.selectedRunKey !== runKey) return;
      this.publish({ trajectory, loadingTrajectory: false, stale: false, inspector: undefined, inspectedRowKey: undefined });
      await target.subscribeMonitor({ characterId: this.state.filters.characterId, runKey,
        afterSeq: trajectory.cursor.seq });
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  private async recoverLive(target: WsClient, candidate: number): Promise<void> {
    const previous = this.state.trajectory; const runKey = this.state.selectedRunKey;
    if (!previous || !runKey) return;
    this.publish({ loadingTrajectory: true });
    try {
      const page = await target.monitorTrajectory({ characterId: this.state.filters.characterId,
        runKey, afterSeq: previous.cursor.seq, limit: 200 });
      if (!this.current(candidate, target) || this.state.selectedRunKey !== runKey) return;
      const rows = [...previous.rows, ...page.rows].filter((row, index, all) =>
        all.findIndex((candidateRow) => candidateRow.seq === row.seq) === index);
      this.publish({ trajectory: { ...page, rows }, loadingTrajectory: false, stale: false });
      await target.subscribeMonitor({ characterId: this.state.filters.characterId, runKey, afterSeq: page.cursor.seq });
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  async loadMoreTrajectory(): Promise<void> {
    const target = this.client; const previous = this.state.trajectory; const runKey = this.state.selectedRunKey;
    if (!target || !previous?.hasMore || !runKey) return;
    const candidate = this.generation;
    this.publish({ loadingTrajectory: true, error: null });
    try {
      const page = await target.monitorTrajectory({ characterId: this.state.filters.characterId,
        runKey, afterSeq: previous.cursor.seq, limit: 100 });
      if (!this.current(candidate, target) || this.state.selectedRunKey !== runKey) return;
      this.publish({ trajectory: { ...page, rows: [...previous.rows, ...page.rows] }, loadingTrajectory: false });
      await target.subscribeMonitor({ characterId: this.state.filters.characterId, runKey, afterSeq: page.cursor.seq });
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  async inspect(rowKey: string): Promise<void> {
    const target = this.client; const runKey = this.state.selectedRunKey;
    if (!target || !runKey) return;
    // U1: the inspector is an explicitly opened disclosure — clicking the inspected row again closes it.
    if (this.state.inspectedRowKey === rowKey) {
      this.closeInspector();
      return;
    }
    const candidate = this.generation;
    this.publish({ loadingInspector: true, error: null });
    try {
      const inspector = await target.monitorInspect({ characterId: this.state.filters.characterId, runKey, rowKey });
      if (this.current(candidate, target) && this.state.selectedRunKey === runKey) {
        this.publish({ inspector, inspectedRowKey: rowKey, loadingInspector: false });
      }
    } catch (cause) { if (this.current(candidate, target)) this.report(cause); }
  }

  closeInspector(): void {
    this.publish({ inspector: undefined, inspectedRowKey: undefined });
  }

  private onLive(event: RunMonitorEvent): void {
    if (event.runKey !== this.state.selectedRunKey) return;
    if (event.invalidated) {
      this.publish({ stale: true, error: event.reason === "mode-disabled" ? "Monitoring was disabled." : null });
      if (event.reason === "mode-disabled") this.publish({ mode: "DISABLED", runs: [], trajectory: undefined, inspector: undefined, inspectedRowKey: undefined });
      else if (this.client) void this.recoverLive(this.client, this.generation);
      return;
    }
    if (!event.row || !this.state.trajectory) return;
    const rows = [...this.state.trajectory.rows.filter((row) => row.seq !== event.row!.seq), event.row]
      .sort((left, right) => left.seq - right.seq);
    this.publish({ trajectory: { ...this.state.trajectory, rows,
      cursor: { runKey: event.runKey, seq: Math.max(this.state.trajectory.cursor.seq, event.cursor) } }, stale: false });
  }
}

export function createMonitorController(emit: (state: MonitorViewState) => void): MonitorController {
  return new MonitorControllerImpl(emit);
}
