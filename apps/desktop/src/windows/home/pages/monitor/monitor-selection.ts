/**
 * INPUT:  committed/pending Monitor selections, bounded trajectory pages, and generation-owned committed events
 * OUTPUT: coherent Run replacements, independent older/live cursors, guarded recovery and record details
 * POS:    ui/monitor — selection read model; canonical execution and durable ordering stay in Core
 */
import type { RunMonitorEvent, TrajectoryResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { MonitorViewState } from "./monitor-controller.ts";
import { MonitorDetailRequests } from "./monitor-detail-requests.ts";
import {
  mergeForwardPage, mergeTrajectoryRows, monitorDisabled, monitorError, monitorUnavailable,
  type MonitorRequestScope, type MonitorSelectionAccess,
} from "./monitor-request-state.ts";

interface SelectionContext {
  read(): MonitorViewState;
  client(): WsClient | null;
  generation(): number;
  visible(): boolean;
  publish(patch: Partial<MonitorViewState>): void;
  retireList(): void;
}
interface Recovery { scope: MonitorRequestScope; dirty: boolean; promise?: Promise<void> }

export class MonitorSelection {
  private epoch = 0;
  private candidate?: MonitorRequestScope;
  private recovery?: Recovery;
  private readonly missingRows = new Set<string>();
  private readonly context: SelectionContext;
  readonly details: MonitorDetailRequests;

  constructor(context: SelectionContext) {
    this.context = context;
    const access: MonitorSelectionAccess = {
      capture: () => this.capture(), current: (scope) => this.current(scope),
      read: context.read, publish: context.publish, failed: (cause) => this.failed(cause),
      missingRow: (rowKey) => this.missingRow(rowKey),
    };
    this.details = new MonitorDetailRequests(access);
  }

  retire(): void {
    this.epoch += 1;
    this.candidate = undefined;
    this.recovery = undefined;
    this.context.publish({ ...this.details.retire(), requestedRunKey: undefined, retryRunKey: undefined,
      loadingTrajectory: false, loadingOlder: false, recovering: false });
  }

  clear(patch: Partial<MonitorViewState> = {}): void {
    this.candidate = undefined;
    this.replace(undefined, patch);
  }

  async select(runKey: string): Promise<void> {
    const view = this.context.read();
    if (view.selectedRunKey === runKey || this.candidate?.runKey === runKey) {
      this.unsubscribe(); this.clear({ error: null }); return;
    }
    const target = this.context.client();
    if (!target || !this.context.visible() || view.mode === "DISABLED") return;
    const scope = { target, generation: this.context.generation(), characterId: view.filters.characterId, runKey, epoch: this.epoch };
    this.candidate = scope;
    this.context.publish({ requestedRunKey: runKey, retryRunKey: undefined, loadingTrajectory: true, error: null });
    if (!this.currentCandidate(scope)) return;
    try {
      // A different Run always needs its own bounded tail; A's rows and older cursor are never B's warm cache.
      const trajectory = await target.monitorTrajectory({ characterId: scope.characterId, runKey, afterSeq: 0, tail: true, limit: 100 });
      if (!this.currentCandidate(scope)) return;
      this.unsubscribe();
      this.candidate = undefined;
      this.replace(trajectory, { error: null });
      await this.recover();
    } catch (cause) {
      if (!this.currentCandidate(scope)) return;
      this.candidate = undefined;
      const patch = { requestedRunKey: undefined, retryRunKey: scope.runKey, loadingTrajectory: false,
        error: `未能切换到所选运行。${monitorError(cause)}` };
      if (!this.unavailable(cause, scope.runKey, patch)) this.context.publish(patch);
    }
  }

  async restore(): Promise<void> {
    const scope = this.capture();
    if (!scope || !this.context.read().trajectory) return;
    this.context.publish({ recovering: true, ...(this.context.read().retryRunKey ? {} : { error: null }) });
    if (!this.current(scope)) return;
    try {
      const page = await scope.target.monitorTrajectory({
        characterId: scope.characterId, runKey: scope.runKey, afterSeq: 0, tail: true, limit: 1,
      });
      if (!this.current(scope)) return;
      const previous = this.context.read().trajectory;
      this.publishTrajectory(previous ? {
        ...previous, run: page.cursor.seq >= previous.cursor.seq ? page.run : previous.run,
      } : page);
      await this.recover();
      const rowKey = this.context.read().inspectedRowKey;
      if (this.current(scope) && rowKey) await this.details.inspect(rowKey, true);
    } catch (cause) {
      if (this.current(scope)) {
        this.failed(cause);
        this.context.publish({ recovering: false });
      }
    }
  }

  async loadOlder(): Promise<void> {
    const scope = this.capture();
    const previous = this.context.read().trajectory;
    if (!scope || !previous?.hasOlder || !previous.olderCursor || this.context.read().loadingOlder) return;
    this.context.publish({ loadingOlder: true, error: null, retryRunKey: undefined });
    try {
      const page = await scope.target.monitorTrajectory({
        characterId: scope.characterId, runKey: scope.runKey, afterSeq: 0,
        beforeSeq: previous.olderCursor.seq, limit: 100,
      });
      if (!this.current(scope)) return;
      const current = this.context.read().trajectory!;
      this.publishTrajectory({
        ...current, rows: mergeTrajectoryRows(current.rows, page.rows),
        hasOlder: page.hasOlder, olderCursor: page.olderCursor,
      }, { loadingOlder: false });
    } catch (cause) {
      if (this.current(scope)) { this.failed(cause); this.context.publish({ loadingOlder: false }); }
    }
  }

  recover(): Promise<void> {
    const scope = this.capture();
    if (!scope || !this.context.read().trajectory) return Promise.resolve();
    if (this.recovery && this.current(this.recovery.scope)) {
      this.recovery.dirty = true;
      return this.recovery.promise!;
    }
    const recovery: Recovery = { scope, dirty: false };
    this.recovery = recovery;
    recovery.promise = this.readRecovery(recovery);
    return recovery.promise;
  }

  private async readRecovery(recovery: Recovery): Promise<void> {
    const scope = recovery.scope;
    this.context.publish({ recovering: true });
    try {
      do {
        recovery.dirty = false;
        await this.drainForward(scope);
        if (!this.current(scope)) return;
        await scope.target.subscribeMonitor({
          characterId: scope.characterId, runKey: scope.runKey, afterSeq: this.context.read().trajectory!.cursor.seq,
        });
      } while (recovery.dirty && this.current(scope));
      if (this.current(scope)) this.context.publish({ stale: false, recovering: false });
    } catch (cause) {
      if (this.current(scope)) { this.failed(cause); this.context.publish({ recovering: false }); }
    }
    finally { if (this.recovery === recovery) this.recovery = undefined; }
  }

  private async drainForward(scope: MonitorRequestScope): Promise<void> {
    let more = true;
    while (more && this.current(scope)) {
      const afterSeq = this.context.read().trajectory!.cursor.seq;
      const page = await scope.target.monitorTrajectory({ characterId: scope.characterId, runKey: scope.runKey, afterSeq, limit: 200 });
      if (!this.current(scope)) return;
      if (page.hasMore && page.cursor.seq <= afterSeq) throw new Error("MONITOR_PROGRESS_STALLED");
      this.publishTrajectory(mergeForwardPage(this.context.read().trajectory!, page));
      more = page.hasMore;
    }
  }

  onLive(event: RunMonitorEvent): void {
    if (event.invalidated && event.reason === "mode-disabled") { this.failed(new Error("OBSERVABILITY_DISABLED")); return; }
    if (event.runKey !== this.context.read().selectedRunKey) return;
    if (event.invalidated) {
      this.context.publish({ stale: true });
      void this.recover();
      return;
    }
    const previous = this.context.read().trajectory;
    if (!event.row || !previous || event.row.seq <= previous.cursor.seq) return;
    if (event.row.seq !== previous.cursor.seq + 1) {
      this.context.publish({ stale: true });
      void this.recover();
      return;
    }
    this.context.publish({ trajectory: {
      ...previous, rows: this.missingRows.has(event.row.rowKey) ? previous.rows : [...previous.rows, event.row],
      cursor: { runKey: event.runKey, seq: event.row.seq },
    } });
    this.details.refreshSummary();
  }

  private publishTrajectory(trajectory: TrajectoryResult, patch: Partial<MonitorViewState> = {}): void {
    this.context.publish({ ...patch, trajectory: this.withoutMissingRows(trajectory),
      runs: this.context.read().runs.map((run) => run.key === trajectory.run.key ? trajectory.run : run),
    });
  }

  private replace(trajectory: TrajectoryResult | undefined, patch: Partial<MonitorViewState>): void {
    this.epoch += 1;
    this.recovery = undefined;
    this.missingRows.clear();
    this.context.publish({ ...this.details.reset(), selectedRunKey: trajectory?.run.key, trajectory,
      requestedRunKey: this.candidate?.runKey, loadingTrajectory: this.candidate !== undefined,
      retryRunKey: undefined, loadingOlder: false, recovering: false, stale: false,
      ...(trajectory ? { runs: this.context.read().runs.map((run) => run.key === trajectory.run.key ? trajectory.run : run) } : {}),
      ...patch });
  }

  private missingRow(rowKey: string): TrajectoryResult | undefined {
    // Core emits EVENT_NOT_FOUND only after an authorized database lookup misses, before mode projection.
    // That absence is stronger than older pages already in flight for this same committed Run.
    this.missingRows.add(rowKey);
    const trajectory = this.context.read().trajectory;
    return trajectory && this.withoutMissingRows(trajectory);
  }

  private withoutMissingRows(trajectory: TrajectoryResult): TrajectoryResult {
    if (this.missingRows.size === 0) return trajectory;
    const rows = trajectory.rows.filter((row) => !this.missingRows.has(row.rowKey));
    return rows.length === trajectory.rows.length ? trajectory : { ...trajectory, rows };
  }

  private currentCandidate(scope: MonitorRequestScope): boolean {
    return this.candidate === scope && this.context.visible() && this.context.client() === scope.target
      && this.context.generation() === scope.generation && this.context.read().filters.characterId === scope.characterId;
  }

  private capture(): MonitorRequestScope | undefined {
    const target = this.context.client();
    const view = this.context.read();
    if (!target || !view.selectedRunKey || !this.context.visible()) return undefined;
    return { target, generation: this.context.generation(), characterId: view.filters.characterId,
      runKey: view.selectedRunKey, epoch: this.epoch };
  }

  private current(scope: MonitorRequestScope): boolean {
    const view = this.context.read();
    return this.context.visible() && this.context.client() === scope.target
      && this.context.generation() === scope.generation && this.epoch === scope.epoch
      && view.filters.characterId === scope.characterId && view.selectedRunKey === scope.runKey;
  }

  failed(cause: unknown): void {
    const patch = { error: monitorError(cause), retryRunKey: undefined, stale: this.context.read().trajectory !== undefined };
    if (!this.unavailable(cause, this.context.read().selectedRunKey, patch)) this.context.publish(patch);
  }

  private unavailable(cause: unknown, runKey: string | undefined, patch: Partial<MonitorViewState>): boolean {
    const scope = monitorUnavailable(cause);
    if (scope !== "monitor" && scope !== "run") return false;
    // A pending list cannot resurrect rows for which a stronger authorized read just denied access.
    this.context.retireList();
    if (scope === "monitor") {
      this.unsubscribe();
      this.clear({ ...patch, runs: [], nextCursor: undefined, loadingRuns: false, retryRunKey: undefined, stale: false,
        ...(monitorDisabled(cause) ? { mode: "DISABLED" } : {}) });
    } else {
      const view = this.context.read();
      const removed = { ...patch, runs: view.runs.filter((run) => run.key !== runKey), loadingRuns: false,
        ...(view.nextCursor?.key === runKey ? { nextCursor: undefined } : {}) };
      if (view.selectedRunKey === runKey) { this.unsubscribe(); this.replace(undefined, { ...removed, stale: false }); }
      else this.context.publish(removed);
    }
    return true;
  }

  private unsubscribe(): void {
    if (this.context.read().selectedRunKey) void this.context.client()?.unsubscribeMonitor?.().catch(() => undefined);
  }
}
