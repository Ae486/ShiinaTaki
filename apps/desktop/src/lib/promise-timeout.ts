/**
 * INPUT:  a promise + a timeout budget.
 * OUTPUT: withTimeout(promise, ms, label) — the same promise, rejecting with a labeled Error if it never settles in time.
 * POS:    ui/lib — shared guard for renderer loads that can wedge (model resources that never finish); consumers decide
 *         the fallback. A late completion is harmless per pet-scene's switch ticket.
 */

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}
