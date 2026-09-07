/**
 * INPUT:  disposable Monitor selection, bounded trajectory pages, and generation-owned committed events
 * OUTPUT: independent older/live cursors, forward recovery before subscription, and guarded record details
 * POS:    ui/monitor — selection read model; canonical execution and durable ordering stay in Core
 */
import type { RunMonitorEvent, TrajectoryResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { MonitorViewState } from "./monitor-controller.ts";
import { MonitorDetailRequests } from "./monitor-detail-requests.ts";
import {
  mergeForwardPage, mergeTrajectoryRows, monitorError, monitorUnavailable,
  type MonitorRequestScope, type MonitorSelectionAccess,
} from "./monitor-request-state.ts";

interface SelectionContext {
  read(): MonitorViewState;
  client(): WsClient | null;
  generation(): number;
  visible(): boolean;
  publish(patch: Partial<MonitorViewState>): void;
}
interface Recovery { scope: MonitorRequestScope; dirty: boolean; promise?: Promise<void> }

export class MonitorSelection {
  private epoch = 0;
  private recovery?: Recovery;
  private readonly context: SelectionContext;
  readonly details: MonitorDetailRequests;

  constructor(context: SelectionContext) {
    this.context = context;
    const access: MonitorSelectionAccess = {
      capture: () => this.capture(), current: (scope) => this.current(scope),
      read: context.read, publish: context.publish, failed: (cause) => this.failed(cause),
    };
    this.details = new MonitorDetailRequests(access);
  }

  retire(): void {
    this.epoch += 1;
    this.recovery = undefined;
    this.details.retire();
    this.context.publish({ loadingTrajectory: false, loadingOlder: false, recovering: false });
  }

  clear(): void {
    this.retire();
    this.details.closeInspector();
    this.context.publish({ selectedRunKey: undefined, trajectory: undefined, stale: false });
  }

  async select(runKey: string): Promise<void> {
    const previous = this.context.read().selectedRunKey;
    if (previous) void this.context.client()?.unsubscribeMonitor?.().catch(() => undefined);
    this.clear();
    if (previous === runKey) return;
    this.context.publish({ selectedRunKey: runKey, error: null });
    await this.restore();
  }

  async restore(): Promise<void> {
    const scope = this.capture();
    if (!scope) return;
    const warm = this.context.read().trajectory !== undefined;
    this.context.publish({ loadingTrajectory: !warm, recovering: warm, error: null });
    try {
      const page = await scope.target.monitorTrajectory({
        characterId: scope.characterId, runKey: scope.runKey, afterSeq: 0, tail: true, limit: warm ? 1 : 100,
      });
      if (!this.current(scope)) return;
      const previous = this.context.read().trajectory;
      this.publishTrajectory(previous ? {
        ...previous, run: page.cursor.seq >= previous.cursor.seq ? page.run : previous.run,
      } : page, { loadingTrajectory: false });
      await this.recover();
      const rowKey = this.context.read().inspectedRowKey;
      if (this.current(scope) && rowKey) await this.details.inspect(rowKey, true);
    } catch (cause) {
      if (this.current(scope)) {
        this.failed(cause);
        this.context.publish({ loadingTrajectory: false, recovering: false });
      }
    }
  }

  async loadOlder(): Promise<void> {
    const scope = this.capture();
    const previous = this.context.read().trajectory;
    if (!scope || !previous?.hasOlder || !previous.olderCursor || this.context.read().loadingOlder) return;
    this.context.publish({ loadingOlder: true, error: null });
    try {
      const page = await scope.target.monitorTrajectory({
        characterId: scope.characterId, runKey: scope.runKey, afterSeq: 0,
        beforeSeq: previous.olderCursor.seq, limit: 100,
      });
      if (!this.current(scope)) return;
      const current = this.context.read().trajectory!;
      this.context.publish({ trajectory: {
        ...current, rows: mergeTrajectoryRows(current.rows, page.rows),
        hasOlder: page.hasOlder, olderCursor: page.olderCursor,
      }, loadingOlder: false });
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
    if (event.runKey !== this.context.read().selectedRunKey) return;
    if (event.invalidated) {
      if (event.reason === "mode-disabled") {
        this.clear();
        this.context.publish({ mode: "DISABLED", runs: [], error: "运行监视已关闭。" });
      } else {
        this.context.publish({ stale: true });
        void this.recover();
      }
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
      ...previous, rows: [...previous.rows, event.row], cursor: { runKey: event.runKey, seq: event.row.seq },
    } });
    this.details.refreshSummary();
  }

  private publishTrajectory(trajectory: TrajectoryResult, patch: Partial<MonitorViewState> = {}): void {
    this.context.publish({ ...patch, trajectory,
      runs: this.context.read().runs.map((run) => run.key === trajectory.run.key ? trajectory.run : run),
    });
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

  private failed(cause: unknown): void {
    if (monitorUnavailable(cause)) {
      void this.context.client()?.unsubscribeMonitor?.().catch(() => undefined);
      this.clear();
    }
    this.context.publish({ error: monitorError(cause), stale: this.context.read().trajectory !== undefined });
  }
}
