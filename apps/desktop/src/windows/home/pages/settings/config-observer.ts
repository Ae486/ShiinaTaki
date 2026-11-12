/**
 * INPUT:  one authenticated config client, effective visibility and the cached-read adapter's actions.
 * OUTPUT: subscription-before-read initialization, covered-gap tracking and cheap hidden change bookkeeping.
 * POS:    Home Settings — disposable observation lifetime; shares the client's existing config/timing subscription.
 */
import type { ConfigChanged, ConfigListResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

interface ConfigObserverInput {
  client: Pick<WsClient, "configList" | "subscribeConfig" | "onConfigChanged">;
  visible(): boolean;
  apply(change: ConfigChanged): void;
  demand(): Promise<void>;
  gap(behind: boolean): void;
}

export function createConfigObserver(input: ConfigObserverInput) { return new ConfigObserver(input); }

class ConfigObserver {
  private readonly input: ConfigObserverInput;
  private started = false;
  private binding = 0;
  private epoch = 0;
  private revision = 0;
  private needsRead = true;
  private reading = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly fieldVersions = new Map<string, number>();

  constructor(input: ConfigObserverInput) { this.input = input; }

  versionOf = (key: string): number => this.fieldVersions.get(key) ?? 0;

  read = async (): Promise<ConfigListResult> => {
    const epoch = this.epoch;
    const revision = this.revision;
    this.reading += 1;
    try {
      await this.input.client.subscribeConfig();
      if (!this.started || this.epoch !== epoch || !this.input.visible()) throw new Error("配置读取已结束");
      const result = await this.input.client.configList();
      if (this.started && this.epoch === epoch && this.input.visible() && this.revision === revision) {
        this.needsRead = false;
        this.input.gap(false);
      }
      return result;
    } catch (cause) {
      if (this.started && this.epoch === epoch) {
        this.needsRead = true;
        if (this.input.visible()) this.input.gap(true);
      }
      throw cause;
    } finally { this.reading -= 1; }
  };

  start(): () => void {
    this.unsubscribe?.();
    this.started = true;
    const binding = ++this.binding;
    this.unsubscribe = this.input.client.onConfigChanged((change) => {
      if (!this.started || this.binding !== binding) return;
      this.revision += 1;
      this.fieldVersions.set(change.key, this.revision);
      this.needsRead = true;
      if (this.input.visible()) {
        this.input.apply(change);
        this.input.gap(true);
        void this.input.demand();
      }
    });
    return () => {
      if (this.binding !== binding) return;
      this.started = false;
      this.epoch += 1;
      this.needsRead = true;
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      this.epoch += 1;
      if (this.reading > 0) this.needsRead = true;
    } else if (this.needsRead) {
      this.input.gap(true);
      void this.input.demand();
    }
  }
}
