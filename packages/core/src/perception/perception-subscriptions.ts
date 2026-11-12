/**
 * INPUT:  authenticated operator connections, notification sinks and interest-transition observation
 * OUTPUT: idempotent connection membership and isolated PerceptionChanged fan-out
 * POS:    core/perception — opt-in operator registry; close cleanup is owned by perception.subscribe
 */
import type { PerceptionChanged } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { notifyPerceptionChange } from "./notify-perception-change.ts";

export type PerceptionSink = (change: PerceptionChanged) => void;

export interface PerceptionSubscriptions {
  /** True only for a new membership, so a repeated setup installs no extra close callback. */
  subscribe(connection: Connection, sink: PerceptionSink): boolean;
  unsubscribe(connection: Connection): void;
  publish(change: PerceptionChanged): void;
  count(): number;
  dispose(): void;
}

function isOperator(connection: Connection): boolean {
  return connection.state.status === "authenticated" && connection.state.role === "operator";
}

export function createPerceptionSubscriptions(onInterestChanged?: () => void): PerceptionSubscriptions {
  const sinks = new Map<Connection, PerceptionSink>();
  let disposed = false;
  return {
    subscribe(connection, sink) {
      if (disposed || !isOperator(connection)) return false;
      const added = !sinks.has(connection);
      sinks.set(connection, sink);
      if (added && sinks.size === 1) notifyPerceptionChange(onInterestChanged);
      return added;
    },
    unsubscribe(connection) {
      if (sinks.delete(connection) && sinks.size === 0) notifyPerceptionChange(onInterestChanged);
    },
    publish(change) {
      for (const [connection, sink] of sinks) {
        if (isOperator(connection)) notifyPerceptionChange(() => sink(change));
      }
    },
    count: () => sinks.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      const hadInterest = sinks.size > 0;
      sinks.clear();
      if (hadInterest) notifyPerceptionChange(onInterestChanged);
    },
  };
}
