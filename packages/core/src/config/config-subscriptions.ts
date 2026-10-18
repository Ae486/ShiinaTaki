/**
 * INPUT:  subscribe/unsubscribe(connection, sink) from config.subscribe + publish(change) from the config writer
 * OUTPUT: createConfigSubscriptions() -> { subscribe, unsubscribe, publish, count }
 * POS:    core/config — the config.changed fan-out registry (avatar-subscriptions pattern, no character scoping:
 *         settings are global); disconnect cleanup is driven by ctx.onClose
 */
import type { ConfigChanged } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";

export type ConfigSink = (change: ConfigChanged) => void;

export interface ConfigSubscriptions {
  subscribe(connection: Connection, sink: ConfigSink): void;
  unsubscribe(connection: Connection): void;
  publish(change: ConfigChanged): void;
  count(): number;
  /** In-process write generation, including changes that restore an earlier value. */
  revision(): number;
}

export function createConfigSubscriptions(): ConfigSubscriptions {
  const sinks = new Map<Connection, ConfigSink>();
  let revision = 0;

  return {
    subscribe(connection, sink) {
      sinks.set(connection, sink); // idempotent: re-subscribing the same connection replaces its sink
    },
    unsubscribe(connection) {
      sinks.delete(connection);
    },
    publish(change) {
      revision++;
      // No panel open (invariant 4: a disposable client) → nobody hears it; never an error.
      for (const sink of sinks.values()) sink(change);
    },
    count() {
      return sinks.size;
    },
    revision: () => revision,
  };
}
