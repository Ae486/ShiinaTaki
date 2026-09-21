/**
 * INPUT:  subscribe/unsubscribe(connection, sink) + publish(value) from a Core-owned producer's onChanged
 * OUTPUT: createConnectionSubscriptions<T>() -> { subscribe, unsubscribe, publish, count }; one channel, connection→sink;
 *         createMemoryOperationSubscriptions() is the memory.operations.changed instance
 * POS:    core/server — the connection-scoped fan-out registry (invariant 7); disconnect cleanup driven by ctx.onClose
 */
import type { MemoryOperation } from "@taki/shared";
import type { Connection } from "./connection-registry.ts";

export interface ConnectionSubscriptions<T> {
  subscribe(connection: Connection, sink: (value: T) => void): void;
  unsubscribe(connection: Connection): void;
  /** Fans a value out to every subscribed operator connection; a throwing sink never blocks its siblings. */
  publish(value: T): void;
  count(): number;
}

export function createConnectionSubscriptions<T>(): ConnectionSubscriptions<T> {
  const sinks = new Map<Connection, (value: T) => void>();
  return {
    subscribe(connection, sink) { sinks.set(connection, sink); },
    unsubscribe(connection) { sinks.delete(connection); },
    publish(value) {
      for (const sink of [...sinks.values()]) {
        try { sink(value); } catch { /* a dead socket must not stop the fan-out; its onClose removes it */ }
      }
    },
    count: () => sinks.size,
  };
}

export type MemoryOperationSink = (operation: MemoryOperation) => void;
export type MemoryOperationSubscriptions = ConnectionSubscriptions<MemoryOperation>;

export function createMemoryOperationSubscriptions(): MemoryOperationSubscriptions {
  return createConnectionSubscriptions<MemoryOperation>();
}
