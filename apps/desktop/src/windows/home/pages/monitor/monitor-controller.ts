/**
 * INPUT:  one disposable Home client generation, visibility, Run filters, and selection actions
 * OUTPUT: guarded Run browsing and a selected trajectory delegated to the Monitor's bounded read coordinator
 * POS:    ui/monitor — framework-free local state; no polling, durable cache, or competing execution authority
 */
import type {
  MonitorMode, RunEventCategory, RunInitiator, RunMonitorCursor, RunMonitorSummary, RunOutcome, RunState,
  TrajectoryInspector, TrajectoryResult,
} from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { WsClient } from "@/lib/ws-client.js";
import { MonitorSelection } from "./monitor-selection.ts";
import { monitorError } from "./monitor-request-state.ts";

export interface MonitorFilters {
  characterId: string;
  text: string;
  initiator: RunInitiator | "";
  state: RunState | "";
  provider?: string;
  modelId?: string;
  toolName?: string;
  category?: RunEventCategory | "";
  outcome?: RunOutcome | "";
  hasRetry?: boolean;
  hasFailure?: boolean;
  from?: string;
  to?: string;
}

export interface MonitorViewState {
  mode: MonitorMode;
  filters: MonitorFilters;
  runs: RunMonitorSummary[];
  nextCursor?: RunMonitorCursor;
  selectedRunKey?: string;
  trajectory?: TrajectoryResult;
  inspector?: TrajectoryInspector;
  inspectedRowKey?: string;
  loadingRuns: boolean;
  loadingTrajectory: boolean;
  loadingOlder: boolean;
  loadingInspector: boolean;
  refreshingSummary: boolean;
  recovering: boolean;
  stale: boolean;
  error: string | null;
  inspectorError: string | null;
}

export const INITIAL_MONITOR_STATE: MonitorViewState = {
  mode: "DISABLED",
  filters: { characterId: ACTIVE_CHARACTER_ID, text: "", initiator: "", state: "" },
  runs: [], loadingRuns: false, loadingTrajectory: false, loadingOlder: false, loadingInspector: false,
  refreshingSummary: false, recovering: false, stale: false, error: null, inspectorError: null,
};

export interface MonitorController {
  bind(client: WsClient | null): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  applyFilters(filters: MonitorFilters): Promise<void>;
  refresh(): Promise<void>;
  loadOlderRuns(): Promise<void>;
  select(runKey: string): Promise<void>;
  loadMoreTrajectory(): Promise<void>;
  inspect(rowKey: string): Promise<void>;
  closeInspector(): void;
}

class MonitorControllerImpl implements MonitorController {
  private state = INITIAL_MONITOR_STATE;
  private client: WsClient | null = null;
  private generation = 0;
  private listEpoch = 0;
  private removeLiveHandler: (() => void) | null = null;
  private visible = true;
  private readonly selection: MonitorSelection;
  private readonly emit: (state: MonitorViewState) => void;

  constructor(emit: (state: MonitorViewState) => void) {
    this.emit = emit;
    this.selection = new MonitorSelection({
      read: () => this.state, client: () => this.client, generation: () => this.generation,
      visible: () => this.visible, publish: (patch) => this.publish(patch),
    });
  }

  private publish(patch: Partial<MonitorViewState>): void {
    this.state = { ...this.state, ...patch };
    if (this.visible) this.emit(this.state);
  }

  private current(candidate: number, target: WsClient): boolean {
    return this.visible && this.generation === candidate && this.client === target;
  }

  bind(next: WsClient | null): void {
    const previous = this.client;
    this.generation += 1;
    this.listEpoch += 1;
    this.selection.retire();
    this.removeLiveHandler?.();
    this.removeLiveHandler = null;
    if (previous && previous !== next) void previous.unsubscribeMonitor?.().catch(() => undefined);
    this.client = next;
    if (!next || !this.visible) {
      this.publish({ loadingRuns: false, stale: this.state.runs.length > 0 || this.state.trajectory !== undefined });
      return;
    }
    this.attach(next);
  }

