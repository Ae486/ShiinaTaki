/**
 * INPUT:  one replaceable invalidation channel and a domain owner's readiness/error/dirty callbacks.
 * OUTPUT: handler-before-setup ordering, shared pending setup and monotonic invalidation delivery.
 * POS:    ui/lib — subscription readiness only; domain owners retain visibility, reads, drafts and write authority.
 */
import type { ReadSubscriptionSupport } from "./ws-read-subscriptions.ts";

export type ReadObservationState = "idle" | "subscribing" | "live" | "unsupported" | "failure";
export interface ReadObservationChannel {
  subscribe(): Promise<ReadSubscriptionSupport>;
  onChanged(handler: (revision: number) => void): () => void;
}
interface ObservationSink {
  changed(state: ReadObservationState): void;
  failed(cause: unknown): void;
  invalidated(): void;
}

export function createReadObservation(sink: ObservationSink) {
  return new ObservationOwner(sink);
}

export type ReadObservation = ReturnType<typeof createReadObservation>;

class ObservationOwner {
  private channel: ReadObservationChannel | null = null;
  private unsubscribe: (() => void) | null = null;
  private epoch = 0;
  private revision = -1;
  private currentState: ReadObservationState = "idle";
  private pending: Promise<boolean> | null = null;
  private readonly sink: ObservationSink;

  constructor(sink: ObservationSink) { this.sink = sink; }
  state(): ReadObservationState { return this.currentState; }
  usable(): boolean { return this.currentState === "live" || this.currentState === "unsupported"; }

  replace(next: ReadObservationChannel | null): void {
    if (this.channel === next) return;
    this.epoch += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.channel = next;
    this.pending = null;
    this.revision = -1;
    this.set("idle");
    const token = this.epoch;
    // Binding performs no RPC. The effect-owned handler is installed before setup so hints delivered
    // during its acknowledgement are already dirty when the domain authorizes its one baseline read.
    if (next) this.unsubscribe = next.onChanged((revision) => {
      if (token !== this.epoch || this.currentState === "unsupported" || revision <= this.revision) return;
      this.revision = revision;
      this.sink.invalidated();
    });
  }

  prepare(): Promise<boolean> {
    if (!this.channel) return Promise.resolve(false);
    if (this.usable()) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const token = this.epoch;
    const source = this.channel;
    // Own setup before a synchronous readiness callback can express another demand or retire us.
    let settle!: (usable: boolean) => void;
    const owned = new Promise<boolean>((resolve) => { settle = resolve; });
    this.pending = owned;
    this.set("subscribing");
    void this.runPrepare(source, token).then((usable) => {
      if (this.pending === owned) this.pending = null;
      settle(usable);
    });
    return owned;
  }

  private async runPrepare(source: ReadObservationChannel, token: number): Promise<boolean> {
    try {
      if (token !== this.epoch) return false;
      const support = await source.subscribe();
      if (token !== this.epoch) return false;
      this.set(support === "supported" ? "live" : "unsupported");
      return true;
    } catch (cause) {
      if (token === this.epoch) { this.set("failure"); this.sink.failed(cause); }
      return false;
    }
  }

  private set(state: ReadObservationState): void { this.currentState = state; this.sink.changed(state); }
}
