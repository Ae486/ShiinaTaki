/**
 * INPUT:  normal memory admissions and an operator activation quiescence request
 * OUTPUT: bounded drain/fence semantics that reject new legacy work while activation owns the gate
 * POS:    core/memory/legacy-migration — process-wide authority transition primitive, independent of storage
 */
export interface MemoryAuthorityFence { admit<T>(operation: () => Promise<T> | T): Promise<T>; admitSync<T>(operation: () => T): T; quiesce<T>(input: { timeoutMs: number; retireOnSuccess?: boolean }, operation: () => Promise<T>): Promise<T> }

export function createMemoryAuthorityFence(): MemoryAuthorityFence {
  let fenced = false; let active = 0; const waiters = new Set<() => void>();
  return {
    async admit<T>(operation: () => Promise<T> | T): Promise<T> {
      if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED"); active += 1;
      try { return await operation(); } finally { active -= 1; if (active === 0) for (const wake of waiters) wake(); }
    },
    admitSync<T>(operation: () => T): T {
      if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED"); active += 1;
      try { return operation(); } finally { active -= 1; if (active === 0) for (const wake of waiters) wake(); }
    },
    async quiesce<T>(input: { timeoutMs: number; retireOnSuccess?: boolean }, operation: () => Promise<T>): Promise<T> {
      if (fenced) throw new Error("MEMORY_AUTHORITY_FENCED"); fenced = true;
      let succeeded = false;
      try { await drain(() => active, waiters, input.timeoutMs); const result = await operation(); succeeded = true; return result; }
      finally { if (!succeeded || !input.retireOnSuccess) fenced = false; }
    },
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
