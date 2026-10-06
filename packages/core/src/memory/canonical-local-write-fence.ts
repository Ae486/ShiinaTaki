/**
 * INPUT:  nested provider work admissions and coordinator quiesce/release/retire requests
 * OUTPUT: counted parent/child lifetimes, bounded drain, permanently retired references and explicit safe release
 * POS:    core/memory — shared Local/write and Hindsight/work fence primitive; detached continuations cannot acquire ownership
 */
import { AsyncLocalStorage } from "node:async_hooks";
export interface CanonicalLocalWriteFence {
  /** False while fenced or retired; sweepers and triggers consult it before starting retired work. */
  writable(): boolean;
  /** Retirement is irreversible, including reads through held references during same-epoch source recovery. */
  assertAlive(): void;
  admit<T>(operation: () => Promise<T> | T): Promise<T>;
  admitSync<T>(operation: () => T): T;
  /** Refuses new writes, then waits for admitted ones; the holder must later release() or retire(). */
  quiesce(input: { timeoutMs: number; signal?: AbortSignal; keepFencedOnFailure?: boolean }): Promise<void>;
  /** Reopens writes after a pre-COMMIT failure; the caller proves the Local marker first (never automatic). */
  release(): void;
  /** Marks the durable authority transition; no later release may reopen Local work. */
  retire(): void;
}

export function isCanonicalLocalFenced(error: unknown): boolean {
  return error instanceof Error && error.message === "MEMORY_AUTHORITY_FENCED";
}

export function createCanonicalLocalWriteFence(): CanonicalLocalWriteFence {
  let fenced = false; let retired = false; let active = 0; const waiters = new Set<() => void>();
  const ownership = new AsyncLocalStorage<{ live: boolean }>();
  const leave = () => { active -= 1; if (active === 0) for (const wake of waiters) wake(); };
  const enter = () => { if (!inherited() && fenced) throw new Error("MEMORY_AUTHORITY_FENCED"); active += 1; };
  const inherited = () => {
    const owner = ownership.getStore();
    if (owner && (!owner.live || retired)) throw new Error("MEMORY_AUTHORITY_FENCED");
    return owner;
  };
  return {
    writable: () => !fenced,
    assertAlive: () => { if (retired) throw new Error("MEMORY_AUTHORITY_FENCED"); },
    async admit<T>(operation: () => Promise<T> | T): Promise<T> {
      // Each admitted child has its own lifetime and drain count. A parent may finish before an already admitted
      // child, but an unadmitted continuation inherited from that finished parent must never acquire fresh ownership.
      enter();
      const owner = { live: true };
      try { return await ownership.run(owner, operation); } finally { owner.live = false; leave(); }
    },
    admitSync<T>(operation: () => T): T {
      enter();
      const owner = { live: true };
      try { return ownership.run(owner, operation); } finally { owner.live = false; leave(); }
    },
    async quiesce(input) {
      if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED");
      fenced = true;
      try { await drain(() => active, waiters, input); }
      catch (error) { fenced = retired || input.keepFencedOnFailure === true; throw error; }
    },
    release: () => { fenced = retired; },
    retire: () => { retired = true; fenced = true; },
  };
}

function drain(active: () => number, waiters: Set<() => void>, input: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
  const { timeoutMs, signal } = input;
  if (signal?.aborted) return Promise.reject(new Error("MEMORY_OPERATION_CANCELLED"));
  if (active() === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => { clearTimeout(timer); waiters.delete(done); signal?.removeEventListener("abort", cancelled); };
    const cancelled = () => { clear(); reject(new Error("MEMORY_OPERATION_CANCELLED")); };
    const timer = setTimeout(() => { clear(); reject(new Error("MEMORY_QUIESCENCE_TIMEOUT")); }, timeoutMs);
    const done = () => { if (active() !== 0) return; clear(); resolve(); };
    waiters.add(done);
    signal?.addEventListener("abort", cancelled, { once: true });
  });
}
