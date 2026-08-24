import type { RunEvent } from "@taki/shared";

export interface RunEventSubscription { readonly cursor: number; readonly overflowed: boolean; close(): void; }
export interface RunEventLiveBus {
  publish(events: readonly RunEvent[]): void;
  subscribe(runId: string, observer: (event: RunEvent) => void | Promise<void>, options?: { capacity?: number; afterSeq?: number }): RunEventSubscription;
}

interface Listener {
  runId: string;
  observer: (event: RunEvent) => void | Promise<void>;
  capacity: number;
  cursor: number;
  queue: RunEvent[];
  scheduled: boolean;
  overflowed: boolean;
  closed: boolean;
}

// eslint-disable-next-line max-lines-per-function
export function createRunEventLiveBus(backfill: (runId: string, afterSeq: number) => RunEvent[] = () => []): RunEventLiveBus {
  const listeners = new Set<Listener>();
  const schedule = (listener: Listener): void => {
    if (listener.scheduled || listener.closed || listener.overflowed) return;
    listener.scheduled = true;
    queueMicrotask(() => void drain(listener));
  };
  const enqueue = (listener: Listener, events: readonly RunEvent[]): void => {
    for (const event of events) {
      if (event.runId !== listener.runId || event.seq <= listener.cursor || listener.queue.some((queued) => queued.seq === event.seq)) continue;
      listener.queue.push(event);
      if (listener.queue.length > listener.capacity) {
        listener.overflowed = true;
        listener.queue.length = 0;
        return;
      }
    }
    schedule(listener);
  };
  const drain = async (listener: Listener): Promise<void> => {
    try {
      while (!listener.closed && !listener.overflowed) {
        const event = listener.queue.shift();
        if (!event) return;
        try {
          await listener.observer(event);
          listener.cursor = event.seq;
        } catch {
          listener.overflowed = true;
          listener.queue.length = 0;
        }
      }
    } finally {
      listener.scheduled = false;
      if (listener.queue.length > 0) schedule(listener);
    }
  };
  return {
    publish(events) {
      for (const listener of [...listeners]) {
        if (!listener.closed && !listener.overflowed) enqueue(listener, events);
      }
    },
    subscribe(runId, observer, options = {}) {
      const capacity = options.capacity ?? 128;
      const afterSeq = options.afterSeq ?? 0;
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) throw new Error("RUN_EVENT_INVALID_CAPACITY");
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error("RUN_EVENT_INVALID_CURSOR");
      const listener: Listener = { runId, observer, capacity, cursor: afterSeq, queue: [], scheduled: false, overflowed: false, closed: false };
      listeners.add(listener);
      enqueue(listener, backfill(runId, afterSeq));
      return { get cursor() { return listener.cursor; }, get overflowed() { return listener.overflowed; }, close() { if (listener.closed) return; listener.closed = true; listeners.delete(listener); } };
    },
  };
}
