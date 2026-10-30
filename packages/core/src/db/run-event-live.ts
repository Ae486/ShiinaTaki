/**
 * INPUT:  committed Run Events and a bounded durable backfill reader
 * OUTPUT: connection-owned live subscriptions with bounded queues and explicit gap invalidation
 * POS:    core/db — best-effort post-commit notifications; durable queries recover every overflow
 */
import type { RunEvent } from "@taki/shared";

export interface RunEventSubscription {
  readonly cursor: number;
  readonly overflowed: boolean;
  close(): void;
}
export interface RunEventLiveBus {
  publish(events: readonly RunEvent[]): void;
  subscribe(runId: string, observer: (event: RunEvent) => void | Promise<void>, options?: {
    capacity?: number; afterSeq?: number; onOverflow?: () => void;
  }): RunEventSubscription;
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
  onOverflow?: () => void;
}

type Backfill = (runId: string, afterSeq: number, limit: number) =>
  { events: RunEvent[]; hasMore: boolean } | RunEvent[];

export function createRunEventLiveBus(backfill: Backfill = () => ({ events: [], hasMore: false }),
  onCommitted?: (events: readonly RunEvent[]) => void): RunEventLiveBus {
  const listeners = new Set<Listener>();
  return {
    publish(events) {
      // Local composition observes only committed facts, with the same failure isolation as socket subscribers.
      try { onCommitted?.(events); } catch { /* Durable readers recover a missed notification. */ }
      for (const listener of [...listeners]) {
        if (!listener.closed && !listener.overflowed) enqueue(listener, events);
      }
    },
    subscribe(runId, observer, options = {}) {
      const capacity = options.capacity ?? 128;
      const afterSeq = options.afterSeq ?? 0;
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) throw new Error("RUN_EVENT_INVALID_CAPACITY");
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error("RUN_EVENT_INVALID_CURSOR");
      const listener: Listener = {
        runId, observer, capacity, cursor: afterSeq, queue: [], scheduled: false, overflowed: false,
        closed: false, onOverflow: options.onOverflow,
      };
      listeners.add(listener);
      try {
        const page = backfill(runId, afterSeq, Math.min(capacity, 200));
        if (Array.isArray(page)) enqueue(listener, page);
        else if (page.hasMore) invalidate(listener);
        else enqueue(listener, page.events);
      } catch { invalidate(listener); }
      return {
        get cursor() { return listener.cursor; },
        get overflowed() { return listener.overflowed; },
        close() { listener.closed = true; listener.queue.length = 0; listeners.delete(listener); },
      };
    },
  };
}

function invalidate(listener: Listener): void {
  if (listener.closed || listener.overflowed) return;
  listener.overflowed = true;
  listener.queue.length = 0;
  try { listener.onOverflow?.(); } catch { /* A failed notification must not affect the writer or other observers. */ }
}

function enqueue(listener: Listener, events: readonly RunEvent[]): void {
  for (const event of events) {
    if (event.runId !== listener.runId || event.seq <= listener.cursor || listener.queue.some((queued) => queued.seq === event.seq)) continue;
    listener.queue.push(event);
    if (listener.queue.length > listener.capacity) { invalidate(listener); return; }
  }
  schedule(listener);
}

function schedule(listener: Listener): void {
  if (listener.scheduled || listener.closed || listener.overflowed) return;
  listener.scheduled = true;
  queueMicrotask(() => void drain(listener));
}

async function drain(listener: Listener): Promise<void> {
  try {
    while (!listener.closed && !listener.overflowed) {
      const event = listener.queue.shift();
      if (!event) return;
      try {
        await listener.observer(event);
        listener.cursor = event.seq;
      } catch { invalidate(listener); }
    }
  } finally {
    listener.scheduled = false;
    if (listener.queue.length > 0) schedule(listener);
  }
}
