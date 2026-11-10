/**
 * INPUT: physical operator client, page/tab visibility, monitor mode and background snapshots
 * OUTPUT: coherent disposable background list/detail state across selection and reconnect
 * POS: ui/monitor — no execution commands, arithmetic, persistent cache or polling
 */
import { MONITOR_MODE_CONFIG_KEY, MonitorModeSchema, MaintenanceMonitorParamsSchema,
  type MaintenanceMonitorParams, type MaintenanceMonitorSnapshot, type MaintenanceMonitorUpdate,
  type MaintenanceOperationRef } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

export type MaintenanceMonitorClient = Pick<WsClient, "subscribeMaintenanceMonitor" | "unsubscribeMaintenanceMonitor"
  | "onMaintenanceMonitorChanged" | "onConfigChanged" | "onClose">;
export interface MaintenanceMonitorView {
  phase: "disabled" | "loading" | "live" | "stale" | "error";
  snapshot: MaintenanceMonitorSnapshot | null;
  error: string | null;
}
export const INITIAL_MAINTENANCE_VIEW: MaintenanceMonitorView = { phase: "disabled", snapshot: null, error: null };

export class MaintenanceMonitorController {
  private client: MaintenanceMonitorClient | null = null;
  private state = INITIAL_MAINTENANCE_VIEW;
  private query: MaintenanceMonitorParams;
  private generation = 0;
  private binding = 0;
  private revision = -1;
  private visible = false;
  private enabled = false;
  private removePush: (() => void) | null = null;
  private removeMode: (() => void) | null = null;
  private readonly publish: (state: MaintenanceMonitorView) => void;

  constructor(publish: (state: MaintenanceMonitorView) => void, characterId: string) {
    this.publish = publish;
    this.query = { characterId };
  }

  bind(client: MaintenanceMonitorClient | null): void {
    this.stop(); this.removeMode?.(); this.removeMode = null;
    if (this.client !== client) this.revision = -1;
    this.client = client;
    const binding = ++this.binding;
    if (client) {
      this.removeMode = client.onConfigChanged((change) => {
        if (binding !== this.binding || change.key !== MONITOR_MODE_CONFIG_KEY) return;
        const mode = MonitorModeSchema.safeParse(change.value);
        if (mode.success) this.setEnabled(mode.data !== "DISABLED");
      });
      client.onClose(() => { if (binding === this.binding) this.bind(null); });
    }
    this.start();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.start(); else this.stop();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled; this.stop();
    if (enabled) this.start(); else this.update(INITIAL_MAINTENANCE_VIEW);
  }

  select(ref: MaintenanceOperationRef): void {
    if (ref.characterId !== this.query.characterId) return;
    this.query = { ...this.query, selected: ref, callCursor: undefined };
    this.retry();
  }
  older(): void {
    const cursor = this.state.snapshot?.nextCursor;
    if (!cursor) return;
    this.query = { ...this.query, cursor }; this.retry();
  }
  latest(): void { this.query = { characterId: this.query.characterId }; this.retry(); }
  olderCalls(): void {
    const cursor = this.state.snapshot?.detail?.calls.nextCursor;
    if (!cursor) return;
    this.query = { ...this.query, callCursor: cursor }; this.retry();
  }
  retry = (): void => { this.stop(); this.start(); };
  dispose(): void {
    this.stop(); this.removeMode?.(); this.removeMode = null;
    this.binding++; this.client = null;
  }

  private stop(): void {
    this.generation++;
    if (this.removePush) {
      this.removePush(); this.removePush = null;
      void this.client?.unsubscribeMaintenanceMonitor().catch(() => undefined);
    }
    if (this.state.snapshot) this.update({ ...this.state, phase: "stale" });
  }

  private start(): void {
    if (!this.enabled) { this.update(INITIAL_MAINTENANCE_VIEW); return; }
    if (!this.visible) return;
    const client = this.client;
    if (!client) { this.update({ ...this.state, phase: "stale", error: null }); return; }
    const generation = ++this.generation;
    const revision = this.revision;
    const query = MaintenanceMonitorParamsSchema.parse(this.query);
    this.update({ ...this.state, phase: "loading", error: null });
    this.removePush = client.onMaintenanceMonitorChanged((value) => this.accept(value, generation, query));
    void client.subscribeMaintenanceMonitor(query).then(
      (value) => this.accept(value, generation, query),
      () => {
        if (generation === this.generation && this.revision === revision) {
          this.update({ ...this.state, phase: "error", error: "后台维护记录读取失败，请重试。" });
        }
      },
    );
  }

  private accept(value: MaintenanceMonitorUpdate, generation: number, query: MaintenanceMonitorParams): void {
    if (generation !== this.generation || value.revision <= this.revision
      || JSON.stringify(value.snapshot.query) !== JSON.stringify(query)) return;
    this.revision = value.revision;
    if (value.snapshot.status === "disabled") { this.setEnabled(false); return; }
    if (value.snapshot.status === "unavailable") {
      this.update({ ...this.state, phase: "error", error: "后台维护记录暂不可用，请刷新后重试。" }); return;
    }
    this.update({ phase: "live", snapshot: value.snapshot, error: null });
  }

  private update(state: MaintenanceMonitorView): void {
    this.state = state;
    if (this.visible) this.publish(state);
  }
}
