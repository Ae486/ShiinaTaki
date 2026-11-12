/**
 * INPUT: proven pre-intent idle failures and fresh retry opportunities
 * OUTPUT: one bounded retry timer per Character, coalesced and cancelled on shutdown
 * POS: core/harness — retry opportunity scheduling only; delivery receipts remain authoritative
 */
export function createSubagentInboxRetry(opportunity: (characterId: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  let closed = false;
  const clear = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
  return {
    arm(id: string) {
      if (closed) return false;
      if (timers.has(id)) return true;
      const attempt = attempts.get(id) ?? 0;
      const delay = [1000, 5000, 15_000][attempt];
      if (delay === undefined) return false;
      attempts.set(id, attempt + 1);
      const timer = setTimeout(() => {
        timers.delete(id);
        if (!closed) opportunity(id);
      }, delay);
      timer.unref(); timers.set(id, timer);
      return true;
    },
    reset(id: string) { clear(id); attempts.delete(id); },
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear(); attempts.clear();
    },
  };
}
