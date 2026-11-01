/**
 * INPUT: current physical Home client, Monitor mode/visibility and complete cache-window updates.
 * OUTPUT: generation-guarded disposable live/stale/error snapshots and deliberate retry.
 * POS: ui/monitor — aggregate read controller; Core owns arithmetic, window boundaries and persistence.
 */
import { MONITOR_MODE_CONFIG_KEY, MonitorModeSchema, type CacheUsageUpdate, type CacheUsageWindowSnapshot } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

export type CacheUsageClient = Pick<WsClient, "subscribeCacheUsage" | "unsubscribeCacheUsage" | "onCacheUsageChanged" | "onConfigChanged" | "onClose">;
export type CacheUsageView = {
  phase: "loading" | "refreshing" | "live" | "stale" | "error" | "disabled";
  snapshot: CacheUsageWindowSnapshot | null;
  error: string | null;
};
export const INITIAL_CACHE_USAGE_VIEW: CacheUsageView = { phase: "disabled", snapshot: null, error: null };

export class CacheUsageController {
  private state = INITIAL_CACHE_USAGE_VIEW;
  private client: CacheUsageClient | null = null;
  private generation = 0;
  private binding = 0;
  private revision = -1;
  private pendingRead: number | null = null;
  private visible = true;
  private enabled = false;
  private removePush: (() => void) | null = null;
  private removeMode: (() => void) | null = null;
  private readonly publish: (view: CacheUsageView) => void;
  private readonly characterId: string;

  constructor(publish: (view: CacheUsageView) => void, characterId: string) {
    this.publish = publish;
    this.characterId = characterId;
  }

  bind(next: CacheUsageClient | null): void {
    this.stop();
    this.removeMode?.();
    this.removeMode = null;
    if (next !== this.client) this.revision = -1;
    this.client = next;
    const binding = ++this.binding;
    if (next) {
      this.removeMode = next.onConfigChanged((change) => {
        if (binding !== this.binding || change.key !== MONITOR_MODE_CONFIG_KEY) return;
        const mode = MonitorModeSchema.safeParse(change.value);
        if (mode.success) this.setEnabled(mode.data !== "DISABLED");
      });
      next.onClose(() => { if (binding === this.binding) this.bind(null); });
    }
    this.start();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.stop();
    if (!enabled) this.update(INITIAL_CACHE_USAGE_VIEW);
    else this.start();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) this.stop();
    else this.start();
  }

  retry = (): void => {
    if (!this.client || !this.visible || !this.enabled || this.pendingRead !== null) return;
    this.stop();
    this.start();
  };

  dispose(): void {
    this.stop();
    this.removeMode?.();
    this.removeMode = null;
    this.binding += 1;
    this.client = null;
  }

  private stop(): void {
    this.generation += 1;
    this.pendingRead = null;
    if (this.removePush) {
      this.removePush();
      this.removePush = null;
      void this.client?.unsubscribeCacheUsage().catch(() => undefined);
    }
    if (this.state.snapshot) this.update({ ...this.state, phase: "stale" });
  }

  private start(): void {
    if (!this.enabled) { this.update(INITIAL_CACHE_USAGE_VIEW); return; }
    if (!this.visible) return;
    const client = this.client;
    if (!client) { this.update({ ...this.state, phase: "stale", error: null }); return; }
    const generation = ++this.generation;
    const revision = this.revision;
    this.pendingRead = generation;
    this.update({ ...this.state, phase: this.state.snapshot ? "refreshing" : "loading", error: null });
    this.removePush = client.onCacheUsageChanged((update) => this.accept(update, generation));
    void client.subscribeCacheUsage({ characterId: this.characterId }).then(
      (update) => {
        if (generation === this.generation) this.pendingRead = null;
        this.accept(update, generation);
      },
      () => {
        if (generation !== this.generation) return;
        this.pendingRead = null;
        if (this.revision > revision) return;
        this.update({ ...this.state, phase: "error", error: "缓存统计读取失败" });
      },
    );
  }

  private accept(update: CacheUsageUpdate, generation: number): void {
    if (generation !== this.generation || update.revision <= this.revision || update.snapshot.characterId !== this.characterId) return;
    this.revision = update.revision;
    if (update.snapshot.reason === "monitor-disabled") {
      this.setEnabled(false);
      return;
    }
    this.update({ phase: "live", snapshot: update.snapshot, error: null });
  }

  private update(view: CacheUsageView): void {
    this.state = view;
    if (this.visible) this.publish(view);
  }
}
