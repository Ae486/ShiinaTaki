/**
 * INPUT:  authenticated operator connections and bounded, already-produced extension change targets
 * OUTPUT: idempotent membership and failure-isolated, microtask-coalesced ExtensionChanged notifications
 * POS:    core/extensions — disposable operator projection channel; owns no catalog, query or execution state
 */
import { EXTENSION_CHANGE_TARGETS, type ExtensionChanged, type ExtensionChangeTarget } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

export type ExtensionSink = (change: ExtensionChanged) => void;
export interface ExtensionSubscriptions {
  /** True only for a new membership, so retrying setup registers no duplicate close cleanup. */
  subscribe(connection: Connection, sink: ExtensionSink): boolean;
  unsubscribe(connection: Connection): void;
  publish(targets: readonly ExtensionChangeTarget[]): void;
  count(): number;
  dispose(): void;
}

export function createExtensionSubscriptions(): ExtensionSubscriptions {
  return new ExtensionSubscriptionRegistry();
}

function isOperator(connection: Connection): boolean {
  return connection.state.status === "authenticated" && connection.state.role === "operator";
}

class ExtensionSubscriptionRegistry implements ExtensionSubscriptions {
  private readonly sinks = new Map<Connection, ExtensionSink>();
  private readonly pending = new Set<ExtensionChangeTarget>();
  private revision = 0;
  private queued = false;
  private disposed = false;

  subscribe(connection: Connection, sink: ExtensionSink): boolean {
    if (this.disposed || !isOperator(connection)) return false;
    const added = !this.sinks.has(connection);
    this.sinks.set(connection, sink);
    return added;
  }

  unsubscribe(connection: Connection): void {
    if (this.sinks.delete(connection) && this.sinks.size === 0) this.pending.clear();
  }

  publish = (targets: readonly ExtensionChangeTarget[]): void => {
    if (this.disposed || this.sinks.size === 0) return;
    for (const target of EXTENSION_CHANGE_TARGETS) if (targets.includes(target)) this.pending.add(target);
    if (this.queued || this.pending.size === 0) return;
    this.queued = true;
    queueMicrotask(() => this.flush());
  };

  count(): number { return this.sinks.size; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sinks.clear();
    this.pending.clear();
  }

  private flush(): void {
    this.queued = false;
    const targets = EXTENSION_CHANGE_TARGETS.filter((target) => this.pending.has(target));
    this.pending.clear();
    if (this.disposed || this.sinks.size === 0 || targets.length === 0) return;
    const revision = ++this.revision;
    // Snapshot recipients so sink replacement/closure during fan-out cannot notify a retired observer.
    // A fresh bounded payload per recipient also isolates accidental mutation by an earlier sink.
    for (const [connection, sink] of [...this.sinks]) {
      if (!isOperator(connection) || this.sinks.get(connection) !== sink) continue;
      try { sink({ revision, targets: [...targets] }); }
      catch { /* A transport observer cannot interrupt another operator or the next produced invalidation. */ }
    }
  }
}
