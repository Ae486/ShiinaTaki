/**
 * INPUT:  subscribe/unsubscribe(connection, sink) + publish(operation) from the memory operation service's onChanged
 * OUTPUT: createMemoryOperationSubscriptions() -> { subscribe, unsubscribe, publish, count }; one channel, connection→sink
 * POS:    core/server — the memory.operations.changed fan-out registry (invariant 7); disconnect cleanup driven by ctx.onClose
 */
import type { MemoryOperation } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";

export type MemoryOperationSink = (operation: MemoryOperation) => void;

export interface MemoryOperationSubscriptions {
  subscribe(connection: Connection, sink: MemoryOperationSink): void;
  unsubscribe(connection: Connection): void;
  /** Fans a transition out to every subscribed operator connection; a throwing sink never blocks its siblings. */
  publish(operation: MemoryOperation): void;
  count(): number;
}

export function createMemoryOperationSubscriptions(): MemoryOperationSubscriptions {
  const sinks = new Map<Connection, MemoryOperationSink>();
  return {
    subscribe(connection, sink) { sinks.set(connection, sink); },
    unsubscribe(connection) { sinks.delete(connection); },
    publish(operation) {
      for (const sink of [...sinks.values()]) {
        try { sink(operation); } catch { /* a dead socket must not stop the fan-out; its onClose removes it */ }
      }
    },
    count: () => sinks.size,
  };
}
