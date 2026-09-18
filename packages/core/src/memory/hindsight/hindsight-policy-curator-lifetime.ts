/**
 * INPUT:  one curator pass timeout and the owning curator's shutdown signal
 * OUTPUT: a shared deadline/abort lifetime and bounded awaits which cannot resume into late DB callbacks
 * POS:    core/memory/hindsight — no scheduler; shutdown cancels only curator-owned work
 */
import { hindsightApplicationDeadline } from "./hindsight-application-body-transfer.ts";
import type { HindsightPolicyCuratorRun } from "./hindsight-policy-curator-context.ts";

export function createCuratorLifetime(timeoutMs: number, owner: AbortSignal) {
  const deadline = new AbortController(); const signal = AbortSignal.any([owner, deadline.signal]);
  const call = hindsightApplicationDeadline({ timeoutMs, signal });
  let finished = false;
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  return { signal, call, stopped: () => owner.aborted,
    alive: () => { if (finished || signal.aborted) throw new Error("MEMORY_OPERATION_CANCELLED"); call(); },
    finish: () => { finished = true; clearTimeout(timer); } };
}

export function awaitCuratorWork<T>(run: Pick<HindsightPolicyCuratorRun, "signal" | "alive">, action: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { value: T } | { error: unknown }) => {
      if (settled) return; settled = true; run.signal.removeEventListener("abort", abort);
      if ("error" in outcome) reject(outcome.error); else resolve(outcome.value);
    };
    const abort = () => finish({ error: new Error("MEMORY_OPERATION_CANCELLED") });
    run.signal.addEventListener("abort", abort, { once: true });
    if (run.signal.aborted) { abort(); return; }
    try { run.alive(); void action().then((value) => finish({ value }), (error: unknown) => finish({ error })); }
    catch (error) { finish({ error }); }
  });
}
