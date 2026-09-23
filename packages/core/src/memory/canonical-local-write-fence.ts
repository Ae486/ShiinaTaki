/**
 * INPUT:  Canonical Local write admissions and the activation coordinator's quiesce/release/retire requests
 * OUTPUT: createCanonicalLocalWriteFence() — write-only admission counting, bounded drain, structured MEMORY_AUTHORITY_FENCED,
 *         explicit release after a pre-COMMIT failure and irrevocable retirement after COMMIT
 * POS:    core/memory — process-wide Local -> Hindsight transition primitive; reads never pass through it, storage untouched
 */
export interface CanonicalLocalWriteFence {
  /** False while fenced or retired; sweepers and triggers consult it before starting retired work. */
  writable(): boolean;
  admit<T>(operation: () => Promise<T> | T): Promise<T>;
  admitSync<T>(operation: () => T): T;
  /** Refuses new writes, then waits for admitted ones; the holder must later release() or retire(). */
  quiesce(input: { timeoutMs: number }): Promise<void>;
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
  const leave = () => { active -= 1; if (active === 0) for (const wake of waiters) wake(); };
  const enter = () => { if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED"); active += 1; };
  return {
    writable: () => !fenced,
    async admit<T>(operation: () => Promise<T> | T): Promise<T> {
      enter();
      try { return await operation(); } finally { leave(); }
    },
    admitSync<T>(operation: () => T): T {
      enter();
      try { return operation(); } finally { leave(); }
    },
    async quiesce(input) {
      if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED");
      fenced = true;
      try { await drain(() => active, waiters, input.timeoutMs); }
      catch (error) { fenced = retired; throw error; }
    },
    release: () => { fenced = retired; },
    retire: () => { retired = true; fenced = true; },
  };
}

function drain(active: () => number, waiters: Set<() => void>, timeoutMs: number): Promise<void> {
  if (active() === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(done); reject(new Error("MEMORY_QUIESCENCE_TIMEOUT")); }, timeoutMs);
    const done = () => { if (active() !== 0) return; clearTimeout(timer); waiters.delete(done); resolve(); };
    waiters.add(done);
  });
}
