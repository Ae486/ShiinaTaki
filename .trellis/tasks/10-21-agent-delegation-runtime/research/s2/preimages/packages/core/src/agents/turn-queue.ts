/**
 * INPUT: Character admission intent, cancellable acquisitions and background probes
 * OUTPUT: one priority-aware Character lane with atomic background reservation
 * POS: core/agents — primary intent precedes async admission; owners may cooperatively yield, never lose their lane lease
 */
export interface PrimaryReservation {
  acquire(): Promise<() => void>;
  cancel(): void;
}

export interface TurnQueue {
  acquire(key: string, signal?: AbortSignal): Promise<() => void>;
  reservePrimary(key: string, signal?: AbortSignal): PrimaryReservation;
  tryAcquireBackground(key: string): (() => void) | undefined;
  primaryVersion(key: string): number;
  isBusy(key: string): boolean;
}

interface Waiter {
  primary: boolean;
  ready: boolean;
  cancelled: boolean;
  granted: boolean;
  resolve(release: () => void): void;
  cleanup(): void;
}
interface Lane { held: boolean; waiters: Waiter[] }
type Lanes = Map<string, Lane>;

export function createTurnQueue(options: {
  onAvailable?: (key: string) => void | Promise<void>;
  onPrimaryReserved?: (key: string) => void;
} = {}): TurnQueue {
  const lanes: Lanes = new Map();
  const primaryVersions = new Map<string, number>();
  const isBusy = (key: string) => {
    const lane = lanes.get(key);
    return lane?.held === true || (lane?.waiters.length ?? 0) > 0;
  };
  const notify = (key: string) => {
    if (!isBusy(key)) {
      try { const notification = options.onAvailable?.(key); if (notification) void notification.catch(() => undefined); }
      catch { return; }
    }
  };
  const released = (key: string, release: () => void) => {
    let done = false;
    return () => { if (done) return; done = true; release(); notify(key); };
  };
  return {
    acquire: (key, signal) => reserve(lanes, { key, primary: false, signal, onAvailable: notify }).acquire().then((release) => released(key, release)),
    reservePrimary(key, signal) {
      primaryVersions.set(key, (primaryVersions.get(key) ?? 0) + 1);
      const reservation = reserve(lanes, { key, primary: true, signal, onAvailable: notify });
      // The reservation already blocks new background acquisition. Its owner may abort eligible work and release
      // normally; this hook cannot steal the lane or promise cancellation of an external operation.
      if (!signal?.aborted) {
        try { options.onPrimaryReserved?.(key); } catch { /* A notification failure must not discard accepted input. */ }
      }
      let acquired: Promise<() => void> | undefined;
      return { acquire: () => acquired ??= reservation.acquire().then((release) => released(key, release)), cancel: reservation.cancel };
    },
    tryAcquireBackground(key) {
      const lane = laneFor(lanes, key);
      if (lane.held || lane.waiters.length > 0) return undefined;
      lane.held = true; return released(key, releaseFor(lanes, key, lane));
    },
    primaryVersion: (key) => primaryVersions.get(key) ?? 0,
    isBusy,
  };
}

function laneFor(lanes: Lanes, key: string): Lane {
  let lane = lanes.get(key);
  if (!lane) { lane = { held: false, waiters: [] }; lanes.set(key, lane); }
  return lane;
}

function releaseFor(lanes: Lanes, key: string, lane: Lane): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true; lane.held = false; pump(lanes, key, lane);
  };
}

function pump(lanes: Lanes, key: string, lane: Lane): void {
  if (lanes.get(key) !== lane || lane.held) return;
  // Unready primary intent blocks admission until its snapshot succeeds or is cancelled.
  const waiter = lane.waiters.find((entry) => entry.primary) ?? lane.waiters[0];
  if (!waiter) { lanes.delete(key); return; }
  if (!waiter.ready) return;
  lane.waiters.splice(lane.waiters.indexOf(waiter), 1);
  waiter.granted = true; waiter.cleanup(); lane.held = true;
  waiter.resolve(releaseFor(lanes, key, lane));
}

function reserve(lanes: Lanes, input: { key: string; primary: boolean; signal?: AbortSignal; onAvailable?(key: string): void }): PrimaryReservation {
  const { key, primary, signal } = input; const lane = laneFor(lanes, key);
  let resolve: Waiter["resolve"] = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<() => void>((yes, no) => { resolve = yes; reject = no; });
  // Admission can fail before acquire() observes this promise; prevent an unhandled rejection.
  void promise.catch(() => undefined);
  const cancel = () => {
    if (waiter.cancelled || waiter.granted) return;
    waiter.cancelled = true; waiter.cleanup();
    lane.waiters = lane.waiters.filter((entry) => entry !== waiter);
    reject(new Error("TURN_ACQUISITION_CANCELLED")); pump(lanes, key, lane); input.onAvailable?.(key);
  };
  const waiter: Waiter = { primary, ready: false, cancelled: false, granted: false, resolve,
    cleanup: () => signal?.removeEventListener("abort", cancel) };
  lane.waiters.push(waiter);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  return { acquire: () => {
    if (!waiter.cancelled && !waiter.granted) { waiter.ready = true; pump(lanes, key, lane); }
    return promise;
  }, cancel };
}