  private attach(target: WsClient): void {
    const candidate = this.generation;
    this.removeLiveHandler = target.onMonitorEvent((event) => {
      if (this.current(candidate, target)) this.selection.onLive(event);
    });
    this.publish({ loadingRuns: true, error: null });
    void target.monitorState().then(async (monitor) => {
      if (!this.current(candidate, target)) return;
      this.publish({ mode: monitor.mode });
      if (!monitor.enabled) {
        this.selection.clear();
        this.publish({ runs: [], nextCursor: undefined, loadingRuns: false, stale: false });
        return;
      }
      await this.refresh();
    }).catch((cause: unknown) => {
      if (this.current(candidate, target)) this.publish({ error: monitorError(cause), loadingRuns: false, stale: true });
    });
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.generation += 1;
      this.listEpoch += 1;
      this.selection.retire();
      this.removeLiveHandler?.();
      this.removeLiveHandler = null;
      void this.client?.unsubscribeMonitor?.().catch(() => undefined);
    } else if (this.client) this.attach(this.client);
  }

  dispose(): void {
    const previous = this.client;
    this.generation += 1;
    this.listEpoch += 1;
    this.selection.retire();
    this.client = null;
    this.removeLiveHandler?.();
    this.removeLiveHandler = null;
    if (previous) void previous.unsubscribeMonitor?.().catch(() => undefined);
  }

  async applyFilters(filters: MonitorFilters): Promise<void> {
    if (filters.characterId !== this.state.filters.characterId) {
      void this.client?.unsubscribeMonitor?.().catch(() => undefined);
      this.selection.clear();
      this.publish({ runs: [], nextCursor: undefined });
    }
    this.publish({ filters: { ...filters, text: filters.text.slice(0, 100) } });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const target = this.client;
    if (!target || !this.visible) return;
    const candidate = this.generation;
    const epoch = ++this.listEpoch;
    this.publish({ loadingRuns: true, error: null });
    try {
      const result = await target.monitorList(this.listParams());
      if (!this.current(candidate, target) || epoch !== this.listEpoch) return;
      // The newest Run list is not an authority for selection membership. Older selections get their own authorized read.
      this.publish({ runs: result.runs, nextCursor: result.nextCursor, loadingRuns: false });
      if (this.state.selectedRunKey) await this.selection.restore();
      else this.publish({ stale: false });
    } catch (cause) {
      if (this.current(candidate, target) && epoch === this.listEpoch) {
        this.publish({ error: monitorError(cause), loadingRuns: false, stale: this.state.runs.length > 0 });
      }
    }
  }

  async loadOlderRuns(): Promise<void> {
    const target = this.client;
    const cursor = this.state.nextCursor;
    if (!target || !cursor || this.state.loadingRuns || !this.visible) return;
    const candidate = this.generation;
    const epoch = ++this.listEpoch;
    this.publish({ loadingRuns: true, error: null });
    try {
      const result = await target.monitorList(this.listParams(cursor));
      if (!this.current(candidate, target) || epoch !== this.listEpoch) return;
      const seen = new Set(this.state.runs.map((run) => run.key));
      this.publish({ runs: [...this.state.runs, ...result.runs.filter((run) => !seen.has(run.key))],
        nextCursor: result.nextCursor, loadingRuns: false });
    } catch (cause) {
      if (this.current(candidate, target) && epoch === this.listEpoch) {
        this.publish({ error: monitorError(cause), loadingRuns: false });
      }
    }
  }

  select(runKey: string): Promise<void> { return this.selection.select(runKey); }
  loadMoreTrajectory(): Promise<void> { return this.selection.loadOlder(); }
  inspect(rowKey: string): Promise<void> { return this.selection.details.inspect(rowKey); }
  closeInspector(): void { this.selection.details.closeInspector(); }

  private listParams(cursor?: RunMonitorCursor) {
    const filters = this.state.filters;
    return {
      characterId: filters.characterId, limit: 25, ...(cursor ? { cursor } : {}),
      ...(filters.text.trim() ? { text: filters.text.trim() } : {}),
      ...(filters.initiator ? { initiators: [filters.initiator] } : {}),
      ...(filters.state ? { states: [filters.state] } : {}),
      ...(filters.provider?.trim() ? { provider: filters.provider.trim() } : {}),
      ...(filters.modelId?.trim() ? { modelId: filters.modelId.trim() } : {}),
      ...(filters.toolName ? { toolName: filters.toolName } : {}),
      ...(filters.category ? { categories: [filters.category] } : {}),
      ...(filters.outcome ? { outcomes: [filters.outcome] } : {}),
      ...(filters.hasRetry === undefined ? {} : { hasRetry: filters.hasRetry }),
      ...(filters.hasFailure === undefined ? {} : { hasFailure: filters.hasFailure }),
      ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}),
    };
  }
}

export function createMonitorController(emit: (state: MonitorViewState) => void): MonitorController {
  return new MonitorControllerImpl(emit);
}
